"""Owner premium billing, step 2: the admin price list, an owner choosing features, and invoice generation."""

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models.audit import AuditLog
from app.models.feature_flag import FeatureFlag
from app.models.owner_billing import OwnerFeature, OwnerInvoice, OwnerInvoiceLine, PremiumFeature
from app.models.user import UserRole
from app.services.entitlement_service import SELLABLE_KEYS
from app.services.owner_billing_service import OwnerBillingService, month_end, prorate
from app.utils.timezone import pkt_today


@pytest.fixture
def catalog(db_session_factory):
    """The six price-list rows as the migration seeds them (price 0, not for sale), plus helpers to price/enforce."""

    class Catalog:
        async def seed(self):
            async with db_session_factory() as session:
                for key in SELLABLE_KEYS:
                    session.add(PremiumFeature(key=key, label=key.replace("_", " ").title(), monthly_price_pkr=0, is_sellable=False))
                await session.commit()

        async def price(self, key, price, sellable=True):
            async with db_session_factory() as session:
                feature = await session.get(PremiumFeature, key)
                feature.monthly_price_pkr, feature.is_sellable = price, sellable
                await session.commit()

        async def enforce(self, on=True):
            async with db_session_factory() as session:
                existing = await session.get(FeatureFlag, "owner_billing_enforced")
                if existing:
                    existing.enabled = on
                else:
                    session.add(FeatureFlag(key="owner_billing_enforced", enabled=on, label="Owner billing enforcement"))
                await session.commit()

    return Catalog()


# --- admin: the price list ------------------------------------------------------------------------------------------------


async def test_only_an_admin_can_see_or_change_prices(client, catalog, make_user, make_auth_headers):
    await catalog.seed()
    owner = await make_user("+923099000001", role=UserRole.OWNER)
    headers = await make_auth_headers(owner)
    assert (await client.get("/api/v1/admin/premium-features", headers=headers)).status_code == 403
    assert (await client.patch("/api/v1/admin/premium-features/auto_approve", headers=headers, json={"monthly_price_pkr": 5})).status_code == 403


async def test_admin_prices_a_feature_and_it_is_audited(client, catalog, db_session_factory, make_user, make_auth_headers):
    await catalog.seed()
    admin = await make_user("+923099000002", role=UserRole.ADMIN)
    headers = await make_auth_headers(admin)
    listed = (await client.get("/api/v1/admin/premium-features", headers=headers)).json()
    assert [f["key"] for f in listed] == list(SELLABLE_KEYS)
    assert all(f["monthly_price_pkr"] == 0 and f["is_sellable"] is False for f in listed)

    resp = await client.patch("/api/v1/admin/premium-features/auto_approve", headers=headers, json={"monthly_price_pkr": 1500, "is_sellable": True})
    assert resp.status_code == 200 and resp.json()["monthly_price_pkr"] == 1500 and resp.json()["is_sellable"] is True
    async with db_session_factory() as session:
        entry = (await session.execute(select(AuditLog).where(AuditLog.action == "premium_feature.updated"))).scalar_one()
    assert entry.old_value["monthly_price_pkr"] == 0 and entry.new_value["monthly_price_pkr"] == 1500 and entry.actor_id == admin.id


async def test_a_feature_for_sale_must_have_a_price(client, catalog, make_user, make_auth_headers):
    await catalog.seed()
    headers = await make_auth_headers(await make_user("+923099000003", role=UserRole.ADMIN))
    bad = await client.patch("/api/v1/admin/premium-features/auto_approve", headers=headers, json={"is_sellable": True})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_PRICE"
    assert (await client.patch("/api/v1/admin/premium-features/auto_approve", headers=headers, json={"monthly_price_pkr": -1})).status_code == 422
    assert (await client.patch("/api/v1/admin/premium-features/nonsense", headers=headers, json={"monthly_price_pkr": 5})).status_code == 404


# --- owner: choosing features ---------------------------------------------------------------------------------------------


