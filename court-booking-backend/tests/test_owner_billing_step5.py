"""Owner premium billing, step 5: the admin revenue dashboard and the per-owner billing view (read-only)."""

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest

from app.config import get_settings
from app.models.feature_flag import FeatureFlag
from app.models.owner_billing import OwnerFeature, OwnerInvoice, OwnerInvoiceLine, OwnerPayment, PremiumFeature
from app.models.user import UserRole
from app.services.admin_billing_report_service import AdminBillingReportService
from app.services.entitlement_service import SELLABLE_KEYS, EntitlementService
from app.utils.timezone import pkt_time_to_utc, pkt_today

TODAY = date(2026, 10, 20)
A, B, C, D, E_ = "ai_chat_booking", "auto_approve", "digest_reminders", "growth_suggestions", "marketing_announcements"


def at(d: date) -> datetime:
    return pkt_time_to_utc(d, time(12, 0))


@pytest.fixture
def world(db_session_factory, make_user, make_auth_headers):
    class World:
        async def setup(self, *, enforced=True):
            async with db_session_factory() as s:
                for key in SELLABLE_KEYS:
                    s.add(PremiumFeature(key=key, label=key.replace("_", " ").title(), monthly_price_pkr=1000, is_sellable=True))
                s.add(FeatureFlag(key="owner_billing_enforced", enabled=enforced, label="x"))
                await s.commit()
            self.admin = await make_user("+923098000001", role=UserRole.ADMIN, name="Admin")
            self.admin_h = await make_auth_headers(self.admin)
            return self

        async def owner(self, phone, name=None):
            return await make_user(phone, role=UserRole.OWNER, name=name or f"Owner {phone[-2:]}")

        async def feature(self, owner, key, *, enabled: date, paid_through=None, price=1000, status="active", auto_renew=True):
            async with db_session_factory() as s:
                s.add(OwnerFeature(owner_id=owner.id, feature_key=key, price_pkr=price, status=status, auto_renew=auto_renew,
                                   enabled_at=at(enabled), paid_through=paid_through))
                await s.commit()

        async def invoice(self, owner, *, start: date, total=1000, status="issued", due: date | None = None, line_key=B):
            async with db_session_factory() as s:
                inv = OwnerInvoice(owner_id=owner.id, period_start=start, period_end=start + timedelta(days=29), total_pkr=total,
                                   status=status, due_date=due or start)
                s.add(inv)
                await s.flush()
                s.add(OwnerInvoiceLine(invoice_id=inv.id, feature_key=line_key, amount_pkr=total, description="x",
                                       period_start=start, period_end=start + timedelta(days=29)))
                await s.commit()
                return inv.id

        async def payment(self, owner, invoice_id, amount, *, when: date, status="approved", reverses=None):
            async with db_session_factory() as s:
                p = OwnerPayment(invoice_id=invoice_id, owner_id=owner.id, amount_pkr=amount, status=status, method="bank_transfer",
                                 reviewed_at=at(when) if status != "submitted" else None, reverses_payment_id=reverses)
                s.add(p)
                await s.commit()
                return p.id

        def report(self, session):
            return AdminBillingReportService(session, get_settings())

    return World()


# --- classification matches the gates ---------------------------------------------------------------------------------------


async def test_every_feature_is_classified_the_way_the_gates_decide(world, db_session_factory):
    await world.setup()
    trial = await world.owner("+923098100001")
    paid = await world.owner("+923098100002")
    grace = await world.owner("+923098100003")
    lapsed = await world.owner("+923098100004")
    unpaid = await world.owner("+923098100005")
    old = TODAY - timedelta(days=100)
    await world.feature(trial, A, enabled=TODAY - timedelta(days=3))
    await world.feature(paid, B, enabled=old, paid_through=TODAY + timedelta(days=5))
    await world.feature(grace, C, enabled=old, paid_through=TODAY - timedelta(days=2))
    await world.feature(lapsed, D, enabled=old, paid_through=TODAY - timedelta(days=30))
    await world.feature(unpaid, E_, enabled=old)

    async with db_session_factory() as s:
        summary = await world.report(s).summary(today=TODAY)
        ent = EntitlementService(s, get_settings())
        for owner, key, want in (
            (trial, A, "trial"), (paid, B, "paying"), (grace, C, "overdue"), (lapsed, D, "off"), (unpaid, E_, "off"),
        ):
            state = await ent.state(owner.id, key, today=TODAY)
            from app.services.admin_billing_report_service import classify

            assert classify(state.reason) == want, (key, state.reason)

    f = {x.key: x for x in summary.by_feature}
    assert (f[A].on_trial, f[B].paying, f[C].overdue, f[D].off, f[E_].off) == (1, 1, 1, 1, 1)
    assert summary.recurring_pkr == 2000  # paying + overdue, 1000 each
    assert summary.trial_value_pkr == 1000  # a trial is not revenue
    assert summary.at_risk_pkr == 2000  # lapsed + unpaid
    c = summary.owners
    assert (c.with_premium, c.on_trial_only, c.paying, c.overdue, c.off) == (5, 1, 1, 1, 2)


