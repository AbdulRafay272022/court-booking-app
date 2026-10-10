"""Three follow-ups from the booking-ledger branch: a rejected payment leaves a refund trail, a freed multi-slot range
wakes EVERY waitlist entry inside it, and a multi-slot booking is one row on the owner's Today list."""

from datetime import datetime, time, timedelta, timezone

from sqlalchemy import select

from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.user import UserRole
from app.models.waitlist import WaitlistEntry
from app.utils.timezone import pkt_time_to_utc, pkt_today


async def _venue(make_user, make_venue, make_court, make_schedule, phone):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    today = pkt_today()
    await make_schedule(court, day_of_week=today.weekday(), open_time=time(8, 0), close_time=time(22, 0))
    return owner, court, today


def _booking(court, player, today, start, end, **kw):
    defaults = dict(
        court_id=court.id, player_id=player.id, player_phone=player.phone,
        starts_at=pkt_time_to_utc(today, start), ends_at=pkt_time_to_utc(today, end),
        price=3000, advance_amount=1000, amount_paid=1000, balance_due=2000,
        status=BookingStatus.BOOKED, source=BookingSource.APP,
    )
    defaults.update(kw)
    return Booking(**defaults)


# --- 1. rejected payment -> refund trail -------------------------------------------------------------------------


async def test_rejecting_a_payment_leaves_a_refund_trail(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner, court, _today = await _venue(make_user, make_venue, make_court, make_schedule, "+923071000001")
    player = await make_user("+923071000002", role=UserRole.PLAYER)
    start = datetime.now(timezone.utc) + timedelta(days=2)
    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id, player_id=player.id, player_phone=player.phone, starts_at=start,
            ends_at=start + timedelta(hours=1), price=2500, advance_amount=1000,
            status=BookingStatus.PAYMENT_SUBMITTED, payment_deadline=start,
        )
        session.add(booking)
        await session.flush()
        payment = Payment(booking_id=booking.id, proof_key="payment-proofs/x.jpg", amount_claimed=1000,
                          ocr_amount=1000, ocr_verdict="match")
        session.add(payment)
        await session.commit()
        booking_id, payment_id = booking.id, payment.id

    resp = await client.post(
        f"/api/v1/payments/{payment_id}/reject", headers=await make_auth_headers(owner), json={"reason": "wrong account"}
    )
    assert resp.status_code == 200
    assert resp.json()["booking"]["status"] == "cancelled"

    async with db_session_factory() as session:
        disputes = (await session.execute(select(PaymentDispute).where(PaymentDispute.booking_id == booking_id))).scalars().all()
    assert len(disputes) == 1
    d = disputes[0]
    assert (d.reason, d.payment_id, d.player_id) == ("payment_rejected", payment_id, player.id)
    assert d.refund_status == "owed" and d.resolved is False and float(d.refund_amount) == 0.0


async def test_rejecting_a_duplicate_proof_does_not_create_a_trail(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner, court, _today = await _venue(make_user, make_venue, make_court, make_schedule, "+923071000011")
    player = await make_user("+923071000012", role=UserRole.PLAYER)
    start = datetime.now(timezone.utc) + timedelta(days=2)
    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id, player_id=player.id, player_phone=player.phone, starts_at=start,
            ends_at=start + timedelta(hours=1), price=2500, advance_amount=1000,
            status=BookingStatus.PAYMENT_SUBMITTED, payment_deadline=start,
        )
        session.add(booking)
        await session.flush()
        payment = Payment(booking_id=booking.id, proof_key="payment-proofs/y.jpg", amount_claimed=1000, is_duplicate=True)
        session.add(payment)
        await session.commit()
        booking_id, payment_id = booking.id, payment.id

    resp = await client.post(
        f"/api/v1/payments/{payment_id}/reject", headers=await make_auth_headers(owner), json={"reason": "reused receipt"}
    )
    assert resp.status_code == 200
    async with db_session_factory() as session:
        count = len((await session.execute(select(PaymentDispute).where(PaymentDispute.booking_id == booking_id))).scalars().all())
    assert count == 0


# --- 2. waitlist: a freed range wakes every entry inside it -------------------------------------------------------