async def test_the_owner_only_sees_features_that_are_for_sale(client, catalog, make_user, make_auth_headers):
    await catalog.seed()
    await catalog.price("auto_approve", 1500)
    headers = await make_auth_headers(await make_user("+923099000010", role=UserRole.OWNER))
    body = (await client.get("/api/v1/owners/premium", headers=headers)).json()
    assert [f["key"] for f in body["features"]] == ["auto_approve"]
    assert body["enforced"] is False and body["monthly_total_pkr"] == 0 and body["invoices"] == []
    assert body["trial_days"] == 15 and body["grace_days"] == 7


async def test_enabling_a_feature_locks_the_price_and_starts_its_trial(client, catalog, db_session_factory, make_user, make_auth_headers):
    await catalog.seed()
    await catalog.price("auto_approve", 1500)
    await catalog.price("ai_chat_booking", 2000)
    await catalog.enforce(True)
    owner = await make_user("+923099000011", role=UserRole.OWNER)
    headers = await make_auth_headers(owner)

    resp = await client.put("/api/v1/owners/premium/selection", headers=headers, json={"feature_keys": ["auto_approve", "ai_chat_booking"]})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    by_key = {f["key"]: f for f in body["features"]}
    assert by_key["auto_approve"]["enabled"] and by_key["auto_approve"]["your_price_pkr"] == 1500
    assert by_key["auto_approve"]["state"] == "trial" and by_key["auto_approve"]["entitled"] is True
    assert by_key["auto_approve"]["trial_ends_on"] == (pkt_today() + timedelta(days=14)).isoformat()
    assert body["monthly_total_pkr"] == 3500

    # the price list moves on; the owner keeps the price they signed up at
    await catalog.price("auto_approve", 9000)
    after = (await client.get("/api/v1/owners/premium", headers=headers)).json()
    assert {f["key"]: f["your_price_pkr"] for f in after["features"]}["auto_approve"] == 1500
    assert after["monthly_total_pkr"] == 3500


async def test_a_feature_not_for_sale_cannot_be_enabled(client, catalog, make_user, make_auth_headers):
    await catalog.seed()  # nothing priced
    headers = await make_auth_headers(await make_user("+923099000012", role=UserRole.OWNER))
    resp = await client.put("/api/v1/owners/premium/selection", headers=headers, json={"feature_keys": ["auto_approve"]})
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "FEATURE_NOT_AVAILABLE"
    resp = await client.put("/api/v1/owners/premium/selection", headers=headers, json={"feature_keys": ["photos"]})
    assert resp.status_code == 400


async def test_cancelling_and_coming_back_does_not_restart_the_trial(client, catalog, db_session_factory, make_user, make_auth_headers):
    await catalog.seed()
    await catalog.price("auto_approve", 1500)
    owner = await make_user("+923099000013", role=UserRole.OWNER)
    headers = await make_auth_headers(owner)
    await client.put("/api/v1/owners/premium/selection", headers=headers, json={"feature_keys": ["auto_approve"]})
    # pretend they enabled it 20 days ago
    long_ago = datetime.now(timezone.utc) - timedelta(days=20)
    async with db_session_factory() as session:
        row = (await session.execute(select(OwnerFeature))).scalar_one()
        row.enabled_at = long_ago
        await session.commit()

    off = (await client.put("/api/v1/owners/premium/selection", headers=headers, json={"feature_keys": []})).json()
    feature = off["features"][0]
    assert feature["enabled"] is False and feature["cancelled"] is True and off["monthly_total_pkr"] == 0

    await catalog.price("auto_approve", 1800)
    on = (await client.put("/api/v1/owners/premium/selection", headers=headers, json={"feature_keys": ["auto_approve"]})).json()["features"][0]
    assert on["enabled"] is True and on["cancelled"] is False and on["your_price_pkr"] == 1800  # today's price
    async with db_session_factory() as session:
        row = (await session.execute(select(OwnerFeature))).scalar_one()
    assert abs((row.enabled_at - long_ago).total_seconds()) < 1  # the trial clock was NOT restarted


async def test_selecting_twice_is_harmless(client, catalog, db_session_factory, make_user, make_auth_headers):
    await catalog.seed()
    await catalog.price("auto_approve", 1500)
    headers = await make_auth_headers(await make_user("+923099000014", role=UserRole.OWNER))
    for _ in range(2):
        assert (await client.put("/api/v1/owners/premium/selection", headers=headers, json={"feature_keys": ["auto_approve", "auto_approve"]})).status_code == 200
    async with db_session_factory() as session:
        assert len((await session.execute(select(OwnerFeature))).scalars().all()) == 1


