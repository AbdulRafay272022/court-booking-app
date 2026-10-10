"""Owner premium billing, step 1: the tables and the entitlement rules. Nothing in the app calls the service yet, so none of
this changes behaviour for anyone; these tests pin the rules the later steps will rely on."""

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.models.feature_flag import FeatureFlag
from app.models.owner_billing import OwnerFeature, OwnerInvoice, OwnerPayment, PremiumFeature
from app.models.user import UserRole
from app.services.entitlement_service import SELLABLE_KEYS, EntitlementService

KEY = "auto_approve"
D = date(2026, 12, 10)  # a "today" far from every account's sign-up, so the trial is over unless a test says otherwise


@pytest.fixture
def seed(db_session_factory):
    """Price list + the enforcement flag, set up per test."""

    async def _seed(*, enforced: bool | None, sellable: bool = True, price: int = 1500):
        async with db_session_factory() as session:
            for key in SELLABLE_KEYS:
                session.add(PremiumFeature(key=key, label=key, monthly_price_pkr=price, is_sellable=sellable))
            if enforced is not None:
                session.add(FeatureFlag(key="owner_billing_enforced", enabled=enforced, label="Owner billing enforcement"))
            await session.commit()

    return _seed


@pytest.fixture
def old_owner(make_user):
    async def _make(phone="+923098000001"):
        return await make_user(phone, role=UserRole.OWNER, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))

    return _make


async def _buy(db_session_factory, owner, *, paid_through=None, key=KEY, price=1500, **kw):
    async with db_session_factory() as session:
        session.add(OwnerFeature(owner_id=owner.id, feature_key=key, price_pkr=price, paid_through=paid_through, **kw))
        await session.commit()


async def _state(db_session, owner, *, today=D, key=KEY):
    return await EntitlementService(db_session, get_settings()).state(owner.id, key, today=today)


# --- when billing is not in force, nothing changes ----------------------------------------------------------------------


async def test_a_missing_enforcement_flag_row_means_not_enforced(db_session, seed, old_owner):
    await seed(enforced=None)  # no row at all: this flag fails CLOSED, unlike every other flag
    owner = await old_owner()
    st = await _state(db_session, owner)
    assert (st.entitled, st.reason) == (True, "not_enforced")


async def test_an_off_flag_means_not_enforced(db_session, seed, old_owner):
    await seed(enforced=False)
    owner = await old_owner()
    assert (await _state(db_session, owner)).reason == "not_enforced"


async def test_a_feature_with_no_price_yet_is_never_billed(db_session, seed, old_owner):
    await seed(enforced=True, sellable=False, price=0)
    owner = await old_owner()
    st = await _state(db_session, owner)
    assert (st.entitled, st.reason) == (True, "not_billed")


async def test_a_flag_that_is_not_one_of_the_six_is_never_billed(db_session, seed, old_owner):
    await seed(enforced=True)
    owner = await old_owner()
    assert (await _state(db_session, owner, key="photos")).reason == "not_billed"


# --- once enforced: trial, paid, grace, lapsed -----------------------------------------------------------------------------


async def test_signing_up_does_not_start_a_trial(db_session, seed, make_user):
    """The trial starts when the owner switches a feature on, never by itself: a brand-new owner who has not enabled anything
    is simply not entitled once billing is enforced (their trial is still waiting for them)."""
    await seed(enforced=True)
    owner = await make_user("+923098000010", role=UserRole.OWNER)  # signed up just now
    st = await _state(db_session, owner, today=date.today())
    assert (st.entitled, st.reason) == (False, "not_purchased")


async def test_the_trial_is_fifteen_days_from_the_day_the_owner_enabled_that_feature(
    db_session, db_session_factory, seed, old_owner
):
    await seed(enforced=True)
    owner = await old_owner()
    enabled = datetime(2026, 12, 1, 9, 0, tzinfo=timezone.utc)  # 2:00 PM on 1 December in Karachi: day 1
    await _buy(db_session_factory, owner, paid_through=None, enabled_at=enabled)
    last = date(2026, 12, 15)  # day 15
    on_last = await _state(db_session, owner, today=last)
    assert (on_last.entitled, on_last.reason, on_last.until) == (True, "trial", last)
    assert (await _state(db_session, owner, today=date(2026, 12, 1))).reason == "trial"
    over = await _state(db_session, owner, today=last + timedelta(days=1))
    assert (over.entitled, over.reason) == (False, "unpaid")  # trial over, nothing paid


