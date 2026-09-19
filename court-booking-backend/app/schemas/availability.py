import uuid
from datetime import date, datetime

from pydantic import BaseModel


class SlotOut(BaseModel):
    starts_at: datetime
    ends_at: datetime
    status: str  # available | held | payment_submitted | booked | blocked
    price: float
    advance_amount: float
    held_until: datetime | None = None
    booking_id: uuid.UUID | None = None
    reason: str | None = None  # populated when status == "blocked"


class DayAvailabilityOut(BaseModel):
    court_id: str
    date: date
    slot_minutes: int
    slots: list[SlotOut]


class DateSlots(BaseModel):
    date: date
    slots: list[SlotOut]


class RangeAvailabilityOut(BaseModel):
    court_id: str
    slot_minutes: int
    days: list[DateSlots]


class CourtAvailabilityOut(BaseModel):
    court_id: str
    court_name: str
    slot_minutes: int
    slots: list[SlotOut]


class VenueAvailabilityOut(BaseModel):
    venue_id: str
    date: date
    courts: list[CourtAvailabilityOut]
