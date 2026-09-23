import uuid
from datetime import date, datetime

from pydantic import BaseModel


class TodaySlotOut(BaseModel):
    starts_at: datetime
    ends_at: datetime
    status: str
    booking_id: uuid.UUID | None = None
    player_name: str | None = None
    amount_paid: float | None = None
    # Section 32 Part 2: the owner's Today row shows what is still owed at the venue, not just what was paid.
    price: float | None = None
    balance_due: float | None = None


class TodayCourtOut(BaseModel):
    court_id: uuid.UUID
    name: str
    slots: list[TodaySlotOut]


class TodaySummaryOut(BaseModel):
    total_bookings: int
    total_revenue: float
    pending_approvals: int
    walkins: int


class TodayOut(BaseModel):
    date: date
    courts: list[TodayCourtOut]
    summary: TodaySummaryOut


class PendingApprovalOut(BaseModel):
    payment_id: uuid.UUID
    booking_id: uuid.UUID
    court_name: str
    starts_at: datetime
    ends_at: datetime
    player_name: str | None
    player_phone: str | None
    ocr_verdict: str | None
    ocr_amount: float | None
    expected_amount: float
    proof_url: str | None
    submitted_at: datetime
    minutes_since_submission: float


class LedgerEntryOut(BaseModel):
    """One row per PAYMENT (Section 32 Part 5), not per booking -- a booking with an advance plus a
    balance payment is two rows here. A negative amount_pkr is an admin correction reversing an earlier
    row (see PaymentEntry.reverses_entry_id)."""

    entry_id: uuid.UUID
    recorded_at: datetime
    court: str
    booking_id: uuid.UUID
    starts_at: datetime
    player: str | None
    method: str
    amount_pkr: int
    running_total: int
    booking_status: str


class LedgerSummaryOut(BaseModel):
    # Always "now"-relative (Pakistan time), independent of whatever date range/filters are selected for
    # `entries` below -- these are the owner's always-current headline numbers.
    collected_today: int
    collected_this_week: int
    collected_this_month: int
    # Money owed for BOOKED/COMPLETED slots whose balance isn't fully collected yet.
    outstanding_balance: float
    # Money paid on bookings with an unresolved payment_disputes row (a cancelled/expired booking a
    # player likely paid real money for and hasn't been refunded).
    cancelled_refund_pending: float
    # Net total of `entries` below (respects the caller's date range and filters).
    total_in_range: int
    by_court: dict[str, int]
    by_day: dict[str, int]


class LedgerOut(BaseModel):
    entries: list[LedgerEntryOut]
    summary: LedgerSummaryOut


class GrowthSuggestionOut(BaseModel):
    court_id: uuid.UUID
    day_of_week: int
    hour: int
    booking_rate: float
    venue_average: float
    suggestion: str
    weeks_of_data: int


class GrowthOut(BaseModel):
    underbooked_slots: list[GrowthSuggestionOut]
    computed_at: date
