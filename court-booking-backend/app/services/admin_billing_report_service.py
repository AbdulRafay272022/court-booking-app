"""Read-only owner-billing reports for the super admin: the revenue dashboard and a per-owner view. Nothing here writes
and nothing needs a migration; every figure is a query over the five billing tables (owner_features, owner_invoices,
owner_invoice_lines, owner_payments, premium_features) plus users.

Rules the figures follow, so they can be checked by hand:

* Money is whole PKR. "Collected" is approved payments plus reversal rows (negative), so a reversed payment nets to 0.
  A payment counts in the Pakistan month it was approved/recorded (or reversed), not the month it was invoiced for.
* A feature is classified with the SAME rule the gates use (`EntitlementService.row_state`): trial, paying, overdue (past its
  paid date but inside the grace days: it still works) or off (trial over and unpaid, or lapsed). Cancelled features and
  features an admin has taken off sale are not billed and are left out of the recurring figures.
* "Recurring" is the monthly value, at the price each owner signed up at, of features that are paying or overdue. Features
  still in their free trial are shown separately as `trial_value_pkr`; they are not revenue until paid.
* Figures are computed from dates, so they are meaningful whether or not `owner_billing_enforced` is on; `enforced` says
  whether anyone is actually being charged yet.
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, timezone

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.errors import AppError, ErrorCode
from app.models.owner_billing import (
    InvoiceStatus,
    OwnerFeature,
    OwnerInvoice,
    OwnerInvoiceLine,
    OwnerPayment,
    OwnerPaymentStatus,
)
from app.models.user import User, UserRole
from app.schemas.admin_billing_report import (
    BillingSummaryOut,
    FeatureRevenueOut,
    InvoiceTotalsOut,
    MonthCollectedOut,
    OwnerBillingDetailOut,
    OwnerBillingRowOut,
    OwnerCountsOut,
    OwnerFeatureBillingOut,
    OwnerInvoiceDetailOut,
    OwnerPaymentRowOut,
)
from app.schemas.owner_billing import InvoiceLineOut
from app.services.entitlement_service import SELLABLE_KEYS, EntitlementService
from app.utils.timezone import pkt_today, utc_to_pkt_naive

MONTHS_SHOWN = 6
OPEN_INVOICE = (InvoiceStatus.ISSUED.value, InvoiceStatus.PROOF_SUBMITTED.value)
MONEY_IN = (OwnerPaymentStatus.APPROVED.value, OwnerPaymentStatus.REVERSAL.value)
# worst first: what an admin should look at first
STATE_ORDER = {"off": 0, "overdue": 1, "trial": 2, "paying": 3, "none": 4}


def classify(reason: str) -> str:
    """Entitlement reason -> the four words the reports use."""
    return {"trial": "trial", "paid": "paying", "grace": "overdue"}.get(reason, "off")


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _months_back(today: date, n: int) -> list[str]:
    """The last `n` Pakistan calendar months ending with today's, oldest first."""
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


def _paid_month(p: OwnerPayment) -> str:
    return _month_key(utc_to_pkt_naive(p.reviewed_at or p.created_at).date())


