import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.venue import VenueStatus
from app.schemas.court import CourtOut


class BankDetailsIn(BaseModel):
    bank: str
    account_title: str
    account_number: str
    iban: str | None = None


class VenueCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    address: str = Field(min_length=1)
    city: str = Field(min_length=1, max_length=100)
    area: str | None = None
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    phone: str | None = None
    whatsapp: str | None = None
    sports: list[str] = Field(min_length=1)
    amenities: list[str] | None = None
    bank_details: BankDetailsIn | None = None
    # Section 32 Part 4: one cancellation policy per venue (reverses Section 31's per-court policy).
    cancellation_allowed: bool = True
    cancellation_cutoff_hours: int | None = Field(default=None, ge=0, le=720)
    # Section 32 Part 4b: how many days ahead players can book (1-365, default 90)
    booking_horizon_days: int = Field(default=90, ge=1, le=365)


class VenueUpdateIn(BaseModel):
    name: str | None = None
    description: str | None = None
    address: str | None = None
    city: str | None = None
    area: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    phone: str | None = None
    whatsapp: str | None = None
    sports: list[str] | None = None
    amenities: list[str] | None = None
    bank_details: BankDetailsIn | None = None
    auto_approve_enabled: bool | None = None
    auto_approve_min_bookings: int | None = Field(default=None, ge=0)
    cancellation_allowed: bool | None = None
    cancellation_cutoff_hours: int | None = Field(default=None, ge=0, le=720)
    booking_horizon_days: int | None = Field(default=None, ge=1, le=365)


class VenueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    slug: str
    description: str | None
    address: str
    city: str
    area: str | None
    phone: str | None
    whatsapp: str | None
    sports: list[str]
    amenities: list[str] | None
    photo_urls: list[str] = Field(default_factory=list)
    status: VenueStatus
    rejection_reason: str | None = None
    auto_approve_enabled: bool
    auto_approve_min_bookings: int
    cancellation_allowed: bool = True
    cancellation_cutoff_hours: int | None = None
    booking_horizon_days: int = 90
    created_at: datetime
    courts: list[CourtOut] = Field(default_factory=list)
    average_rating: float | None = None
    review_count: int = 0  # Section 32 Part 6
    distance_meters: float | None = None
    # Only populated for the venue's owner or an admin; omitted otherwise.
    bank_details: dict | None = None
    # Same visibility rule as bank_details -- meant to be printed/posted
    # physically at the venue for player self-checkin (finding #17), not
    # shown to players/public via the API.
    checkin_qr_token: uuid.UUID | None = None
    # Only populated on the by-slug detail endpoint.
    available_slots_today: int | None = None


class VenueDetailResponse(BaseModel):
    venue: VenueOut


class VenueListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    city: str
    area: str | None
    sports: list[str]
    photo_urls: list[str] = Field(default_factory=list)
    status: VenueStatus
    average_rating: float | None = None
    review_count: int = 0  # Section 32 Part 6
    distance_meters: float | None = None


class PhotoOrderIn(BaseModel):
    """Section 32 Part 6: the desired ordered list of a venue's/court's own photo keys
    (index 0 = cover). Reorder = new order; delete = omit a key; set-cover = put it first."""

    photos: list[str] = Field(default_factory=list)


class VenueListResponse(BaseModel):
    venues: list[VenueListItemOut]
    total: int
    page: int