async def test_players_and_staff_cannot_use_owner_billing(client, catalog, make_user, make_auth_headers):
    await catalog.seed()
    for phone, role in (("+923099000015", UserRole.PLAYER), ("+923099000016", UserRole.STAFF)):
        headers = await make_auth_headers(await make_user(phone, role=role))
        assert (await client.get("/api/v1/owners/premium", headers=headers)).status_code == 403


# --- invoice generation ---------------------------------------------------------------------------------------------------


def test_proration_is_by_days_remaining_in_the_month():
    assert prorate(3100, date(2026, 10, 25)) == (700, 7)  # 25..31 October = 7 of 31 days
    assert prorate(3100, date(2026, 11, 1)) == (3100, None)  # the 1st is a whole month
    assert prorate(1000, date(2026, 11, 21)) == (333, 10)  # 10 of 30 days, rounded half up to whole PKR
    assert prorate(2800, date(2026, 2, 15)) == (1400, 14)  # a 28-day month: 14 of 28
    assert month_end(date(2026, 2, 10)) == date(2026, 2, 28) and month_end(date(2028, 2, 10)) == date(2028, 2, 29)


async def _owner_with(db_session_factory, make_user, phone, features: dict[str, tuple[int, datetime]], **row_kw):
    owner = await make_user(phone, role=UserRole.OWNER)
    async with db_session_factory() as session:
        for key, (price, enabled_at) in features.items():
            session.add(OwnerFeature(owner_id=owner.id, feature_key=key, price_pkr=price, enabled_at=enabled_at, **row_kw))
        await session.commit()
    return owner


E = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)  # enabled on 10 Oct (Karachi) -> trial to 24 Oct -> first charge from 25 Oct


async def test_the_first_invoice_is_prorated_and_issued_a_week_before_the_trial_ends(
    db_session, db_session_factory, catalog, make_user
):
    await catalog.seed()
    await catalog.price("auto_approve", 3100)
    await catalog.enforce(True)
    owner = await _owner_with(db_session_factory, make_user, "+923099000020", {"auto_approve": (3100, E)})
    service = OwnerBillingService(db_session, get_settings())

    assert await service.generate_for_owner(owner.id, today=date(2026, 10, 17)) is None  # 25 Oct is 8 days away: not yet
    invoice = await service.generate_for_owner(owner.id, today=date(2026, 10, 18))
    assert invoice is not None
    assert (invoice.period_start, invoice.period_end, invoice.total_pkr, invoice.status) == (date(2026, 10, 25), date(2026, 10, 31), 700, "issued")
    assert invoice.due_date == date(2026, 10, 25)
    line = (await db_session.execute(select(OwnerInvoiceLine))).scalar_one()
    assert (line.amount_pkr, line.prorated_days) == (700, 7) and "prorated, 7 days" in line.description

    # running the job again changes nothing
    assert await service.generate_for_owner(owner.id, today=date(2026, 10, 19)) is None
    assert len((await db_session.execute(select(OwnerInvoice))).scalars().all()) == 1


async def test_after_payment_the_next_invoice_is_a_whole_month(db_session, db_session_factory, catalog, make_user):
    await catalog.seed()
    await catalog.price("auto_approve", 3100)
    await catalog.enforce(True)
    owner = await _owner_with(db_session_factory, make_user, "+923099000021", {"auto_approve": (3100, E)}, paid_through=date(2026, 10, 31))
    service = OwnerBillingService(db_session, get_settings())
    assert await service.generate_for_owner(owner.id, today=date(2026, 10, 24)) is None  # 1 Nov is 8 days away
    invoice = await service.generate_for_owner(owner.id, today=date(2026, 10, 25))
    assert (invoice.period_start, invoice.period_end, invoice.total_pkr) == (date(2026, 11, 1), date(2026, 11, 30), 3100)
    assert (await db_session.execute(select(OwnerInvoiceLine))).scalar_one().prorated_days is None


