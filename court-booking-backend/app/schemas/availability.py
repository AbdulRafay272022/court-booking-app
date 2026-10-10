import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


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
    # Server-side only (never serialized): the un-rounded price/advance of this 30-minute slot. A 90-minute court's slot is
    # a third of its price (333.333...), so the quote sums THESE and rounds once, never the rounded per-slot figures.
    price_exact: float | None = Field(default=None, exclude=True)
    advance_exact: float | None = Field(default=None, exclude=True)


class DayAvailabilityOut(BaseModel):
    court_id: str
    date: date
    # The length of ONE slot in `slots`: always the 30-minute grid (Section 32 Part 4c), whatever the court's minimum.
    slot_minutes: int
    # The court's minimum booking time: a booking must span at least `min_slots` consecutive slots.
    min_booking_minutes: int
    min_slots: int
    slots: list[SlotOut]


class DateSlots(BaseModel):
    date: date
    slots: list[SlotOut]


class RangeAvailabilityOut(BaseModel):
    court_id: str
    slot_minutes: int
    min_booking_minutes: int
    min_slots: int
    days: list[DateSlots]


class CourtAvailabilityOut(BaseModel):
    court_id: str
    court_name: str
    slot_minutes: int
    min_booking_minutes: int
    min_slots: int
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
    min_booking_minutes: int
    min_slots: int
    duration_minutes: int
    price: float
    advance_amount: float
    balance_due: float


class DaySummaryOut(BaseModel):
    """One day on a court's month calendar (Section 32 Part 4b).

    state: past (before today, not bookable) | beyond (after the venue's booking horizon) | closed (no schedule that day,
    or every slot blocked) | full (nothing open) | few (almost full: 20% or fewer of the day's slots open, at least 1) |
    open. `open_slots` counts slots a player could still book right now (available and not already started)."""

    date: date
    state: str
    open_slots: int
    total_slots: int


class CourtMonthSummaryOut(BaseModel):
    court_id: str
    month: str  # "2026-09"
    slot_minutes: int
    min_booking_minutes: int
    min_slots: int
    # The lowest active price on this court (floodlight surcharge included); None if it has no price yet.
    starts_from_price: float | None
    booking_horizon_days: int
    last_bookable_date: date
    days: list[DaySummaryOut]