async def test_each_feature_has_its_own_trial_from_its_own_enable_date(db_session, db_session_factory, seed, old_owner):
    await seed(enforced=True)
    owner = await old_owner()
    await _buy(db_session_factory, owner, key="ai_chat_booking", enabled_at=datetime(2026, 12, 1, 9, tzinfo=timezone.utc))
    await _buy(db_session_factory, owner, key="auto_approve", enabled_at=datetime(2026, 12, 10, 9, tzinfo=timezone.utc))
    today = date(2026, 12, 20)
    assert (await _state(db_session, owner, today=today, key="ai_chat_booking")).entitled is False  # its 15 days ended on the 15th
    assert (await _state(db_session, owner, today=today, key="auto_approve")).reason == "trial"  # runs to 24 December


async def test_a_cancelled_feature_does_not_get_a_second_trial(db_session, db_session_factory, seed, old_owner):
    """The row is kept when an owner cancels, so switching the feature on again finds the old row (and its old enable date)."""
    await seed(enforced=True)
    owner = await old_owner()
    await _buy(db_session_factory, owner, enabled_at=datetime(2026, 11, 1, 9, tzinfo=timezone.utc), status="cancelled")
    assert (await _state(db_session, owner, today=date(2026, 12, 10))).entitled is False
    async with db_session_factory() as session:
        session.add(OwnerFeature(owner_id=owner.id, feature_key=KEY, price_pkr=1))
        with pytest.raises(IntegrityError):  # one row per owner per feature: there is no way to start a second trial
            await session.flush()
        await session.rollback()


async def test_paid_then_grace_then_lapsed_then_paid_again(db_session, db_session_factory, seed, old_owner):
    await seed(enforced=True)
    owner = await old_owner()
    paid_through = date(2026, 12, 10)
    await _buy(db_session_factory, owner, paid_through=paid_through)

    on_the_last_paid_day = await _state(db_session, owner, today=paid_through)
    assert (on_the_last_paid_day.entitled, on_the_last_paid_day.reason) == (True, "paid")

    day_after = await _state(db_session, owner, today=paid_through + timedelta(days=1))
    assert (day_after.entitled, day_after.reason, day_after.until) == (True, "grace", paid_through + timedelta(days=7))
    last_grace_day = await _state(db_session, owner, today=paid_through + timedelta(days=7))
    assert (last_grace_day.entitled, last_grace_day.reason) == (True, "grace")

    lapsed = await _state(db_session, owner, today=paid_through + timedelta(days=8))
    assert (lapsed.entitled, lapsed.reason) == (False, "lapsed")

    # paying again brings it straight back, nothing was deleted
    async with db_session_factory() as session:
        row = (await session.execute(__import__("sqlalchemy").select(OwnerFeature))).scalar_one()
        row.paid_through = date(2027, 1, 10)
        await session.commit()
    back = await _state(db_session, owner, today=paid_through + timedelta(days=8))
    assert (back.entitled, back.reason) == (True, "paid")


async def test_switched_on_but_never_paid_is_off_once_the_trial_is_over(db_session, db_session_factory, seed, old_owner):
    await seed(enforced=True)
    owner = await old_owner()
    await _buy(db_session_factory, owner, paid_through=None)
    st = await _state(db_session, owner)
    assert (st.entitled, st.reason) == (False, "unpaid")


async def test_only_the_features_an_owner_bought_are_on(db_session, db_session_factory, seed, old_owner):
    await seed(enforced=True)
    owner = await old_owner()
    await _buy(db_session_factory, owner, key="ai_chat_booking", paid_through=D + timedelta(days=20))
    overview = {e.key: e.entitled for e in await EntitlementService(db_session, get_settings()).owner_overview(owner.id, today=D)}
    assert overview == {key: key == "ai_chat_booking" for key in SELLABLE_KEYS}


