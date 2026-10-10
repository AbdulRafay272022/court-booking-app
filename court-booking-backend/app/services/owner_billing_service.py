"""Owner premium billing, step 2: the admin price list, an owner choosing their features, and invoice generation.

Cycles are PKT calendar months. A feature's first invoice runs from the day after its free trial to the end of that month
(prorated by days when that is mid-month); every invoice after that is a whole month. One invoice per owner covers every
feature that is due, so a single transfer pays for the lot.

Invoices are only generated while `owner_billing_enforced` is ON: with it off every feature is free for everyone and a bill
would be a lie. Paying an invoice (and moving `paid_through`) is step 3; this module never changes `paid_through`.
"""

import calendar
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.owner_billing import (
    InvoiceStatus,
    OwnerFeature,
    OwnerFeatureStatus,
    OwnerInvoice,
    OwnerInvoiceLine,
    PremiumFeature,
)
from app.models.user import User
import structlog

from app.services.audit_service import AuditService
from app.services.entitlement_service import SELLABLE_KEYS, EntitlementService
from app.services.notification_service import NotificationService
from app.utils.timezone import pkt_today

logger = structlog.get_logger(__name__)

# one message per owner per kind per period; the notice level decides which
REMINDER_EVENTS = {
    "info": ("premium_renewal_reminder", "Premium renewal due"),
    "urgent": ("premium_payment_overdue", "Premium payment overdue"),
    "off": ("premium_feature_lapsed", "Premium feature switched off"),
}

INVOICE_LEAD_DAYS = 7  # an invoice is issued this many days before the period it pays for starts


def month_end(d: date) -> date:
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def prorate(price_pkr: int, start: date) -> tuple[int, int | None]:
    """(amount, prorated_days) for a period that starts on `start` and runs to the end of that month. A period starting on the
    1st is a whole month (no proration). Whole PKR, rounded half up."""
    end = month_end(start)
    if start.day == 1:
        return price_pkr, None
    days = (end - start).days + 1
    total_days = end.day
    return (price_pkr * days * 2 + total_days) // (total_days * 2), days


