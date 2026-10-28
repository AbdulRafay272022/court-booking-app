import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.payment import PaymentChecksOut


class TodaySlotOut(BaseModel):
    starts_at: datetime
    ends_at: datetime
    status: str
    booking_id: uuid.UUID | None = None
    player_name: str | None = None
    # audit 2026-10-28 item 6: the booking account's profile photo (None for a walk-in without an account / no photo)
    player_avatar_url: str | None = None
    amount_paid: float | None = None
    # Section 32 Part 2: the owner's Today row shows what is still owed at the venue, not just what was paid.
    price: float | None = None
    balance_due: float | None = None
    # Section 32 Part 9: so Today can show "Checked in 7:05 PM" / offer Check in or Mark no-show.
    checked_in_at: datetime | None = None
    checked_in_by: str | None = None
    # Owner "Today" detail (items 8-10): which court (and its sport), how and when the booking was made. All None on an
    # open/closed slot. `player_name` is the name the booking was made under (a walk-in's or a "booked for a friend" name),
    # falling back to the account name; `account_name` is the registered account that made it (None for a walk-in with
    # no account), so the owner can see both when they differ.
    court_id: uuid.UUID | None = None
    court_name: str | None = None
    court_sport: str | None = None
    booking_source: str | None = None  # "app" | "whatsapp" | "walkin" | "phone"
    booked_at: datetime | None = None  # bookings.created_at
    account_name: str | None = None
    player_phone: str | None = None


class TodayCourtOut(BaseModel):
    court_id: uuid.UUID
    name: str
    sport: str | None = None
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
    # Items 8/10: carried explicitly so screens never match on court name; player_name is the name the booking
    # was made under (account name only as a fallback), account_name the registered account.
    court_id: uuid.UUID | None = None
    court_sport: str | None = None
    account_name: str | None = None
    starts_at: datetime
    ends_at: datetime
    player_name: str | None
    player_phone: str | None
    player_avatar_url: str | None = None  # audit 2026-10-28 item 6
    ocr_verdict: str | None
    ocr_amount: float | None
    expected_amount: float
    proof_url: str | None
    submitted_at: datetime
    minutes_since_submission: float
    checks: PaymentChecksOut  # Section 32 Part 7 -- the five plain-language checks


class OverpaymentOut(BaseModel):
    expected: int
    ocr_amount: int
    excess: int


class DuplicateUseOut(BaseModel):
    used_on_bookings: int


class ApprovalQueueItemOut(PendingApprovalOut):
    """Owner Round 2 (A1/A5), docs/round2-contract.md: a PendingApprovalOut plus the card state."""

    state: str  # "awaiting" | "cancelled_by_player" | "expired" | "cancelled_by_owner"
    cancelled_at: datetime | None = None
    has_screenshot: bool = False
    overpayment: OverpaymentOut | None = None
    # Round 2 Stage 2: set when the screenshot is flagged a duplicate; how many OTHER bookings it was credited on.
    duplicate: DuplicateUseOut | None = None


class ApprovalsQueuePageOut(BaseModel):
    items: list[ApprovalQueueItemOut]
    total: int
    page: int
    page_size: int


class LedgerEntryOut(BaseModel):
    """One row per PAYMENT (Section 32 Part 5), not per booking -- a booking with an advance plus a
    balance payment is two rows here. A negative amount_pkr is an admin correction reversing an earlier
    row (see PaymentEntry.reverses_entry_id)."""

    entry_id: uuid.UUID
    recorded_at: datetime
    court: str
    court_id: uuid.UUID | None = None
    court_sport: str | None = None
    booking_id: uuid.UUID
    starts_at: datetime
    player: str | None
    # Section 32 batch merge: Part 5's per-payment ledger supersedes Part 10's per-booking row.
    # Part 10's refund_amount-on-the-row is intentionally dropped here; wiring a paid refund to
    # appear as a real negative payment_entry is a deliberate follow-up (see batch-review notes).
    method: str
    # "payment" | "refund" | "correction" with a ready-made label ("Payment" / "Refund" / "Correction"); the
    # note carries the refund reference or the credited-amount audit text.
    entry_type: str = "payment"
    label: str = "Payment"
    note: str | None = None
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
    # Remaining refund still owed on unresolved payment_disputes rows (refund_amount minus any partial
    # refunds already paid).
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
