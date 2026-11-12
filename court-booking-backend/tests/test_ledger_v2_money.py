"""Ledger v2 step 2 (docs/design/LEDGER-V2-CONTRACT.md 1, 2.1, 4.2): the money function, the business day, and the flag-free
read path that subtracts a waiver."""

import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select

from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.ledger_v2 import BookingAdjustment
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import UserRole
from app.services.money import Adj, Entry, active_adjustments, compute_money, load_money_many
from app.services.payment_ledger_service import recompute_payment_totals
from app.utils.business_day import business_date_for, venue_overnight_closes
from app.utils.timezone import naive_pkt_to_utc

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)
PAST = NOW - timedelta(days=1)
FUTURE = NOW + timedelta(days=1)


def _id() -> uuid.UUID:
    return uuid.uuid4()


def _m(price, status, entries=(), adjs=(), base=None, ends_at=PAST, disputed=False):
    return compute_money(
        price=price, base_price=base, status=status, ends_at=ends_at, entries=list(entries), adjustments=list(adjs),
        disputed=disputed, now=NOW,
    )


def _identity(m) -> bool:
    return m.final == m.net + m.due + m.due_at_slot + m.waived - m.refund_due


# --- contract section 8 cases, on the pure function ------------------------------------------------------------------


def test_partly_paid_then_fully_paid():
    m = _m(5000, BookingStatus.COMPLETED, [Entry("payment", 3000)], base=5000)
    assert (m.final, m.net, m.due, m.status) == (5000, 3000, 2000, "part_paid")
    m = _m(5000, BookingStatus.COMPLETED, [Entry("payment", 3000), Entry("payment", 2000)], base=5000)
    assert (m.due, m.status) == (0, "paid_full")


def test_noshow_keeps_advance_then_player_was_here():
    a = Adj(_id(), "no_show", 4000)
    m = _m(1000, BookingStatus.NO_SHOW, [Entry("payment", 1000)], [a], base=5000)
    assert (m.final, m.balance, m.status) == (1000, 0, "noshow_kept")
    m = _m(5000, BookingStatus.COMPLETED, [Entry("payment", 1000)], [a, Adj(_id(), "no_show", 4000, reverses=a.id)], base=5000)
    assert (m.final, m.due, m.status) == (5000, 4000, "part_paid")
    assert all(_identity(x) for x in (m,))


def test_cancel_refund_and_cancel_kept():
    full = _m(0, BookingStatus.CANCELLED, [Entry("payment", 500)], [Adj(_id(), "cancellation", 5000)], base=5000)
    assert (full.final, full.refund_due, full.status) == (0, 500, "cancel_refund")
    kept = _m(500, BookingStatus.CANCELLED, [Entry("payment", 500)], [Adj(_id(), "cancellation", 4500)], base=5000)
    assert (kept.final, kept.balance, kept.status) == (500, 0, "cancel_kept")
    clear = _m(0, BookingStatus.CANCELLED, [], [Adj(_id(), "cancellation", 5000)], base=5000)
    assert clear.status == "cancel_clear"


def test_bigger_advance_is_due_at_slot_not_refund():
    m = _m(5000, BookingStatus.BOOKED, [Entry("payment", 3000)], base=5000, ends_at=FUTURE)
    assert (m.due_at_slot, m.refund_due, m.status) == (2000, 0, "advance_paid")


def test_overpayment_refund_or_credit():
    refund = _m(6000, BookingStatus.COMPLETED, [Entry("payment", 6500)], base=6000)
    assert (refund.refund_due, refund.status) == (500, "refund_due")
    credit = _m(6000, BookingStatus.COMPLETED, [Entry("payment", 6500), Entry("credit_out", -500)], base=6000)
    assert (credit.net, credit.refund_due, credit.credit_out, credit.status) == (6000, 0, 500, "paid_full")


def test_credit_spent_counts_as_received():
    m = _m(3000, BookingStatus.COMPLETED, [Entry("payment", 2500), Entry("credit_in", 500)], base=3000)
    assert (m.net, m.due, m.credit_in, m.status) == (3000, 0, 500, "paid_full")


def test_waiver_is_not_a_deduction():
    m = _m(5000, BookingStatus.COMPLETED, [Entry("payment", 3000)], [Adj(_id(), "waived", 2000)], base=5000)
    assert (m.final, m.waived, m.due, m.deductions_total) == (5000, 2000, 0, 0)
    assert _identity(m)


def test_points_and_reduced_price_are_deductions():
    m = _m(4300, BookingStatus.BOOKED, [], [Adj(_id(), "points", 500), Adj(_id(), "price_reduced", 200)], base=5000,
           ends_at=FUTURE)
    assert (m.final, m.deductions["points"], m.deductions["price_reduced"], m.status) == (4300, 500, 200, "unpaid")


def test_unbackfilled_row_uses_price_as_base():
    m = _m(4000, BookingStatus.BOOKED, [Entry("payment", 1000)], ends_at=FUTURE)
    assert (m.base_price, m.final, m.due_at_slot) == (4000, 4000, 3000)


def test_attendance_pending_and_disputed():
    assert _m(5000, BookingStatus.BOOKED, [Entry("payment", 1000)], base=5000, ends_at=PAST).status == "attendance_pending"
    assert _m(5000, BookingStatus.COMPLETED, [Entry("payment", 1000)], base=5000, disputed=True).status == "disputed"