class OwnerBillingService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.audit = AuditService(db)
        self.entitlements = EntitlementService(db, settings)

    # ---- admin: the price list ----------------------------------------------------------------------------------------

    async def list_features(self) -> list[PremiumFeature]:
        rows = (await self.db.execute(select(PremiumFeature))).scalars().all()
        order = {k: i for i, k in enumerate(SELLABLE_KEYS)}
        return sorted(rows, key=lambda r: order.get(r.key, 99))

    async def update_feature(
        self, key: str, admin: User, *, monthly_price_pkr: int | None, is_sellable: bool | None
    ) -> PremiumFeature:
        feature = await self.db.get(PremiumFeature, key)
        if feature is None:
            raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.FEATURE_NOT_AVAILABLE, "No such premium feature.")
        before = {"monthly_price_pkr": feature.monthly_price_pkr, "is_sellable": feature.is_sellable}
        price = feature.monthly_price_pkr if monthly_price_pkr is None else monthly_price_pkr
        sellable = feature.is_sellable if is_sellable is None else is_sellable
        if sellable and price <= 0:
            raise AppError(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                ErrorCode.INVALID_PRICE,
                "A feature that owners can buy needs a price above zero. Set the price first, or leave it not for sale.",
            )
        feature.monthly_price_pkr = price
        feature.is_sellable = sellable
        feature.updated_by_user_id = admin.id
        await self.audit.log(
            actor_user_id=admin.id,
            actor_type="admin",
            action="premium_feature.updated",
            entity_type="premium_feature",
            entity_id=uuid.uuid5(uuid.NAMESPACE_URL, f"premium_feature:{key}"),
            old_value={"key": key, **before},
            new_value={"key": key, "monthly_price_pkr": price, "is_sellable": sellable},
        )
        await self.db.commit()
        await self.db.refresh(feature)
        return feature

    # ---- owner: choose features ---------------------------------------------------------------------------------------

    async def set_selection(self, owner: User, feature_keys: list[str]) -> None:
        """Make the owner's switched-on set exactly `feature_keys`. Enabling starts that feature's free trial (once ever: the
        row is kept when an owner cancels, so switching it on again does not restart the clock). Leaving a feature out cancels
        it: no more invoices, and it keeps working until the end of what is already paid or the trial."""
        wanted = list(dict.fromkeys(feature_keys))
        catalog = {f.key: f for f in await self.list_features()}
        for key in wanted:
            feature = catalog.get(key)
            if feature is None or not feature.is_sellable:
                raise AppError(
                    status.HTTP_400_BAD_REQUEST,
                    ErrorCode.FEATURE_NOT_AVAILABLE,
                    "That feature is not available to buy right now.",
                    details={"feature_key": key},
                )
        rows = {
            r.feature_key: r
            for r in (await self.db.execute(select(OwnerFeature).where(OwnerFeature.owner_id == owner.id))).scalars()
        }
        now = datetime.now(timezone.utc)
        for key in wanted:
            row = rows.get(key)
            price = catalog[key].monthly_price_pkr
            if row is None:
                self.db.add(OwnerFeature(owner_id=owner.id, feature_key=key, price_pkr=price, enabled_at=now))
                await self._audit_owner(owner, "owner_feature.enabled", key, {"price_pkr": price})
            elif row.status == OwnerFeatureStatus.CANCELLED.value or not row.auto_renew:
                row.status = OwnerFeatureStatus.ACTIVE.value
                row.auto_renew = True
                row.cancelled_at = None
                row.price_pkr = price  # coming back signs up at today's list price; the trial is NOT restarted
                await self._audit_owner(owner, "owner_feature.re_enabled", key, {"price_pkr": price})
        for key, row in rows.items():
            if key not in wanted and row.status != OwnerFeatureStatus.CANCELLED.value:
                row.status = OwnerFeatureStatus.CANCELLED.value
                row.auto_renew = False
                row.cancelled_at = now
                await self._audit_owner(owner, "owner_feature.cancelled", key, {})
        try:
            await self.db.commit()
        except IntegrityError:  # a double tap raced the same insert: the other request already did it
            await self.db.rollback()

    async def _audit_owner(self, owner: User, action: str, key: str, new_value: dict) -> None:
        await self.audit.log(
            actor_user_id=owner.id,
            actor_type="owner",
            action=action,
            entity_type="owner_feature",
            entity_id=owner.id,
            new_value={"feature_key": key, **new_value},
        )

    # ---- invoices ---------------------------------------------------------------------------------------------------------

    async def invoices_for_owner(self, owner_id: uuid.UUID, *, limit: int = 12) -> list[tuple[OwnerInvoice, list[OwnerInvoiceLine]]]:
        invoices = (
            await self.db.execute(
                select(OwnerInvoice)
                .where(OwnerInvoice.owner_id == owner_id, OwnerInvoice.status != InvoiceStatus.VOID.value)
                .order_by(OwnerInvoice.period_start.desc(), OwnerInvoice.created_at.desc())
                .limit(limit)
            )
        ).scalars().all()
        out = []
        for inv in invoices:
            lines = (
                await self.db.execute(
                    select(OwnerInvoiceLine).where(OwnerInvoiceLine.invoice_id == inv.id).order_by(OwnerInvoiceLine.feature_key)
                )
            ).scalars().all()
            out.append((inv, list(lines)))
        return out

    async def generate_for_owner(self, owner_id: uuid.UUID, *, today: date | None = None, force: bool = False) -> OwnerInvoice | None:
        """Issue one invoice covering every feature of this owner that is due, or None when nothing is. `force` skips the
        enforcement check (tests and a future admin "bill now" action); the job never sets it."""
        today = today or pkt_today()
        if not force and not await self.entitlements.enforced():
            return None
        catalog = await self.entitlements.catalog()
        rows = (
            await self.db.execute(
                select(OwnerFeature).where(
                    OwnerFeature.owner_id == owner_id,
                    OwnerFeature.auto_renew.is_(True),
                    OwnerFeature.status != OwnerFeatureStatus.CANCELLED.value,
                )
            )
        ).scalars().all()
        lines: list[tuple[OwnerFeature, date, date, int, int | None]] = []
        for row in rows:
            feature = catalog.get(row.feature_key)
            if feature is None or not feature.is_sellable:
                continue  # taken off sale: nothing new is billed for it
            covered_to = max(d for d in (row.paid_through, self.entitlements.trial_last_day(row)) if d is not None)
            start = covered_to + timedelta(days=1)
            if start > today + timedelta(days=INVOICE_LEAD_DAYS):
                continue  # not due yet
            if await self._already_invoiced(owner_id, row.feature_key, start):
                continue
            amount, days = prorate(row.price_pkr, start)
            lines.append((row, start, month_end(start), amount, days))
        if not lines:
            return None

        first_start = min(start for _r, start, _e, _a, _d in lines)
        invoice = OwnerInvoice(
            owner_id=owner_id,
            period_start=first_start,
            period_end=max(end for _r, _s, end, _a, _d in lines),
            total_pkr=sum(amount for _r, _s, _e, amount, _d in lines),
            status=InvoiceStatus.ISSUED.value,
            due_date=max(first_start, today),
        )
        self.db.add(invoice)
        try:
            await self.db.flush()
        except IntegrityError:  # an invoice for that period already exists (a repeated run): nothing to do
            await self.db.rollback()
            return None
        for row, start, end, amount, days in lines:
            label = catalog[row.feature_key].label
            span = f"{start.day} {start.strftime('%b')} to {end.day} {end.strftime('%b')}"
            self.db.add(
                OwnerInvoiceLine(
                    invoice_id=invoice.id,
                    feature_key=row.feature_key,
                    amount_pkr=amount,
                    description=f"{label}, {span}" + (f" (prorated, {days} days)" if days else ""),
                    period_start=start,
                    period_end=end,
                    prorated_days=days,
                )
            )
        await self.audit.log(
            actor_user_id=None,
            actor_type="system",
            action="owner_invoice.issued",
            entity_type="owner_invoice",
            entity_id=invoice.id,
            new_value={"owner_id": str(owner_id), "total_pkr": invoice.total_pkr, "features": [r.feature_key for r, *_ in lines]},
        )
        await self.db.commit()
        await self.db.refresh(invoice)
        return invoice

    async def _already_invoiced(self, owner_id: uuid.UUID, feature_key: str, start: date) -> bool:
        """Is there already a live invoice line for this feature that covers `start`?"""
        found = await self.db.scalar(
            select(OwnerInvoiceLine.id)
            .join(OwnerInvoice, OwnerInvoice.id == OwnerInvoiceLine.invoice_id)
            .where(
                OwnerInvoice.owner_id == owner_id,
                OwnerInvoice.status != InvoiceStatus.VOID.value,
                OwnerInvoiceLine.feature_key == feature_key,
                OwnerInvoiceLine.period_end >= start,
            )
            .limit(1)
        )
        return found is not None

    async def generate_all(self, *, today: date | None = None) -> dict:
        """The daily job: invoice every owner with something due. A no-op while enforcement is off."""
        if not await self.entitlements.enforced():
            return {"enforced": False, "invoices_issued": 0}
        owner_ids = (
            await self.db.execute(select(OwnerFeature.owner_id).where(OwnerFeature.auto_renew.is_(True)).distinct())
        ).scalars().all()
        issued = 0
        for owner_id in owner_ids:
            try:
                if await self.generate_for_owner(owner_id, today=today):
                    issued += 1
            except Exception:  # noqa: BLE001 -- one owner's failure never stops the others
                await self.db.rollback()
        return {"enforced": True, "owners_checked": len(owner_ids), "invoices_issued": issued}

    # ---- the daily lapse job ----------------------------------------------------------------------------------------------

    async def refresh_statuses(self, *, today: date | None = None) -> dict:
        """Write down where each switched-on feature stands: active while covered, past_due during the grace days (it still
        works), lapsed after. The gates read the dates, not this column, so a late run changes nothing for anyone; it keeps
        the admin's lists honest. A cancelled feature is left alone. A no-op while enforcement is off."""
        today = today or pkt_today()
        if not await self.entitlements.enforced():
            return {"changed": 0}
        changed = 0
        for row, _feature in await self.entitlements.billable_rows():
            end = self.entitlements.covered_until(row)
            if today <= end:
                new = OwnerFeatureStatus.ACTIVE.value
            elif today <= end + self.entitlements.grace():
                new = OwnerFeatureStatus.PAST_DUE.value
            else:
                new = OwnerFeatureStatus.LAPSED.value
            if row.status != new:
                row.status = new
                changed += 1
        await self.db.commit()
        return {"changed": changed}

    async def send_reminders(self, *, today: date | None = None) -> dict:
        """A push/WhatsApp message when a period is about to end, when payment is overdue, and when a feature has switched
        off: one per owner per kind per period (de-duplicated through notification_log, so running the job twice, or late,
        never repeats it). WhatsApp outside its 24-hour window may not deliver, which is why the in-app banner is the reliable
        warning; this is the nudge on top of it."""
        today = today or pkt_today()
        if not await self.entitlements.enforced():
            return {"sent": 0}
        by_owner: dict[uuid.UUID, dict[str, list]] = defaultdict(lambda: defaultdict(list))
        for row, feature in await self.entitlements.billable_rows():
            notice = self.entitlements.notice_for(row, feature.label, today)
            if notice is not None:
                by_owner[row.owner_id][notice.level].append((row, notice))
        notifier = NotificationService(self.db, self.settings)
        sent = 0
        for owner_id, groups in by_owner.items():
            owner = await self.db.get(User, owner_id)
            if owner is None:
                continue
            for level, items in groups.items():
                event, title = REMINDER_EVENTS[level]
                anchor = min(self.entitlements.covered_until(r) for r, _n in items)
                reference = uuid.uuid5(owner_id, f"premium:{event}:{anchor.isoformat()}")
                try:
                    if await notifier.has_sent(owner_id, event, reference):
                        continue
                    await notifier._send_push_and_whatsapp(
                        owner, event, title, " ".join(n.message for _r, n in items), reference_id=reference
                    )
                    await self.db.commit()
                    sent += 1
                except Exception:  # noqa: BLE001 -- one owner's failure never stops the others
                    logger.warning("owner_billing.reminder_failed", owner_id=str(owner_id), exc_info=True)
                    await self.db.rollback()
        return {"sent": sent}
