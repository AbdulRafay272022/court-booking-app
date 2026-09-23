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
    checks: PaymentChecksOut  # Section 32 Part 7 -- the five plain-language checks


class LedgerRowOut(BaseModel):
    booking_id: uuid.UUID
    date: datetime
    court: str
    player: str | None
    source: str
    amount_paid: float
    balance_due: float
    status: str


class LedgerSummaryOut(BaseModel):
    total_revenue: float
    total_bookings: int
    avg_revenue_per_day: float
    by_source: dict[str, int]
    by_court: dict[str, float]


class LedgerOut(BaseModel):
    bookings: list[LedgerRowOut]
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