async def test_cancelled_non_renewing_and_unsellable_features_are_not_counted(world, db_session_factory):
    await world.setup()
    o = await world.owner("+923098100011")
    old = TODAY - timedelta(days=100)
    await world.feature(o, A, enabled=old, paid_through=TODAY + timedelta(days=5), status="cancelled")
    await world.feature(o, B, enabled=old, paid_through=TODAY + timedelta(days=5), auto_renew=False)
    await world.feature(o, C, enabled=old, paid_through=TODAY + timedelta(days=5))
    async with db_session_factory() as s:
        p = await s.get(PremiumFeature, C)
        p.is_sellable = False  # an admin took it off sale
        await s.commit()
    async with db_session_factory() as s:
        summary = await world.report(s).summary(today=TODAY)
    assert summary.recurring_pkr == 0
    assert summary.owners.with_premium == 0
    assert all(f.owners_on == 0 for f in summary.by_feature)


async def test_price_each_owner_signed_up_at_is_used_not_todays_list_price(world, db_session_factory):
    await world.setup()
    o = await world.owner("+923098100021")
    await world.feature(o, B, enabled=TODAY - timedelta(days=100), paid_through=TODAY + timedelta(days=5), price=750)
    async with db_session_factory() as s:
        summary = await world.report(s).summary(today=TODAY)
        row = next(x for x in summary.by_feature if x.key == B)
    assert row.recurring_pkr == 750 and row.list_price_pkr == 1000
    assert summary.recurring_pkr == 750


# --- money collected ----------------------------------------------------------------------------------------------------------


async def test_collected_is_net_of_reversals_and_counted_in_the_month_it_happened(world, db_session_factory):
    await world.setup()
    o = await world.owner("+923098100031")
    inv = await world.invoice(o, start=date(2026, 9, 1), status="paid")
    inv2 = await world.invoice(o, start=date(2026, 10, 1), status="paid")
    inv3 = await world.invoice(o, start=date(2026, 8, 1), status="paid")
    await world.payment(o, inv, 5000, when=date(2026, 9, 12))  # last month
    good = await world.payment(o, inv2, 3000, when=date(2026, 10, 5))  # this month
    mistake = await world.payment(o, inv3, 700, when=date(2026, 10, 6))  # approved this month ...
    await world.payment(o, inv3, -700, when=date(2026, 10, 9), status="reversal", reverses=mistake)  # ... and reversed
    await world.payment(o, inv2, 999, when=date(2026, 10, 7), status="rejected")  # never counts
    await world.payment(o, inv2, 888, when=date(2026, 10, 8), status="submitted")  # not yet money
    assert good

    async with db_session_factory() as s:
        r = await world.report(s).summary(today=TODAY)
    assert r.collected_this_month_pkr == 3000
    assert r.collected_last_month_pkr == 5000
    assert r.collected_all_time_pkr == 8000
    months = {m.month: m.collected_pkr for m in r.months}
    assert len(r.months) == 6 and r.months[-1].month == "2026-10"
    assert months["2026-10"] == 3000 and months["2026-09"] == 5000 and months["2026-05"] == 0
    assert r.screenshots_to_check == 1


