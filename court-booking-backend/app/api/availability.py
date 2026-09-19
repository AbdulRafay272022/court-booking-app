import uuid
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.dependencies import DbSession
from app.models.court import Court
from app.schemas.availability import (
    CourtAvailabilityOut,
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
    date: date | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> DayAvailabilityOut | RangeAvailabilityOut:
    service = AvailabilityService(db)
    court = await service.get_court(court_id)

    if date is not None:
        slots = await service.get_day_slots(court, date)
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
        days.append(DateSlots(date=current, slots=await service.get_day_slots(court, current)))
        current += timedelta(days=1)

    return RangeAvailabilityOut(court_id=str(court_id), slot_minutes=court.slot_minutes, days=days)


@router.get("/venues/{venue_id}/availability", response_model=VenueAvailabilityOut)
async def get_venue_availability(venue_id: uuid.UUID, date: date, db: DbSession) -> VenueAvailabilityOut:
    service = AvailabilityService(db)
    result = await db.execute(select(Court).where(Court.venue_id == venue_id, Court.is_active.is_(True)))
    courts = result.scalars().all()

    court_availabilities = []
    for court in courts:
        slots = await service.get_day_slots(court, date)
        court_availabilities.append(
            CourtAvailabilityOut(
                court_id=str(court.id), court_name=court.name, slot_minutes=court.slot_minutes, slots=slots
            )
        )

    return VenueAvailabilityOut(venue_id=str(venue_id), date=date, courts=court_availabilities)