class AdminBillingReportService:
    def __init__(self, db: AsyncSession, settings: Settings | None = None) -> None:
        self.db = db
        self.settings = settings or get_settings()
        self.entitlements = EntitlementService(db, self.settings)

    # ---- revenue dashboard --------------------------------------------------------------------------------------------

    async def summary(self, *, today: date | None = None) -> BillingSummaryOut:
        today = today or pkt_today()
        ent = self.entitlements
        catalog = await ent.catalog()

        per_feature: dict[str, FeatureRevenueOut] = {
            k: FeatureRevenueOut(
                key=k, label=catalog[k].label, list_price_pkr=catalog[k].monthly_price_pkr, is_sellable=catalog[k].is_sellable,
                owners_on=0, on_trial=0, paying=0, overdue=0, off=0, recurring_pkr=0,
            )
            for k in SELLABLE_KEYS
            if k in catalog
        }
        recurring = trial_value = at_risk = 0
        owner_states: dict[uuid.UUID, set[str]] = defaultdict(set)
        for row, _feature in await ent.billable_rows():
            if row.feature_key not in per_feature:
                continue
            cls = classify(ent.row_state(row, today).reason)
            owner_states[row.owner_id].add(cls)
            f = per_feature[row.feature_key]
            f.owners_on += 1
            if cls == "trial":
                f.on_trial += 1
                trial_value += row.price_pkr
            elif cls == "paying":
                f.paying += 1
                f.recurring_pkr += row.price_pkr
                recurring += row.price_pkr
            elif cls == "overdue":
                f.overdue += 1
                f.recurring_pkr += row.price_pkr
                recurring += row.price_pkr
            else:
                f.off += 1
                at_risk += row.price_pkr

        counts = OwnerCountsOut(
            with_premium=len(owner_states),
            on_trial_only=sum(1 for s in owner_states.values() if s == {"trial"}),
            paying=sum(1 for s in owner_states.values() if "paying" in s),
            overdue=sum(1 for s in owner_states.values() if "overdue" in s),
            off=sum(1 for s in owner_states.values() if "off" in s),
        )

        # money in, by Pakistan month
        by_month: dict[str, int] = defaultdict(int)
        all_time = 0
        for p in (await self.db.execute(select(OwnerPayment).where(OwnerPayment.status.in_(MONEY_IN)))).scalars():
            by_month[_paid_month(p)] += p.amount_pkr
            all_time += p.amount_pkr
        months = _months_back(today, MONTHS_SHOWN)
        this_month, last_month = months[-1], months[-2]

        invoices = (
            await self.db.execute(select(OwnerInvoice).where(OwnerInvoice.status.in_(OPEN_INVOICE)))
        ).scalars().all()
        overdue_invoices = [i for i in invoices if i.due_date < today]

        waiting = (
            await self.db.execute(select(OwnerPayment.id).where(OwnerPayment.status == OwnerPaymentStatus.SUBMITTED.value))
        ).scalars().all()

        return BillingSummaryOut(
            generated_at=datetime.now(timezone.utc),
            enforced=await ent.enforced(),
            collected_this_month_pkr=by_month.get(this_month, 0),
            collected_last_month_pkr=by_month.get(last_month, 0),
            collected_all_time_pkr=all_time,
            months=[MonthCollectedOut(month=m, collected_pkr=by_month.get(m, 0)) for m in months],
            recurring_pkr=recurring,
            trial_value_pkr=trial_value,
            at_risk_pkr=at_risk,
            outstanding=InvoiceTotalsOut(count=len(invoices), total_pkr=sum(i.total_pkr for i in invoices)),
            overdue=InvoiceTotalsOut(count=len(overdue_invoices), total_pkr=sum(i.total_pkr for i in overdue_invoices)),
            screenshots_to_check=len(waiting),
            owners=counts,
            by_feature=list(per_feature.values()),
            notes=[
                "Money is whole PKR. 'Collected' is approved payments minus reversals, counted in the Pakistan month they were approved.",
                "'Recurring' is the monthly value of features that are paid for or overdue (still inside the grace days). "
                "Features still in their free trial are listed separately and are not revenue yet.",
                "Cancelled features and features not on sale are not billed and are left out.",
            ],
        )

    # ---- per owner ----------------------------------------------------------------------------------------------------

    async def owners(self, *, search: str | None = None, today: date | None = None) -> list[OwnerBillingRowOut]:
        today = today or pkt_today()
        ent = self.entitlements

        owner_ids = set((await self.db.execute(select(OwnerFeature.owner_id))).scalars()) | set(
            (await self.db.execute(select(OwnerInvoice.owner_id))).scalars()
        )
        if not owner_ids:
            return []
        users = {u.id: u for u in (await self.db.execute(select(User).where(User.id.in_(owner_ids)))).scalars()}

        states: dict[uuid.UUID, set[str]] = defaultdict(set)
        on: dict[uuid.UUID, int] = defaultdict(int)
        next_due: dict[uuid.UUID, date] = {}
        for row, _feature in await ent.billable_rows():
            e = ent.row_state(row, today)
            states[row.owner_id].add(classify(e.reason))
            on[row.owner_id] += 1
            if e.entitled and e.until is not None:
                next_due[row.owner_id] = min(e.until, next_due.get(row.owner_id, e.until))

        outstanding: dict[uuid.UUID, int] = defaultdict(int)
        for inv in (await self.db.execute(select(OwnerInvoice).where(OwnerInvoice.status.in_(OPEN_INVOICE)))).scalars():
            outstanding[inv.owner_id] += inv.total_pkr
        collected: dict[uuid.UUID, int] = defaultdict(int)
        last_paid: dict[uuid.UUID, datetime] = {}
        money = list((await self.db.execute(select(OwnerPayment).where(OwnerPayment.status.in_(MONEY_IN)))).scalars())
        reversed_ids = {p.reverses_payment_id for p in money if p.reverses_payment_id is not None}
        for p in money:
            collected[p.owner_id] += p.amount_pkr
            # "last payment" is the last one that still stands: a reversed payment is not money the owner has paid
            if p.status == OwnerPaymentStatus.APPROVED.value and p.id not in reversed_ids:
                at = p.reviewed_at or p.created_at
                if p.owner_id not in last_paid or at > last_paid[p.owner_id]:
                    last_paid[p.owner_id] = at

        needle = (search or "").strip().lower()
        out = []
        for oid in owner_ids:
            u = users.get(oid)
            if u is None or (needle and needle not in (u.name or "").lower() and needle not in u.phone.lower()):
                continue
            s = states.get(oid, set())
            state = next((k for k in ("off", "overdue", "paying", "trial") if k in s), "none")
            out.append(
                OwnerBillingRowOut(
                    owner_id=oid, name=u.name, phone=u.phone, features_on=on.get(oid, 0),
                    monthly_pkr=await ent.monthly_total_pkr(oid, today=today), state=state,
                    outstanding_pkr=outstanding.get(oid, 0), collected_pkr=collected.get(oid, 0),
                    last_payment_at=last_paid.get(oid), next_due=next_due.get(oid),
                )
            )
        out.sort(key=lambda r: (STATE_ORDER[r.state], -r.outstanding_pkr, (r.name or "").lower()))
        return out

    async def owner_detail(self, owner_id: uuid.UUID, *, today: date | None = None) -> OwnerBillingDetailOut:
        today = today or pkt_today()
        ent = self.entitlements
        user = await self.db.get(User, owner_id)
        if user is None or user.role != UserRole.OWNER:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.USER_NOT_FOUND, "Owner not found.")
        catalog = await ent.catalog()

        features = []
        rows = (
            await self.db.execute(select(OwnerFeature).where(OwnerFeature.owner_id == owner_id).order_by(OwnerFeature.feature_key))
        ).scalars()
        for r in rows:
            e = ent.row_state(r, today)
            features.append(
                OwnerFeatureBillingOut(
                    key=r.feature_key, label=catalog[r.feature_key].label if r.feature_key in catalog else r.feature_key,
                    price_pkr=r.price_pkr, state=e.reason, entitled=e.entitled, status=r.status,
                    renewing=r.auto_renew and r.status != "cancelled", enabled_at=r.enabled_at,
                    trial_ends_on=ent.trial_last_day(r), paid_through=r.paid_through,
                    works_until=e.until if e.entitled else None,
                )
            )

        invoices = list(
            (
                await self.db.execute(
                    select(OwnerInvoice).where(OwnerInvoice.owner_id == owner_id).order_by(OwnerInvoice.period_start.desc()).limit(36)
                )
            ).scalars()
        )
        ids = [i.id for i in invoices]
        lines: dict[uuid.UUID, list[InvoiceLineOut]] = defaultdict(list)
        pays: dict[uuid.UUID, list[OwnerPaymentRowOut]] = defaultdict(list)
        if ids:
            for ln in (
                await self.db.execute(select(OwnerInvoiceLine).where(OwnerInvoiceLine.invoice_id.in_(ids)).order_by(OwnerInvoiceLine.feature_key))
            ).scalars():
                lines[ln.invoice_id].append(InvoiceLineOut.model_validate(ln))
            for p in (
                await self.db.execute(select(OwnerPayment).where(OwnerPayment.invoice_id.in_(ids)).order_by(OwnerPayment.created_at))
            ).scalars():
                pays[p.invoice_id].append(
                    OwnerPaymentRowOut(
                        id=p.id, amount_pkr=p.amount_pkr, method=p.method, status=p.status, note=p.note,
                        reference=p.reference, rejection_reason=p.rejection_reason, created_at=p.created_at,
                        reviewed_at=p.reviewed_at,
                    )
                )
        collected = sum(
            p.amount_pkr for plist in pays.values() for p in plist if p.status in MONEY_IN
        )
        return OwnerBillingDetailOut(
            owner_id=owner_id, name=user.name, phone=user.phone, email=user.email, enforced=await ent.enforced(),
            monthly_pkr=await ent.monthly_total_pkr(owner_id, today=today),
            outstanding_pkr=sum(i.total_pkr for i in invoices if i.status in OPEN_INVOICE),
            collected_pkr=collected, features=features,
            invoices=[
                OwnerInvoiceDetailOut(
                    id=i.id, period_start=i.period_start, period_end=i.period_end, total_pkr=i.total_pkr, status=i.status,
                    due_date=i.due_date, paid_at=i.paid_at, created_at=i.created_at, lines=lines[i.id], payments=pays[i.id],
                )
                for i in invoices
            ],
        )