async def test_a_payment_at_the_pakistan_month_boundary_goes_in_the_right_month(world, db_session_factory):
    await world.setup()
    o = await world.owner("+923098100041")
    inv = await world.invoice(o, start=date(2026, 9, 1), status="paid")
    # 00:30 on 1 Oct Pakistan time is 19:30 on 30 Sep UTC
    async with db_session_factory() as s:
        s.add(OwnerPayment(invoice_id=inv, owner_id=o.id, amount_pkr=1234, status="approved", method="bank_transfer",
                           reviewed_at=pkt_time_to_utc(date(2026, 10, 1), time(0, 30))))
        await s.commit()
    async with db_session_factory() as s:
        r = await world.report(s).summary(today=TODAY)
    assert r.collected_this_month_pkr == 1234 and r.collected_last_month_pkr == 0


async def test_outstanding_and_overdue_invoices(world, db_session_factory):
    await world.setup()
    o = await world.owner("+923098100051")
    await world.invoice(o, start=date(2026, 9, 1), total=2000, status="issued", due=date(2026, 9, 25))  # overdue
    await world.invoice(o, start=date(2026, 10, 1), total=3000, status="proof_submitted", due=date(2026, 10, 18))  # overdue
    await world.invoice(o, start=date(2026, 11, 1), total=4000, status="issued", due=date(2026, 10, 25))  # not yet
    await world.invoice(o, start=date(2026, 8, 1), total=9999, status="paid", due=date(2026, 8, 1))
    await world.invoice(o, start=date(2026, 7, 1), total=8888, status="void", due=date(2026, 7, 1))
    async with db_session_factory() as s:
        r = await world.report(s).summary(today=TODAY)
    assert (r.outstanding.count, r.outstanding.total_pkr) == (3, 9000)
    assert (r.overdue.count, r.overdue.total_pkr) == (2, 5000)


async def test_an_empty_platform_reports_zeros_not_errors(world, db_session_factory):
    await world.setup()
    async with db_session_factory() as s:
        r = await world.report(s).summary(today=TODAY)
        owners = await world.report(s).owners(today=TODAY)
    assert r.recurring_pkr == r.collected_all_time_pkr == r.outstanding.total_pkr == 0
    assert len(r.by_feature) == 6 and owners == []


async def test_figures_are_still_computed_while_billing_is_not_enforced(world, db_session_factory):
    await world.setup(enforced=False)
    o = await world.owner("+923098100061")
    await world.feature(o, B, enabled=TODAY - timedelta(days=100), paid_through=TODAY + timedelta(days=5))
    async with db_session_factory() as s:
        r = await world.report(s).summary(today=TODAY)
    assert r.enforced is False and r.recurring_pkr == 1000


# --- per owner ----------------------------------------------------------------------------------------------------------------


async def test_owner_list_puts_the_worst_first_and_carries_the_money(world, db_session_factory):
    await world.setup()
    fine = await world.owner("+923098200001", "Fine Owner")
    late = await world.owner("+923098200002", "Late Owner")
    gone = await world.owner("+923098200003", "Gone Owner")
    old = TODAY - timedelta(days=100)
    await world.feature(fine, B, enabled=old, paid_through=TODAY + timedelta(days=10))
    await world.feature(late, B, enabled=old, paid_through=TODAY - timedelta(days=1))
    await world.feature(gone, B, enabled=old, paid_through=TODAY - timedelta(days=40))
    inv = await world.invoice(fine, start=date(2026, 9, 1), total=1000, status="paid")
    await world.payment(fine, inv, 1000, when=date(2026, 9, 3))
    await world.invoice(late, start=date(2026, 10, 1), total=1000, status="issued", due=date(2026, 10, 10))
    lj = await world.invoice(late, start=date(2026, 8, 1), total=1000, status="issued", due=date(2026, 8, 1))
    wrong = await world.payment(late, lj, 1000, when=date(2026, 8, 3))
    await world.payment(late, lj, -1000, when=date(2026, 8, 5), status="reversal", reverses=wrong)

    async with db_session_factory() as s:
        rows = await world.report(s).owners(today=TODAY)
        only = await world.report(s).owners(search="late", today=TODAY)
        by_phone = await world.report(s).owners(search="200001", today=TODAY)
    assert [r.name for r in rows] == ["Gone Owner", "Late Owner", "Fine Owner"]
    assert [r.state for r in rows] == ["off", "overdue", "paying"]
    fine_row = rows[2]
    assert fine_row.collected_pkr == 1000 and fine_row.outstanding_pkr == 0 and fine_row.next_due == TODAY + timedelta(days=10)
    assert rows[1].outstanding_pkr == 2000  # the reopened August invoice and October
    assert rows[0].next_due is None  # nothing of theirs is working
    assert [r.name for r in only] == ["Late Owner"]
    assert rows[1].last_payment_at is None  # a reversed payment is not a last payment
    assert fine_row.last_payment_at is not None
    assert [r.name for r in by_phone] == ["Fine Owner"]


