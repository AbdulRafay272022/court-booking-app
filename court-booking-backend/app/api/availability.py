import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app.dependencies import DbSession, OptionalCurrentUser
from app.models.court import Court
from app.schemas.availability import (
    BookingQuoteOut,
    CourtAvailabilityOut,
    CourtMonthSummaryOut,
    DateSlots,
    DayAvailabilityOut,
    RangeAvailabilityOut,
    VenueAvailabilityOut,
)
from app.services.availability_service import AvailabilityService

router = APIRouter(tags=["availability"])


@router.get("/courts/{court_id}/availability")
async def get_court_availability(
    court_id: uuid.UUID,
    db: DbSession,
    viewer: OptionalCurrentUser,
    date: date | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> DayAvailabilityOut | RangeAvailabilityOut:
    service = AvailabilityService(db)
    court = await service.get_court(court_id)

    if date is not None:
        slots = await service.get_day_slots(court, date, viewer_id=viewer.id if viewer else None)
        return DayAvailabilityOut(
            court_id=str(court_id), date=date, slot_minutes=court.slot_minutes, slots=slots
        )

    if start_date is None or end_date is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either `date` or both `start_date` and `end_date`",
        )
    AvailabilityService.validate_range(start_date, end_date)

    days = []
    current = start_date
    while current <= end_date:
        days.append(
            DateSlots(
                date=current, slots=await service.get_day_slots(court, current, viewer_id=viewer.id if viewer else None)
            )
        )
        current += timedelta(days=1)

    return RangeAvailabilityOut(court_id=str(court_id), slot_minutes=court.slot_minutes, days=days)


@router.get("/venues/{venue_id}/availability", response_model=VenueAvailabilityOut)
async def get_venue_availability(
    venue_id: uuid.UUID, date: date, db: DbSession, viewer: OptionalCurrentUser
) -> VenueAvailabilityOut:
    service = AvailabilityService(db)
    result = await db.execute(select(Court).where(Court.venue_id == venue_id, Court.is_active.is_(True)))
    courts = result.scalars().all()

    court_availabilities = []
    for court in courts:
        slots = await service.get_day_slots(court, date, viewer_id=viewer.id if viewer else None)
        court_availabilities.append(
            CourtAvailabilityOut(
                court_id=str(court.id), court_name=court.name, slot_minutes=court.slot_minutes, slots=slots
            )
        )

    return VenueAvailabilityOut(venue_id=str(venue_id), date=date, courts=court_availabilities)


@router.get("/courts/{court_id}/quote", response_model=BookingQuoteOut)
async def quote_booking(
    court_id: uuid.UUID,
    db: DbSession,
    starts_at: datetime,
    slot_count: int = Query(default=1, ge=1, le=16),
) -> BookingQuoteOut:
    """What a booking of `slot_count` consecutive slots from `starts_at` costs, before anything is held."""
    if starts_at.tzinfo is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="starts_at must include a UTC offset")
    service = AvailabilityService(db)
    court = await service.get_court(court_id)
    quote = await service.quote_range(court, starts_at, slot_count)
    return BookingQuoteOut(
        court_id=str(court_id),
        starts_at=quote.starts_at,
        ends_at=quote.ends_at,
        slot_count=quote.slot_count,
        slot_minutes=court.slot_minutes,
        duration_minutes=quote.duration_minutes,
        price=quote.price,
        advance_amount=quote.advance_amount,
        balance_due=round(quote.price - quote.advance_amount, 2),
    )


@router.get("/courts/{court_id}/availability/summary", response_model=CourtMonthSummaryOut)
async def get_court_month_summary(
    court_id: uuid.UUID,
    response: Response,
    db: DbSession,
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="YYYY-MM"),
) -> CourtMonthSummaryOut:
    """One row per day of the month with a state (open/few/full/closed, plus past/beyond) for the calendar dots
    (Section 32 Part 4b). Not viewer-specific, so it is safe for a shared cache for a short time."""
    from app.models.venue import Venue

    service = AvailabilityService(db)
    court = await service.get_court(court_id)
    venue = await db.get(Venue, court.venue_id)
    year, mon = (int(x) for x in month.split("-"))
    summary = await service.month_summary(
        court, date(year, mon, 1), venue.booking_horizon_days if venue is not None else 90
    )
    response.headers["Cache-Control"] = "public, max-age=30"
    return summary
