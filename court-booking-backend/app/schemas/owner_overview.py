"""Owner Overview / Bookings history / booking detail (docs/owner-overview-contract.md).
Mirrors court-booking-frontend/packages/types/src/owner-overview.ts field for field (snake_case)."""
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

OverviewRowKind = Literal["booked", "cancelled", "refund"]
BookingStatusKey = Literal[
    "booked", "held", "awaiting_approval", "no_show", "cancelled", "refund_owed", "refunded", "expired"
]
CompletionResult = Literal["yes", "no"]


class BookingCompletionOut(BaseModel):
    result: CompletionResult
    received_pkr: int
    reason: str | None = None
    marked_at: datetime
    marked_by_name: str | None = None


class OwnerBookingRowOut(BaseModel):
    booking_id: uuid.UUID
    short_code: str
    kind: OverviewRowKind
    status_key: BookingStatusKey
    player_name: str | None
    player_phone: str | None
    court_id: uuid.UUID
    court_name: str
    starts_at: datetime
    ends_at: datetime
    duration_minutes: int
    slot_count: int
    total: float
    advance: float
    due: float
    total_paid: float
    source: Literal["app", "whatsapp", "walkin", "phone"]
    checked_in: bool
    completion: BookingCompletionOut | None
    slot_ended: bool
    original_booking_id: uuid.UUID | None
    refund_amount: float | None
    refund_status: Literal["owed", "paid"] | None


class SlotCourtCountsOut(BaseModel):
    court_id: uuid.UUID
    court_name: str
    total: int
    booked: int
    pending: int
    blocked: int
    free: int


class OperatingDayOut(BaseModel):
    start_at: datetime
    end_at: datetime


class OverviewSlotsOut(BaseModel):
    total: int
    booked: int
    pending: int
    blocked: int
    free: int
    free_upcoming: int
    free_past: int
    by_court: list[SlotCourtCountsOut]


class OverviewRefundsOut(BaseModel):
    count: int
    amount: float


class OverviewPendingOut(BaseModel):
    count: int
    awaiting_approval: int
    awaiting_payment: int


class OverviewCourtBookingCountOut(BaseModel):
    court_id: uuid.UUID
    court_name: str
    count: int


class OverviewBookingsOut(BaseModel):
    count: int
    cancelled: int
    refunds: OverviewRefundsOut
    pending: OverviewPendingOut
    by_court: list[OverviewCourtBookingCountOut]


class OverviewMoneyOut(BaseModel):
    collected: int
    due: int
    due_bookings: int


class OwnerOverviewOut(BaseModel):
    date: date
    venue_id: uuid.UUID
    operating_day: OperatingDayOut | None
    slots: OverviewSlotsOut
    bookings: OverviewBookingsOut
    money: OverviewMoneyOut
    rows: list[OwnerBookingRowOut]
    # Owner Round 2 (A7): held (hold time not run out) + payment_submitted bookings for ANY date, venue + court
    # filter applied, date ignored. `bookings.pending` above stays date-based.
    pending_all: OverviewPendingOut | None = None


class HistoryTotalsOut(BaseModel):
    count: int
    total: float
    collected: float
    due: float


class OwnerBookingsPageOut(BaseModel):
    items: list[OwnerBookingRowOut]
    total: int
    page: int
    page_size: int
    totals: HistoryTotalsOut


class BookingTimelineEventOut(BaseModel):
    at: datetime
    kind: str
    amount: float | None = None
    actor_name: str | None = None
    note: str | None = None


class DetailApprovalOut(BaseModel):
    verdict: Literal["approved", "rejected"] | None
    by_name: str | None
    at: datetime | None
    reason: str | None
    auto: bool


class DetailCancellationOut(BaseModel):
    by: Literal["player", "owner", "system"]
    at: datetime | None
    reason: str | None


class DetailRefundOut(BaseModel):
    amount: float
    status: Literal["owed", "paid"]
    paid_at: datetime | None
    reference: str | None


class OwnerBookingDetailOut(BaseModel):
    row: OwnerBookingRowOut
    booked_at: datetime
    hold_expires_at: datetime | None
    advance_required: float
    payment_id: uuid.UUID | None
    ocr_verdict: str | None
    ocr_amount: float | None
    approval: DetailApprovalOut | None
    cancellation: DetailCancellationOut | None
    refund: DetailRefundOut | None
    completion: BookingCompletionOut | None
    timeline: list[BookingTimelineEventOut]
    # Owner Round 2 (A4): for a walk-in, who added it ("owner" | "staff"), from the audit_log actor; else null.
    channel_detail: str | None = None


class CompletionIn(BaseModel):
    result: CompletionResult
    received_pkr: int | None = Field(default=None, ge=0)
    reason: str | None = Field(default=None, max_length=500)
    # Owner Round 2 (A8): "how much of the balance was received now" -- added on top of what was already paid (never
    # lowers total paid). When present, `received_pkr` is ignored.
    received_now: int | None = Field(default=None, ge=0)


class OwnerBadgesOut(BaseModel):
    approvals: int
    refunds: int