async def test_owner_detail_shows_features_invoices_and_every_payment(world, db_session_factory):
    await world.setup()
    o = await world.owner("+923098200011", "Detail Owner")
    await world.feature(o, B, enabled=TODAY - timedelta(days=100), paid_through=TODAY + timedelta(days=4))
    await world.feature(o, A, enabled=TODAY - timedelta(days=2))
    inv = await world.invoice(o, start=date(2026, 9, 1), total=1000, status="paid")
    await world.payment(o, inv, 1000, when=date(2026, 9, 3))
    await world.payment(o, inv, 1000, when=date(2026, 9, 2), status="rejected")
    async with db_session_factory() as s:
        d = await world.report(s).owner_detail(o.id, today=TODAY)
    states = {f.key: f for f in d.features}
    assert states[B].state == "paid" and states[B].works_until == TODAY + timedelta(days=4)
    assert states[A].state == "trial" and states[A].trial_ends_on == TODAY - timedelta(days=2) + timedelta(days=14)
    assert d.collected_pkr == 1000 and d.outstanding_pkr == 0 and d.monthly_pkr == 2000
    assert len(d.invoices) == 1 and len(d.invoices[0].lines) == 1
    assert sorted(p.status for p in d.invoices[0].payments) == ["approved", "rejected"]


async def test_lapsed_feature_reports_no_working_until_date(world, db_session_factory):
    await world.setup()
    o = await world.owner("+923098200021")
    await world.feature(o, B, enabled=TODAY - timedelta(days=100), paid_through=TODAY - timedelta(days=40))
    async with db_session_factory() as s:
        d = await world.report(s).owner_detail(o.id, today=TODAY)
    assert d.features[0].state == "lapsed" and d.features[0].entitled is False and d.features[0].works_until is None


# --- the endpoints -------------------------------------------------------------------------------------------------------------


async def test_endpoints_are_admin_only(client, world, make_auth_headers):
    await world.setup()
    o = await world.owner("+923098300001")
    h = await make_auth_headers(o)
    for path in ("summary", "owners", f"owners/{o.id}"):
        assert (await client.get(f"/api/v1/admin/owner-billing/{path}", headers=h)).status_code == 403
        assert (await client.get(f"/api/v1/admin/owner-billing/{path}")).status_code in (401, 403)


async def test_endpoints_return_the_reports(client, world):
    await world.setup()
    o = await world.owner("+923098300011", "Api Owner")
    today = pkt_today()
    await world.feature(o, B, enabled=today - timedelta(days=100), paid_through=today + timedelta(days=3))
    inv = await world.invoice(o, start=today.replace(day=1), total=1000, status="paid")
    await world.payment(o, inv, 1000, when=today)

    s = await client.get("/api/v1/admin/owner-billing/summary", headers=world.admin_h)
    assert s.status_code == 200
    body = s.json()
    assert body["recurring_pkr"] == 1000 and body["collected_this_month_pkr"] == 1000 and body["enforced"] is True

    lst = await client.get("/api/v1/admin/owner-billing/owners?search=api", headers=world.admin_h)
    assert lst.status_code == 200 and [r["name"] for r in lst.json()] == ["Api Owner"]

    det = await client.get(f"/api/v1/admin/owner-billing/owners/{o.id}", headers=world.admin_h)
    assert det.status_code == 200 and det.json()["features"][0]["state"] == "paid"


async def test_detail_for_a_player_or_missing_user_is_404(client, world, make_user):
    await world.setup()
    player = await make_user("+923098300021", role=UserRole.PLAYER)
    for uid in (player.id, uuid.uuid4()):
        assert (await client.get(f"/api/v1/admin/owner-billing/owners/{uid}", headers=world.admin_h)).status_code == 404
