"""GET /owners/arrivals: today's (Pakistan calendar day) confirmed bookings at ONE venue, minimal fields only."""
import uuid
from datetime import time, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError, ErrorCode
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.schemas.arrivals import ArrivalOut, ArrivalsOut
from app.services.staff_service import resolve_owner_context
from app.utils.timezone import pkt_time_to_utc, pkt_today

# Players who are actually coming: pakki, or already played / checked in today. A pending screenshot, a hold, a
# cancelled or no-show booking is not an arrival.
ARRIVAL_STATUSES = (BookingStatus.BOOKED, BookingStatus.COMPLETED)


async def todays_arrivals(db: AsyncSession, actor: User, venue_id: uuid.UUID | None) -> ArrivalsOut:
    if actor.role == UserRole.STAFF:
        # only a venue this staff member works at WITH check_in; several venues -> they must pick one
        _owner, target = await resolve_owner_context(db, actor, venue_id, "check_in")
    else:
        if venue_id is None:
            raise AppError(400, ErrorCode.VALIDATION_ERROR, "Please choose which venue.")
        venue = await db.get(Venue, venue_id)
        if venue is None:
            raise AppError(404, ErrorCode.VENUE_NOT_FOUND, "Venue not found.")
        if actor.role != UserRole.ADMIN and venue.owner_id != actor.id:
            raise AppError(403, ErrorCode.NOT_VENUE_OWNER, "This isn't your venue.")
        target = venue_id
    assert target is not None

    today = pkt_today()
    start = pkt_time_to_utc(today, time(0, 0))
    end = start + timedelta(days=1)
    rows = (
        await db.execute(
            select(Booking.player_name, User.name, Court.name, Booking.starts_at, Booking.ends_at, Booking.checked_in_at)
            .join(Court, Court.id == Booking.court_id)
            .outerjoin(User, User.id == Booking.player_id)
            .where(
                Court.venue_id == target,
                Booking.starts_at >= start,
                Booking.starts_at < end,
                Booking.status.in_(ARRIVAL_STATUSES),
            )
            .order_by(Booking.starts_at, Court.name)
        )
    ).all()
    return ArrivalsOut(
        venue_id=target,
        date=today,
        items=[
            ArrivalOut(
                player_name=(booking_name or account_name or "Player"),
                court_name=court_name,
                starts_at=starts_at,
                ends_at=ends_at,
                checked_in=checked_in_at is not None,
            )
            for booking_name, account_name, court_name, starts_at, ends_at, checked_in_at in rows
        ],
    )