async def test_every_feature_that_is_due_goes_on_one_invoice(db_session, db_session_factory, catalog, make_user):
    await catalog.seed()
    for key, price in (("auto_approve", 3100), ("ai_chat_booking", 6200)):
        await catalog.price(key, price)
    await catalog.enforce(True)
    owner = await _owner_with(
        db_session_factory, make_user, "+923099000022",
        {"auto_approve": (3100, E), "ai_chat_booking": (6200, E + timedelta(days=2))},  # charged from 25 Oct and 27 Oct
    )
    invoice = await OwnerBillingService(db_session, get_settings()).generate_for_owner(owner.id, today=date(2026, 10, 20))
    lines = (await db_session.execute(select(OwnerInvoiceLine).order_by(OwnerInvoiceLine.feature_key))).scalars().all()
    assert [(l.feature_key, l.amount_pkr) for l in lines] == [("ai_chat_booking", prorate(6200, date(2026, 10, 27))[0]), ("auto_approve", 700)]
    assert invoice.total_pkr == sum(l.amount_pkr for l in lines) and invoice.period_start == date(2026, 10, 25)


async def test_nothing_is_billed_for_a_cancelled_or_unsold_feature(db_session, db_session_factory, catalog, make_user):
    await catalog.seed()
    await catalog.price("auto_approve", 3100)
    await catalog.price("ai_chat_booking", 2000, sellable=False)  # taken off sale
    await catalog.enforce(True)
    owner = await _owner_with(db_session_factory, make_user, "+923099000023", {"auto_approve": (3100, E), "ai_chat_booking": (2000, E)})
    async with db_session_factory() as session:
        row = (await session.execute(select(OwnerFeature).where(OwnerFeature.feature_key == "auto_approve"))).scalar_one()
        row.status, row.auto_renew = "cancelled", False
        await session.commit()
    assert await OwnerBillingService(db_session, get_settings()).generate_for_owner(owner.id, today=date(2026, 10, 24)) is None


async def test_an_invoice_uses_the_price_the_owner_signed_up_at(db_session, db_session_factory, catalog, make_user):
    await catalog.seed()
    await catalog.price("auto_approve", 9999)  # today's list price is far higher than what they locked in
    await catalog.enforce(True)
    owner = await _owner_with(db_session_factory, make_user, "+923099000024", {"auto_approve": (3100, E)}, paid_through=date(2026, 10, 31))
    invoice = await OwnerBillingService(db_session, get_settings()).generate_for_owner(owner.id, today=date(2026, 10, 25))
    assert invoice.total_pkr == 3100


async def test_no_invoices_while_billing_is_not_enforced(db_session, db_session_factory, catalog, make_user):
    await catalog.seed()
    await catalog.price("auto_approve", 3100)
    owner = await _owner_with(db_session_factory, make_user, "+923099000025", {"auto_approve": (3100, E)})
    service = OwnerBillingService(db_session, get_settings())
    assert await service.generate_for_owner(owner.id, today=date(2026, 10, 24)) is None
    assert await service.generate_all(today=date(2026, 10, 24)) == {"enforced": False, "invoices_issued": 0}
    await catalog.enforce(True)
    assert (await service.generate_all(today=date(2026, 10, 24)))["invoices_issued"] == 1
    assert (await service.generate_all(today=date(2026, 10, 24)))["invoices_issued"] == 0  # the job is safe to run twice


async def test_the_owner_sees_their_invoice(client, db_session, db_session_factory, catalog, make_user, make_auth_headers):
    await catalog.seed()
    await catalog.price("auto_approve", 3100)
    await catalog.enforce(True)
    owner = await _owner_with(db_session_factory, make_user, "+923099000026", {"auto_approve": (3100, E)})
    await OwnerBillingService(db_session, get_settings()).generate_for_owner(owner.id, today=date(2026, 10, 24))
    body = (await client.get("/api/v1/owners/premium", headers=await make_auth_headers(owner))).json()
    assert len(body["invoices"]) == 1 and body["invoices"][0]["total_pkr"] == 700
    assert body["invoices"][0]["lines"][0]["feature_key"] == "auto_approve"
