"""Shared builders for the Owner Overview tests (tests/test_owner_overview.py, tests/test_owner_completion.py)."""
import uuid
from datetime import date, datetime, time, timedelta

from app.models.blackout import Blackout
from app.models.booking import Booking, BookingSource, BookingStatus, CancelledBy
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.payment_entry import PaymentEntry, PaymentMethod
from app.models.user import User, UserRole
from app.services.payment_ledger_service import recompute_payment_totals
from app.utils.timezone import pkt_time_to_utc, pkt_today


def at(day: date, hh: int, mm: int = 0) -> datetime:
    """A Pakistan wall-clock time on a calendar date as a UTC instant (hh may be 24+ for 'the next morning')."""
    return pkt_time_to_utc(day, time(0, 0)) + timedelta(hours=hh, minutes=mm)


def past_day(days: int = 10) -> date:
    return pkt_today() - timedelta(days=days)


async def seed_venue(
    make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone: str,
    *, courts=(("Court A", time(10, 0), time(22, 0)),), price=1000,
):
    """An owner with one venue and one court per (name, open, close) -- open every weekday; close <= open = overnight."""
    owner = await make_user(phone, role=UserRole.OWNER, name="Owner One")
    venue = await make_venue(owner)
    made = []
    for name, open_, close in courts:
        court = await make_court(venue, name=name)
        for day in range(7):
            await make_schedule(court, day_of_week=day, open_time=open_, close_time=close)
        await make_pricing_rule(court, price_per_slot=price)
        made.append(court)
    return owner, venue, made


async def add_booking(
    session_factory,
    court,
    start: datetime,
    hours: float = 1,
    *,
    status: BookingStatus = BookingStatus.BOOKED,
    price: int = 2000,
    paid: int = 0,
    advance: int | None = None,
    name: str | None = None,
    phone: str | None = None,
    player: User | None = None,
    source: BookingSource = BookingSource.WALKIN,
    cancelled_by: CancelledBy | None = None,
    reason: str | None = None,
    checked_in: bool = False,
    unreviewed_payment: bool = False,
) -> Booking:
    async with session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=player.id if player else None,
            starts_at=start,
            ends_at=start + timedelta(minutes=int(hours * 60)),
            status=status,
            source=source,
            player_name=name,
            player_phone=phone,
            price=price,
            advance_amount=price if advance is None else advance,
            cancelled_by=cancelled_by,
            cancellation_reason=reason,
            checked_in_at=start if checked_in else None,
            checked_in_by="owner" if checked_in else None,
        )
        session.add(booking)
        await session.flush()
        if paid:
            session.add(
                PaymentEntry(booking_id=booking.id, amount_pkr=paid, method=PaymentMethod.BANK_TRANSFER_PROOF, note="seed")
            )
            await session.flush()
        await recompute_payment_totals(session, booking)
        if unreviewed_payment:
            session.add(Payment(booking_id=booking.id, amount_claimed=price, ocr_amount=price, ocr_verdict="match"))
        await session.commit()
        await session.refresh(booking)
        return booking


async def add_dispute(session_factory, booking: Booking, amount: int, *, refund_status="owed", reason="player_cancelled_paid_booking"):
    async with session_factory() as session:
        payment = Payment(
            booking_id=booking.id, amount_claimed=amount, ocr_amount=amount, review_verdict="approved", is_duplicate=False
        )
        session.add(payment)
        await session.flush()
        session.add(
            PaymentDispute(
                booking_id=booking.id, payment_id=payment.id, reason=reason, refund_amount=amount, refund_status=refund_status
            )
        )
        await session.commit()


async def add_blackout(session_factory, court, start: datetime, hours: float = 1):
    async with session_factory() as session:
        session.add(Blackout(court_id=court.id, starts_at=start, ends_at=start + timedelta(minutes=int(hours * 60)), reason="maintenance"))
        await session.commit()


async def make_staff(client, owner_headers, venue, phone: str, permissions: list[str], load_user, make_auth_headers):
    resp = await client.post(
        "/api/v1/staff",
        headers=owner_headers,
        json={"venue_id": str(venue.id), "name": "Staff Sam", "phone": phone, "password": "staffpass123", "permissions": permissions},
    )
    assert resp.status_code == 201, resp.text
    user = await load_user(uuid.UUID(resp.json()["staff_user_id"]))
    return user, await make_auth_headers(user)