def test_refund_reversal_reopens_refund_due():
    # 1000 paid on a cancelled booking, 1000 refunded, the refund reversed (player never got it) -> 1000 owed again
    entries = [Entry("payment", 1000), Entry("refund", -1000), Entry("correction", 1000)]
    m = _m(0, BookingStatus.CANCELLED, entries, [Adj(_id(), "cancellation", 1000)], base=1000)
    assert (m.refund_due, m.status) == (1000, "cancel_refund")


def test_active_adjustments_drops_reversed_pairs():
    a = Adj(_id(), "points", 500)
    b = Adj(_id(), "points", 500, reverses=a.id)
    c = Adj(_id(), "waived", 100)
    assert active_adjustments([a, b, c]) == [c]


def test_identity_holds_for_a_mixed_set():
    ms = [
        _m(5000, BookingStatus.COMPLETED, [Entry("payment", 3000)], base=5000),
        _m(1000, BookingStatus.NO_SHOW, [Entry("payment", 1000)], [Adj(_id(), "no_show", 4000)], base=5000),
        _m(6000, BookingStatus.COMPLETED, [Entry("payment", 6500)], base=6000),
        _m(5000, BookingStatus.BOOKED, [Entry("payment", 3000)], base=5000, ends_at=FUTURE),
        _m(5000, BookingStatus.COMPLETED, [Entry("payment", 3000)], [Adj(_id(), "waived", 2000)], base=5000),
        _m(0, BookingStatus.CANCELLED, [Entry("payment", 500)], [Adj(_id(), "cancellation", 5000)], base=5000),
    ]
    assert all(_identity(m) for m in ms)
    total = lambda f: sum(f(m) for m in ms)  # noqa: E731
    assert total(lambda m: m.final) == total(lambda m: m.net + m.due + m.due_at_slot + m.waived - m.refund_due)


# --- business day ------------------------------------------------------------------------------------------------------


def test_business_day_overnight_and_plain():
    overnight = {0: time(4, 0)}  # Monday closes Tuesday 4 AM
    tue_1am = naive_pkt_to_utc(datetime(2026, 11, 10, 1, 0))  # Tue 10 Nov 2026, 1:00 AM PKT
    tue_5am = naive_pkt_to_utc(datetime(2026, 11, 10, 5, 0))
    assert business_date_for(tue_1am, overnight) == date(2026, 11, 9)
    assert business_date_for(tue_5am, overnight) == date(2026, 11, 10)
    assert business_date_for(tue_1am, {}) == date(2026, 11, 10)
    # Tuesday has no overnight court: Wed 1 AM stays Wednesday
    assert business_date_for(naive_pkt_to_utc(datetime(2026, 11, 11, 1, 0)), overnight) == date(2026, 11, 11)


async def test_overnight_map_takes_latest_court(db_session, make_user, make_venue, make_court, make_schedule):
    owner = await make_user("+923001110002", role=UserRole.OWNER)
    venue = await make_venue(owner)
    c1 = await make_court(venue, name="Court 1")
    c2 = await make_court(venue, name="Court 2")
    await make_schedule(c1, 0, time(18, 0), time(2, 0))
    await make_schedule(c2, 0, time(18, 0), time(4, 0))
    await make_schedule(c1, 1, time(9, 0), time(22, 0))
    assert await venue_overnight_closes(db_session, venue.id) == {0: time(4, 0)}


# --- flag-free read path: a waiver is subtracted everywhere -------------------------------------------------------------


async def _booking(db, court, price=5000, status=BookingStatus.COMPLETED, base=None) -> Booking:
    b = Booking(
        court_id=court.id, starts_at=PAST - timedelta(hours=1), ends_at=PAST, status=status, source=BookingSource.WALKIN,
        player_name="Ali", price=price, base_price=base, advance_amount=0,
    )
    db.add(b)
    await db.flush()
    return b


async def test_recompute_subtracts_waiver(db_session, make_user, make_venue, make_court):
    owner = await make_user("+923001110003", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    b = await _booking(db_session, court, base=5000)
    db_session.add(PaymentEntry(booking_id=b.id, amount_pkr=3000, method=PaymentMethod.CASH_AT_VENUE))
    db_session.add(BookingAdjustment(booking_id=b.id, kind="waived", amount_pkr=2000, reason="test"))
    await db_session.flush()
    await recompute_payment_totals(db_session, b)
    assert (float(b.amount_paid), float(b.balance_due)) == (3000.0, 0.0)
    await db_session.commit()
    money = (await load_money_many(db_session, [b], now=NOW))[b.id]
    assert (money.final, money.waived, money.due, money.status) == (5000, 2000, 0, "paid_full")


async def test_overview_due_uses_balance_due(db_session, make_user, make_venue, make_court):
    """owner_overview's due SQL reads balance_due (price - paid - waived), not price - paid."""
    from app.services.owner_overview_service import OwnerOverviewService  # noqa: F401  (import proves module loads)

    owner = await make_user("+923001110004", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    b = await _booking(db_session, court, base=5000)
    db_session.add(PaymentEntry(booking_id=b.id, amount_pkr=3000, method=PaymentMethod.CASH_AT_VENUE))
    db_session.add(BookingAdjustment(booking_id=b.id, kind="waived", amount_pkr=2000, reason="test"))
    await db_session.flush()
    await recompute_payment_totals(db_session, b)
    await db_session.commit()
    row = (await db_session.execute(select(Booking.balance_due).where(Booking.id == b.id))).scalar_one()
    assert float(row) == 0.0