async def test_cancelling_a_two_slot_booking_notifies_every_waitlist_entry_in_the_freed_range(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner, court, today = await _venue(make_user, make_venue, make_court, make_schedule, "+923071000021")
    holder = await make_user("+923071000022", role=UserRole.PLAYER)
    w1 = await make_user("+923071000023", role=UserRole.PLAYER)  # asked for 6:00 PM
    w2 = await make_user("+923071000024", role=UserRole.PLAYER)  # asked for 6:30 PM
    w3 = await make_user("+923071000025", role=UserRole.PLAYER)  # asked for 7:00 PM -- AFTER the freed range
    w4 = await make_user("+923071000026", role=UserRole.PLAYER)  # asked for 5:30 PM -- BEFORE it

    async with db_session_factory() as session:
        booking = _booking(court, holder, today, time(18, 0), time(19, 0))
        session.add(booking)
        await session.flush()
        entries = {}
        for key, user, at in (("w1", w1, time(18, 0)), ("w2", w2, time(18, 30)), ("w3", w3, time(19, 0)), ("w4", w4, time(17, 30))):
            e = WaitlistEntry(court_id=court.id, player_id=user.id, slot_starts_at=pkt_time_to_utc(today, at))
            session.add(e)
            entries[key] = e
        await session.commit()
        booking_id = booking.id
        entry_ids = {k: e.id for k, e in entries.items()}

    resp = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel", headers=await make_auth_headers(owner), json={"reason": "owner cancel"}
    )
    assert resp.status_code == 200

    async with db_session_factory() as session:
        notified = {k: (await session.get(WaitlistEntry, i)).notified_at is not None for k, i in entry_ids.items()}
    assert notified == {"w1": True, "w2": True, "w3": False, "w4": False}


async def test_a_single_slot_cancel_still_only_wakes_that_slot(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner, court, today = await _venue(make_user, make_venue, make_court, make_schedule, "+923071000031")
    holder = await make_user("+923071000032", role=UserRole.PLAYER)
    w1 = await make_user("+923071000033", role=UserRole.PLAYER)
    w2 = await make_user("+923071000034", role=UserRole.PLAYER)
    async with db_session_factory() as session:
        booking = _booking(court, holder, today, time(18, 0), time(18, 30))
        session.add(booking)
        await session.flush()
        e1 = WaitlistEntry(court_id=court.id, player_id=w1.id, slot_starts_at=pkt_time_to_utc(today, time(18, 0)))
        e2 = WaitlistEntry(court_id=court.id, player_id=w2.id, slot_starts_at=pkt_time_to_utc(today, time(18, 30)))
        session.add_all([e1, e2])
        await session.commit()
        booking_id, i1, i2 = booking.id, e1.id, e2.id

    resp = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel", headers=await make_auth_headers(owner), json={"reason": "owner cancel"}
    )
    assert resp.status_code == 200
    async with db_session_factory() as session:
        assert (await session.get(WaitlistEntry, i1)).notified_at is not None
        assert (await session.get(WaitlistEntry, i2)).notified_at is None


# --- 3. Today: one row per booking --------------------------------------------------------------------------------


async def test_today_shows_a_multi_slot_booking_as_one_row_and_keeps_neighbours_separate(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner, court, today = await _venue(make_user, make_venue, make_court, make_schedule, "+923071000041")
    p1 = await make_user("+923071000042", role=UserRole.PLAYER)
    p2 = await make_user("+923071000043", role=UserRole.PLAYER)
    async with db_session_factory() as session:
        long_b = _booking(court, p1, today, time(18, 0), time(19, 30))  # three 30-minute cells
        next_b = _booking(court, p2, today, time(19, 30), time(20, 0))  # back to back, different booking
        session.add_all([long_b, next_b])
        await session.commit()
        long_id, next_id = str(long_b.id), str(next_b.id)

    resp = await client.get("/api/v1/owners/today", headers=await make_auth_headers(owner))
    assert resp.status_code == 200
    slots = resp.json()["courts"][0]["slots"]
    booked = [s for s in slots if s["booking_id"]]
    assert [s["booking_id"] for s in booked] == [long_id, next_id]  # exactly one row each

    long_row = booked[0]
    assert long_row["starts_at"] == pkt_time_to_utc(today, time(18, 0)).isoformat().replace("+00:00", "Z")
    assert long_row["ends_at"] == pkt_time_to_utc(today, time(19, 30)).isoformat().replace("+00:00", "Z")
    assert booked[1]["starts_at"] == long_row["ends_at"]  # the neighbour was not swallowed
    # free cells around them are untouched (8:00 AM to 6:00 PM = 20 cells before, 20:00 to 22:00 = 4 after)
    assert sum(1 for s in slots if s["status"] == "available") == 20 + 4
    # the summary counts bookings, not cells
    assert resp.json()["summary"]["total_bookings"] == 2
