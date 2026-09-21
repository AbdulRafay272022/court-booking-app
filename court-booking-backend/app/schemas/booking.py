import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.models.booking import BookingSource, BookingStatus, CancelledBy


def _require_tz_aware(v: datetime) -> datetime:
    """Pydantic v2 happily accepts an ISO datetime with no UTC offset as a
    naive datetime; comparing that against a timezone-aware `datetime.now()`
    downstream (e.g. BookingService.create_hold's past-slot check) raises an
    uncaught TypeError -- a raw 500, not a clean rejection. Normal app usage
    always sources `starts_at` from the availability response (which
    includes a `Z`/offset), but the AI chat's `hold_slot` tool or a
    freeform client bug could hit this. See AUDIT_FINDINGS.md finding #26."""
    if v.tzinfo is None:
        raise ValueError("must include a UTC offset (e.g. a trailing 'Z' or '+00:00')")
    return v


AwareDatetime = Annotated[datetime, AfterValidator(_require_tz_aware)]


class BookingHoldIn(BaseModel):
    court_id: uuid.UUID
    starts_at: AwareDatetime
    # Section 32 Part 4: how many consecutive slots (the court's slot length each) to book as one booking.
    # 1 keeps every existing client working unchanged.
    slot_count: int = Field(default=1, ge=1, le=16)


class WalkInBookingIn(BaseModel):
    court_id: uuid.UUID
    starts_at: AwareDatetime
    player_name: str = Field(min_length=1, max_length=100)
    player_phone: str | None = None
    amount_paid: float = Field(ge=0)


class BookingCancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class BookingSelfCheckinIn(BaseModel):
    venue_qr_token: uuid.UUID


class PaymentInstructionsOut(BaseModel):
    bank: str | None = None
    account_title: str | None = None
    account_number: str | None = None
    iban: str | None = None
    amount: float


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    court_id: uuid.UUID
    player_id: uuid.UUID | None
    starts_at: datetime
    ends_at: datetime
    status: BookingStatus
    source: BookingSource
    player_name: str | None
    player_phone: str | None
    price: float
    advance_amount: float
    amount_paid: float
    balance_due: float
    held_until: datetime | None
    payment_deadline: datetime | None
    cancelled_by: CancelledBy | None
    cancellation_reason: str | None
    checked_in_at: datetime | None
    checked_in_by: str | None = None
    created_at: datetime


class BookingResponse(BaseModel):
    booking: BookingOut


class BookingHoldResponse(BaseModel):
    booking: BookingOut
    payment_instructions: PaymentInstructionsOut | None = None