async def test_a_venue_is_judged_by_its_owner(db_session, db_session_factory, seed, old_owner, make_venue):
    await seed(enforced=True)
    owner = await old_owner()
    venue = await make_venue(owner)
    service = EntitlementService(db_session, get_settings())
    assert await service.venue_entitled(venue.id, KEY, today=D) is False
    await _buy(db_session_factory, owner, paid_through=D)
    assert await service.venue_entitled(venue.id, KEY, today=D) is True


async def test_the_global_flag_is_the_master_switch(db_session, db_session_factory, seed, old_owner):
    await seed(enforced=True)
    owner = await old_owner()
    await _buy(db_session_factory, owner, paid_through=D)
    service = EntitlementService(db_session, get_settings())
    assert await service.effective(owner.id, KEY, today=D) is True  # no row for the feature's own flag = on
    async with db_session_factory() as session:
        session.add(FeatureFlag(key=KEY, enabled=False, label="x"))
        await session.commit()
    assert await service.owner_entitled(owner.id, KEY, today=D) is True  # still paid up...
    assert await service.effective(owner.id, KEY, today=D) is False  # ...but the global switch is off


async def test_monthly_total_is_the_sum_of_the_prices_they_signed_up_at(db_session, db_session_factory, seed, old_owner):
    await seed(enforced=True, price=9999)  # the price list moved on; the owner's locked-in prices are what count
    owner = await old_owner()
    await _buy(db_session_factory, owner, key="ai_chat_booking", price=2000, paid_through=D + timedelta(days=5))
    await _buy(db_session_factory, owner, key="auto_approve", price=1500, paid_through=D + timedelta(days=5))
    await _buy(db_session_factory, owner, key="digest_reminders", price=700, paid_through=D + timedelta(days=5), status="cancelled")
    await _buy(db_session_factory, owner, key="growth_suggestions", price=400, paid_through=D - timedelta(days=30))  # lapsed
    await _buy(db_session_factory, owner, key="ocr_verification", price=300, paid_through=D, auto_renew=False)
    total = await EntitlementService(db_session, get_settings()).monthly_total_pkr(owner.id, today=D)
    assert total == 2000 + 1500


# --- what the database itself refuses ----------------------------------------------------------------------------------------


async def _invoice(session, owner, **kw):
    inv = OwnerInvoice(owner_id=owner.id, period_start=date(2026, 12, 1), period_end=date(2026, 12, 31), total_pkr=3000,
                       due_date=date(2026, 12, 5), **kw)
    session.add(inv)
    await session.flush()
    return inv


async def test_only_one_live_invoice_per_owner_per_cycle(db_session_factory, old_owner):
    owner = await old_owner()
    async with db_session_factory() as session:
        first = await _invoice(session, owner)
        first.status = "void"
        await session.flush()
        await _invoice(session, owner)  # a void one can be re-issued
        with pytest.raises(IntegrityError):
            await _invoice(session, owner)  # but not a second live one
        await session.rollback()


async def test_owner_payment_rules_are_enforced_by_the_database(db_session_factory, old_owner):
    owner = await old_owner()

    async def attempt(**kw):
        async with db_session_factory() as session:
            inv = await _invoice(session, owner)
            session.add(OwnerPayment(invoice_id=inv.id, owner_id=owner.id, **kw))
            try:
                await session.flush()
            finally:
                await session.rollback()

    await attempt(amount_pkr=3000, status="submitted")  # a normal proof is fine
    with pytest.raises(IntegrityError):
        await attempt(amount_pkr=-5, status="approved")  # only a reversal may be negative
    with pytest.raises(IntegrityError):
        await attempt(amount_pkr=-3000, status="reversal")  # a reversal must say which payment it reverses

    async with db_session_factory() as session:
        inv = await _invoice(session, owner)
        session.add(OwnerPayment(invoice_id=inv.id, owner_id=owner.id, amount_pkr=3000, status="submitted"))
        await session.flush()
        session.add(OwnerPayment(invoice_id=inv.id, owner_id=owner.id, amount_pkr=3000, status="submitted"))
        with pytest.raises(IntegrityError):  # one unreviewed proof per invoice: a double-tap cannot create two
            await session.flush()
        await session.rollback()


async def test_an_unknown_feature_key_cannot_be_bought(db_session_factory, seed, old_owner):
    await seed(enforced=None)
    owner = await old_owner()
    with pytest.raises(IntegrityError):
        await _buy(db_session_factory, owner, key="not_a_feature")
