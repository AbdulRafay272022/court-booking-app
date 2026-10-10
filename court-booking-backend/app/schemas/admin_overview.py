"""GET /admin/overview: a read-only cross-platform picture for the super admin. Every figure comes from tables that already
exist (no schema change). Days are Pakistan days; money is whole PKR."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class CourtActivityOut(BaseModel):
    venue_id: uuid.UUID
    venue_name: str
    venue_status: str  # pending / approved / rejected / changes_requested
    court_id: uuid.UUID
    court_name: str
    sport: str
    owner_id: uuid.UUID
    owner_name: str | None
    owner_phone: str
    # "active" = the venue is live (approved, switched on) and its owner's account is not suspended
    state: str  # active | suspended | not_live
    bookings_today: int
    bookings_7_days: int
    last_booking_at: datetime | None  # when the most recent non-cancelled booking was MADE
    idle: bool  # live court with no booking made in the last IDLE_DAYS days (or ever)
    days_since_last_booking: int | None


class UserCountsOut(BaseModel):
    total_players: int
    total_owners: int
    total_staff: int
    total_admins: int
    new_players_7_days: int
    new_players_30_days: int
    new_owners_7_days: int
    new_owners_30_days: int
    active_30_days: int  # players + owners who used the app (a session) or chatted on WhatsApp in the last 30 days
    active_30_days_of_total: int  # the players + owners the line above is a share of


class PeriodFigures(BaseModel):
    today: int
    last_7_days: int
    last_30_days: int


class UsageOut(BaseModel):
    bookings: PeriodFigures  # by play date, cancelled ones excluded
    gmv_pkr: PeriodFigures  # full price of booked/completed bookings by play date
    collected_pkr: PeriodFigures  # what has actually been paid on those bookings
    chat_messages_app: PeriodFigures  # messages players SENT to the assistant
    chat_messages_whatsapp: PeriodFigures
    ai_model_calls_30_days: int
    ai_tokens_30_days: int
    payments_approved_30_days: int
    payments_rejected_30_days: int
    payments_pending_30_days: int
    payments_auto_approved_30_days: int
    payment_approval_rate: float | None  # approved / (approved + rejected); None when nothing has been decided yet


class WeakBucketOut(BaseModel):
    day_of_week: int  # Monday = 0
    hour: int
    booking_rate: float


class UnderperformingCourtOut(BaseModel):
    venue_id: uuid.UUID
    venue_name: str
    court_id: uuid.UUID
    court_name: str
    sport: str
    owner_name: str | None
    booking_rate: float  # booked minutes / open minutes over the window, 0..1
    booked_hours: float
    open_hours: float
    days_measured: int
    weakest_slots: list[WeakBucketOut]  # lowest nightly-materialized (weekday, hour) rates; empty before the growth job has data


class AdminOverviewOut(BaseModel):
    generated_at: datetime
    idle_days: int
    window_days: int
    courts: list[CourtActivityOut]
    users: UserCountsOut
    usage: UsageOut
    underperforming: list[UnderperformingCourtOut]
    notes: list[str]
