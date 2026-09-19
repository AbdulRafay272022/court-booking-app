import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.booking import BookingSource, BookingStatus
from app.models.user import UserRole
from app.models.venue import VenueStatus


class VenueReviewIn(BaseModel):
    status: VenueStatus
    rejection_reason: str | None = None


class ReasonIn(BaseModel):
    reason: str


class PlatformStatsOut(BaseModel):
    total_users: int
    total_venues: int
    approved_venues: int
    total_courts: int
    total_bookings: int
    booked_bookings: int
    bookings_last_30_days: int
    revenue_last_30_days: float


class OwnerDigestOut(BaseModel):
    venue_id: uuid.UUID
    venue_name: str
    bookings_today: int
    revenue_today: float
    payments_awaiting_review: int
    upcoming_bookings_7_days: int


class AdminDashboardOut(BaseModel):
    total_venues: int
    active_venues: int
    pending_approval: int
    total_bookings_today: int
    total_revenue_today: float
    total_users: int
    disputes_open: int


class AdminBookingOut(BaseModel):
    id: uuid.UUID
    court_id: uuid.UUID
    court_name: str
    venue_id: uuid.UUID
    venue_name: str
    player_name: str | None
    player_phone: str | None
    starts_at: datetime
    ends_at: datetime
    status: BookingStatus
    source: BookingSource
    price: float
    amount_paid: float


class AdminUserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    phone: str
    name: str | None
    role: UserRole
    is_active: bool
    suspension_reason: str | None
    reliability_score: float
    total_bookings: int
    total_no_shows: int
    total_rejections: int
    created_at: datetime


class DisputeRejectionOut(BaseModel):
    booking_id: uuid.UUID
    court_name: str
    venue_name: str
    reason: str | None
    rejected_at: datetime | None


class DisputeOut(BaseModel):
    player_id: uuid.UUID
    player_name: str | None
    player_phone: str
    rejection_count: int
    recent_rejections: list[DisputeRejectionOut]


class FlaggedCheckinOut(BaseModel):
    booking_id: uuid.UUID
    court_name: str
    venue_name: str
    player_name: str | None
    player_phone: str | None
    starts_at: datetime
    ends_at: datetime
    checked_in_at: datetime
    checked_in_by: str | None
    flag_reason: str


class PassiveOwnerVenueOut(BaseModel):
    venue_id: uuid.UUID
    venue_name: str
    owner_name: str | None
    owner_phone: str
    expired_review_count: int


class RefundQueueEntryOut(BaseModel):
    id: uuid.UUID
    booking_id: uuid.UUID
    payment_id: uuid.UUID
    player_id: uuid.UUID | None
    player_name: str | None
    player_phone: str | None
    court_name: str
    venue_name: str
    amount_claimed: float | None
    reason: str
    resolved: bool
    created_at: datetime


class SuspendUserIn(BaseModel):
    reason: str
