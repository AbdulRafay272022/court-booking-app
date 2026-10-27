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
from app.services import slot_compat
from app.services.availability_service import GRID_MINUTES, AvailabilityService, min_slots
from app.services.slot_compat import LegacySlotUnits
from app.services.venue_visibility import require_viewable

router = APIRouter(tags=["availability"])

# TRANSITION (delete with app/services/slot_compat.py once the new EAS build is out everywhere): every `legacy` flag below is
# True for a request WITHOUT the `X-Slot-Grid: 30` header (an app build from before the 30-minute grid), which gets the old
# per-court-slot-length slots and old-unit `slot_count` / `slot_minutes`.


async def _viewable_court(db, service: AvailabilityService, court_id: uuid.UUID, viewer) -> Court:
    """The court, if its venue is public or the viewer is its owner/admin/staff (audit 2026-10-28 item 2): a pending,
    rejected or deleted venue's slots and prices are not readable by court id any more."""
    from app.models.venue import Venue

    court = await service.get_court(court_id)
    await require_viewable(db, await db.get(Venue, court.venue_id), viewer)
    return court


def _grid_minutes(court: Court, legacy: bool) -> int:
    return int(court.slot_minutes) if legacy else GRID_MINUTES


@router.get("/courts/{court_id}/availability")
async def get_court_availability(
    court_id: uuid.UUID,
    db: DbSession,
    viewer: OptionalCurrentUser,
    legacy: LegacySlotUnits,
    date: date | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> DayAvailabilityOut | RangeAvailabilityOut:
    service = AvailabilityService(db)
    court = await _viewable_court(db, service, court_id, viewer)

    if date is not None:
        slots = await service.get_day_slots(court, date, viewer_id=viewer.id if viewer else None, legacy_units=legacy)
        return DayAvailabilityOut(
            court_id=str(court_id), date=date, slot_minutes=_grid_minutes(court, legacy),
            min_booking_minutes=court.slot_minutes, min_slots=min_slots(court), slots=slots
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
                date=current,
                slots=await service.get_day_slots(
                    court, current, viewer_id=viewer.id if viewer else None, legacy_units=legacy
                ),
            )
        )
        current += timedelta(days=1)

    return RangeAvailabilityOut(
        court_id=str(court_id), slot_minutes=_grid_minutes(court, legacy), min_booking_minutes=court.slot_minutes,
        min_slots=min_slots(court), days=days,
    )


@router.get("/venues/{venue_id}/availability", response_model=VenueAvailabilityOut)
async def get_venue_availability(
    venue_id: uuid.UUID, date: date, db: DbSession, viewer: OptionalCurrentUser, legacy: LegacySlotUnits
) -> VenueAvailabilityOut:
    from app.models.venue import Venue

    service = AvailabilityService(db)
    await require_viewable(db, await db.get(Venue, venue_id), viewer)
    result = await db.execute(select(Court).where(Court.venue_id == venue_id, Court.is_active.is_(True)))
    courts = result.scalars().all()

    court_availabilities = []
    for court in courts:
        slots = await service.get_day_slots(court, date, viewer_id=viewer.id if viewer else None, legacy_units=legacy)
        court_availabilities.append(
            CourtAvailabilityOut(
                court_id=str(court.id), court_name=court.name, slot_minutes=_grid_minutes(court, legacy),
                min_booking_minutes=court.slot_minutes, min_slots=min_slots(court), slots=slots
            )
        )

    return VenueAvailabilityOut(venue_id=str(venue_id), date=date, courts=court_availabilities)


@router.get("/courts/{court_id}/quote", response_model=BookingQuoteOut)
async def quote_booking(
    court_id: uuid.UUID,
    db: DbSession,
    starts_at: datetime,
    legacy: LegacySlotUnits,
    viewer: OptionalCurrentUser,
    slot_count: int | None = Query(default=None, ge=1, le=16),
) -> BookingQuoteOut:
    """What a booking of `slot_count` consecutive 30-minute slots from `starts_at` costs, before anything is held.
    Omitted `slot_count` = the court's minimum booking (min_slots). TRANSITION: a legacy request counts `slot_count` in the
    court's own slot length (omitted = 1) and gets the old-unit `slot_count` / `slot_minutes` back."""
    if starts_at.tzinfo is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="starts_at must include a UTC offset")
    service = AvailabilityService(db)
    court = await _viewable_court(db, service, court_id, viewer)
    if legacy:
        new_count = slot_compat.to_new_slot_count(court, slot_count)
    else:
        new_count = slot_count if slot_count is not None else min_slots(court)
    quote = await service.quote_range(court, starts_at, new_count, legacy_units=legacy)
    shown = slot_compat.legacy_quote_fields(court, quote.slot_count) if legacy else {
        "slot_count": quote.slot_count, "slot_minutes": GRID_MINUTES
    }
    return BookingQuoteOut(
        court_id=str(court_id),
        starts_at=quote.starts_at,
        ends_at=quote.ends_at,
        slot_count=shown["slot_count"],
        slot_minutes=shown["slot_minutes"],
        min_booking_minutes=court.slot_minutes,
        min_slots=min_slots(court),
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
    legacy: LegacySlotUnits,
    viewer: OptionalCurrentUser,
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="YYYY-MM"),
) -> CourtMonthSummaryOut:
    """One row per day of the month with a state (open/few/full/closed, plus past/beyond) for the calendar dots
    (Section 32 Part 4b). Not viewer-specific, so it is safe for a shared cache for a short time."""
    from app.models.venue import Venue

    service = AvailabilityService(db)
    court = await service.get_court(court_id)
    venue = await require_viewable(db, await db.get(Venue, court.venue_id), viewer)
    year, mon = (int(x) for x in month.split("-"))
    summary = await service.month_summary(
        court, date(year, mon, 1), venue.booking_horizon_days if venue is not None else 90, legacy_units=legacy
    )
    response.headers["Cache-Control"] = "public, max-age=30"
    # TRANSITION: the body depends on the X-Slot-Grid header, so a shared cache must key on it (delete with slot_compat.py)
    response.headers["Vary"] = slot_compat.SLOT_GRID_HEADER
    return summary
