import re
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from app.models.booking import BookingSource, BookingStatus, CancelledBy
from app.models.payment_entry import PaymentMethod
from app.services.player_name import PLAYER_NAME_MAX_LENGTH, tidy_player_name


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
    # How many consecutive 30-minute slots to book as one booking (Section 32 Part 4c: one fixed 30-minute grid;
    # the court's own slot length is its MINIMUM, enforced by quote_range as BELOW_MINIMUM_BOOKING_TIME).
    # Omitted = the court's minimum booking.
    slot_count: int | None = Field(default=None, ge=1, le=16)
    # The name the booking is made under when the player gave one in the chat (their own, or a friend's). Optional:
    # blank/whitespace means "none", and the account's own name is used.
    player_name: str | None = Field(default=None, max_length=PLAYER_NAME_MAX_LENGTH)
    # True when `player_name` is the player's OWN name (not a friend's): it is then saved on their account IF it has no name,
    # at the moment this hold is created (never when merely proposed). Comes from the assistant's confirm button.
    name_is_own: bool = False

    @field_validator("player_name", mode="before")
    @classmethod
    def _tidy_player_name(cls, value: object) -> object:
        if value is None or not isinstance(value, str):
            return value
        # Over-long input is rejected by max_length, not silently cut, so measure it before tidying's own cap.
        return value.strip() if len(value.strip()) > PLAYER_NAME_MAX_LENGTH else tidy_player_name(value)


def normalize_pk_mobile(v: str) -> str:
    """A Pakistani mobile in any of the forms the apps accept (+923001234567, 923001234567, 03001234567, 300 1234567,
    with spaces or dashes) -> E.164 `+923001234567`. The same rule signup/OTP enforce (+92, then 3, then 9 digits)."""
    digits = re.sub(r"\D", "", v)
    if digits.startswith("92"):
        digits = digits[2:]
    elif digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10 or not digits.startswith("3"):
        raise ValueError("Enter a valid Pakistani mobile number, e.g. 0300 1234567")
    return "+92" + digits


class WalkInBookingIn(BaseModel):
    court_id: uuid.UUID
    starts_at: AwareDatetime
    # Consecutive 30-minute slots in this one booking (None = the court's minimum booking time).
    slot_count: int | None = Field(default=None, ge=1, le=16)
    # Who the booking is for: the customer's name (required) and optional mobile. A phone that matches an existing account
    # links the booking to that account; otherwise the name/phone live on the booking row (no login is created).
    player_name: str = Field(min_length=1, max_length=100)
    player_phone: str | None = None
    amount_paid: float = Field(ge=0)
    # audit 2026-10-28 Phase 2 item 3: the owner ticked "Player ko bata diya ke WhatsApp par rasid aayegi" (both apps require it)
    whatsapp_opt_in: bool | None = None

    @field_validator("player_name", mode="before")
    @classmethod
    def _strip_name(cls, v: object) -> object:
        return " ".join(v.split()) if isinstance(v, str) else v

    @field_validator("player_phone", mode="before")
    @classmethod
    def _normalize_phone(cls, v: object) -> object:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return normalize_pk_mobile(v) if isinstance(v, str) else v

    # Section 32 Part 5: how the walk-in amount was actually received. Defaults to cash at the venue, the
    # overwhelmingly common case for an in-person booking.
    method: PaymentMethod = PaymentMethod.CASH_AT_VENUE


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


# ---- audit 2026-10-28 item 4: the player's own booking detail (web /booking/{id}, app booking/[id]/detail) ----


class PlayerBookingVenueOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    area: str | None = None
    city: str | None = None
    address: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    cancellation_allowed: bool = True
    cancellation_cutoff_hours: int | None = None


class PlayerBookingCourtOut(BaseModel):
    id: uuid.UUID
    name: str
    sport: str
    is_indoor: bool = False


class PlayerPaymentLineOut(BaseModel):
    """One real money line on the booking (payment_entries): positive = paid in, negative = refund or correction."""

    at: datetime
    amount: int
    method: PaymentMethod
    is_reversal: bool = False


class PlayerTimelineEventOut(BaseModel):
    at: datetime
    kind: str
    amount: float | None = None
    note: str | None = None


class PlayerRefundOut(BaseModel):
    amount: float
    status: str  # "owed" | "paid"
    paid_at: datetime | None = None


class PlayerBookingDetailOut(BaseModel):
    booking: BookingOut
    venue: PlayerBookingVenueOut
    court: PlayerBookingCourtOut
    duration_minutes: int
    payments: list[PlayerPaymentLineOut]
    timeline: list[PlayerTimelineEventOut]
    refund: PlayerRefundOut | None = None
    refund_request: "PlayerRefundRequestOut | None" = None


class BookingPaymentInstructionsOut(BaseModel):
    """audit 2026-10-28 item 20: what the player pays now and where, for the advance (held / payment_submitted) and the balance
    (booked with money due). `qr_payload` is the Raast QR text (flag `iban_qr` on AND the venue saved a valid IBAN), else null
    with `qr_unavailable_reason` = "flag_off" | "no_iban" | "invalid_iban" | "nothing_due"."""

    kind: str  # "advance" | "balance" | "none"
    amount: float
    bank: str | None = None
    account_title: str | None = None
    account_number: str | None = None
    iban: str | None = None
    reference: str
    qr_payload: str | None = None
    qr_unavailable_reason: str | None = None
    # Phase 3 item 2: "open" = the player can upload a balance screenshot now, "pending" = one is waiting for the owner,
    # "off" = not offered (flag off, nothing due, or not the player's own booking)
    balance_upload: str = "off"


class RefundRequestIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class PlayerRefundRequestOut(BaseModel):
    """audit 2026-10-28 Phase 2 item 3: whether "Refund maangein" is offered on this booking, and for how much.
    state: eligible | not_cancelled | policy_no_refund | window_closed | already_owed | nothing_paid."""

    state: str
    amount: float = 0


PlayerBookingDetailOut.model_rebuild()
