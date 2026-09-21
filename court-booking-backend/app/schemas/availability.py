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
    # True when the signed-in viewer is the player on this slot's live booking (held / payment pending /
    # booked). Lets the client show "Your booking" instead of "Notify me". Always False for anonymous viewers.
    is_mine: bool = False
    reason: str | None = None  # populated when status == "blocked"
    # True for a slot that starts after midnight on an overnight court. It belongs to the OPENING day's schedule (it is
    # in that day's list), but its own calendar date is the next day: the apps show it as "Fri 1:00 AM".
    after_midnight: bool = False


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


class BookingQuoteOut(BaseModel):
    """The total for a booking of `slot_count` consecutive slots (Section 32 Part 4), priced slot by slot with
    the court's own rules. The apps show this before the player confirms; create_hold charges exactly this."""

    court_id: str
    starts_at: datetime
    ends_at: datetime
    slot_count: int
    slot_minutes: int
    duration_minutes: int
    price: float
    advance_amount: float
    balance_due: float
