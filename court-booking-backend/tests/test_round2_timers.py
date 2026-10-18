"""Owner Round 2 (B1): an expired hold is FREE at read time, a new hold over it succeeds (the stale hold is cancelled in
the same transaction), a late payment screenshot is kept for the owner and refused clearly for the player, and the
player gets one reminder at 2/3 of the hold time. Real Postgres."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.config import get_settings
from app.jobs.expiry_job import remind_expiring_holds, run_expiry_job
from app.models.booking import Booking, BookingStatus, CancelledBy
from app.models.payment import Payment
from round2_helpers import future_day, hold, log_rows, mock_upload, open_venue, submit_proof


@pytest.fixture
def world(make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch):
    async def _world(prefix: str):
        mock_upload(monkeypatch)
        owner, venue, court = await open_venue(make_user, make_venue, make_court, make_schedule, make_pricing_rule, prefix + "01")
        p1 = await make_user(prefix + "02", name="First Player")
        p2 = await make_user(prefix + "03", name="Second Player")
        return owner, court, p1, p2, await make_auth_headers(owner), await make_auth_headers(p1), await make_auth_headers(p2)

    return _world


async def _expire(sf, booking_id, minutes_ago=1):
    async with sf() as session:
        await session.execute(
            update(Booking)
            .where(Booking.id == uuid.UUID(str(booking_id)))
            .values(held_until=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago))
        )
        await session.commit()


async def _booking(sf, booking_id) -> Booking:
    async with sf() as session:
        return await session.get(Booking, uuid.UUID(str(booking_id)))


async def test_expired_hold_is_free_in_availability_and_quote(world, client, db_session_factory):
    owner, court, p1, p2, oh, h1, h2 = await world("+92301300")
    day = future_day(3)
    first = await hold(client, court, h1, day, 14)
    starts = f"{day.isoformat()}T14:00:00+00:00"

    def slot_status(body):
        return next(s["status"] for s in body["slots"] if s["starts_at"].startswith(f"{day.isoformat()}T14:00:00"))

    avail = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})).json()
    assert slot_status(avail) != "available"
    await _expire(db_session_factory, first["id"])
    avail = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})).json()
    assert slot_status(avail) == "available"  # free immediately, before any job run
    quote = await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": starts})
    assert quote.status_code == 200, quote.text


async def test_new_hold_over_an_expired_hold_succeeds_and_releases_it(world, client, db_session_factory):
    owner, court, p1, p2, oh, h1, h2 = await world("+92301301")
    day = future_day(3)
    first = await hold(client, court, h1, day, 14)
    await _expire(db_session_factory, first["id"])
    second = await hold(client, court, h2, day, 14)  # the EXCLUDE / unique index would refuse this without the release
    old = await _booking(db_session_factory, first["id"])
    assert old.status == BookingStatus.CANCELLED and old.cancelled_by == CancelledBy.SYSTEM
    assert old.cancellation_reason == "hold_expired"
    assert (await _booking(db_session_factory, second["id"])).status == BookingStatus.HELD
    rows = await log_rows(db_session_factory, p1.id, "booking_cancelled")
    assert rows and rows[0].reference_id == old.id  # the first player is told, like the expiry job would
    # a live (not expired) hold still blocks
    resp = await client.post(
        "/api/v1/bookings/hold", headers=h1, json={"court_id": str(court.id), "starts_at": f"{day.isoformat()}T14:00:00+00:00"}
    )
    assert resp.status_code == 409


async def test_late_screenshot_is_kept_for_the_owner_and_refused_for_the_player(world, client, db_session_factory):
    owner, court, p1, p2, oh, h1, h2 = await world("+92301302")
    booking = await hold(client, court, h1, future_day(3), 14)
    await _expire(db_session_factory, booking["id"])

    resp = await submit_proof(client, booking["id"], h1)
    assert resp.status_code == 409
    err = resp.json()["error"]
    assert err["code"] == "HOLD_EXPIRED" and "ran out" in err["message"]
    b = await _booking(db_session_factory, booking["id"])
    assert b.status == BookingStatus.CANCELLED and b.cancellation_reason == "hold_expired"
    async with db_session_factory() as session:
        payments = (await session.execute(select(Payment).where(Payment.booking_id == b.id))).scalars().all()
    assert len(payments) == 1 and payments[0].review_verdict is None and payments[0].proof_key
    assert err["details"]["payment_id"] == str(payments[0].id)
    # the owner's queue shows it as an expired card, and the owner has a bell row
    item = (await client.get("/api/v1/owners/approvals-queue", headers=oh)).json()["items"][0]
    assert item["state"] == "expired" and item["has_screenshot"] is True
    rows = await log_rows(db_session_factory, owner.id, "late_payment_proof")
    assert len(rows) == 1 and rows[0].reference_id == b.id
    # sending it again does not duplicate anything
    again = await submit_proof(client, booking["id"], h1)
    assert again.status_code == 409
    assert len(await log_rows(db_session_factory, owner.id, "late_payment_proof")) == 1


async def test_player_reminded_once_at_two_thirds_of_the_hold(world, client, db_session_factory):
    owner, court, p1, p2, oh, h1, h2 = await world("+92301303")
    booking = await hold(client, court, h1, future_day(3), 14)
    hold_minutes = get_settings().BOOKING_HOLD_MINUTES
    assert await remind_expiring_holds(db_session_factory) == 0  # just created: too early
    now = datetime.now(timezone.utc)
    async with db_session_factory() as session:  # 11 of 15 minutes used
        await session.execute(
            update(Booking)
            .where(Booking.id == uuid.UUID(booking["id"]))
            .values(created_at=now - timedelta(minutes=hold_minutes - 4), held_until=now + timedelta(minutes=4))
        )
        await session.commit()
    assert await remind_expiring_holds(db_session_factory) == 1
    assert await remind_expiring_holds(db_session_factory) == 0  # deduped through notification_log
    rows = await log_rows(db_session_factory, p1.id, "hold_expiring")
    assert len(rows) == 1 and str(rows[0].reference_id) == booking["id"]


async def test_expiry_job_still_releases_and_reports_hold_reminders(world, client, db_session_factory):
    owner, court, p1, p2, oh, h1, h2 = await world("+92301304")
    booking = await hold(client, court, h1, future_day(3), 14)
    await _expire(db_session_factory, booking["id"])
    result = await run_expiry_job(session_factory=db_session_factory)
    assert result["expired_bookings"] == 1 and result["hold_reminders_sent"] == 0
    rows = await log_rows(db_session_factory, p1.id, "booking_cancelled")
    assert rows and str(rows[0].reference_id) == booking["id"]
