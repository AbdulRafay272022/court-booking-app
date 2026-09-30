import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.venue import VenueStatus
from app.schemas.court import CourtOut


# QA (signup-venue round, item 5): the wizard previously accepted "!!!", "abc" and even an
# empty-ish string on every bank-details field. These fields drive real player payouts, so
# obviously-invalid values must be rejected -- but not so tightly that a real Pakistani account
# number (typically 10-24 digits depending on bank) or a legitimate bank name is refused.
_PK_ACCOUNT_NUMBER = re.compile(r"^\d{8,24}$")
_BANK_TITLE_ALLOWED = re.compile(r"^[A-Za-z][A-Za-z0-9 .,'&()/-]{1,79}$")


def _check_bank_name(v: str) -> str:
    v = v.strip()
    if not _BANK_TITLE_ALLOWED.match(v):
        raise ValueError(
            "Enter a real bank / wallet name (e.g. 'HBL', 'Meezan Bank', 'JazzCash', 'Easypaisa')."
        )
    return v


def _check_account_title(v: str) -> str:
    v = " ".join(v.split())
    # Account title = the person / business name printed on the account; must be at least a
    # first + last chunk. Two letters minimum per chunk defends against "a b" being taken as
    # a valid full name.
    parts = v.split(" ")
    if len(parts) < 2 or any(len(p) < 2 for p in parts):
        raise ValueError("Enter the full name printed on the bank account (e.g. 'Ali Raza').")
    if not _BANK_TITLE_ALLOWED.match(v):
        raise ValueError("Enter the full name printed on the bank account.")
    return v


def _check_account_number(v: str) -> str:
    v = re.sub(r"[\s-]", "", v)
    if not _PK_ACCOUNT_NUMBER.match(v):
        raise ValueError("Enter your account number (digits only, 8-24 characters).")
    return v


def _check_iban(v: str | None) -> str | None:
    if v is None:
        return None
    v = re.sub(r"\s", "", v).upper()
    # Pakistani IBAN is exactly 24 chars: PK + 2 check digits + 4 bank + 16 account.
    if not re.match(r"^PK\d{2}[A-Z0-9]{20}$", v):
        raise ValueError("Enter a valid Pakistani IBAN (starts with PK and is 24 characters).")
    return v


class BankDetailsIn(BaseModel):
    bank: str
    account_title: str
    account_number: str
    iban: str | None = None

    @field_validator("bank")
    @classmethod
    def _v_bank(cls, v: str) -> str:
        return _check_bank_name(v)

    @field_validator("account_title")
    @classmethod
    def _v_title(cls, v: str) -> str:
        return _check_account_title(v)

    @field_validator("account_number")
    @classmethod
    def _v_number(cls, v: str) -> str:
        return _check_account_number(v)

    @field_validator("iban")
    @classmethod
    def _v_iban(cls, v: str | None) -> str | None:
        return _check_iban(v)


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
    # Same order as photo_urls; the owner UI reorders/deletes by key (Section 32 Part 6).
    photo_keys: list[str] = Field(default_factory=list)
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


class VenuePublicOut(BaseModel):
    """QA signup-venue round item 10 (defense in depth): the response shape for the two
    genuinely-public venue endpoints (GET /venues/{id}, GET /venues/by-slug/{slug}) and for
    anywhere else a caller might not be the venue's owner or an admin. Structurally cannot
    carry bank_details or checkin_qr_token -- the fields don't exist on this model at all --
    so a future call site that forgets to route through VenueService.to_out()'s per-caller
    check cannot leak them. Kept in lock-step with VenueOut's public fields; when a new
    field is added there and it is safe for the public, add it here too."""

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
    photo_keys: list[str] = Field(default_factory=list)
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
    review_count: int = 0
    distance_meters: float | None = None
    available_slots_today: int | None = None
    # Deliberately absent: bank_details, checkin_qr_token. See docstring.


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
    # Lowest starting price (PKR per slot) among the venue's active courts, only courts of the requested sport
    # when the `sport` filter is given; null when no active court has an active pricing rule.
    min_price: float | None = None


class VenueAreasOut(BaseModel):
    areas: list[str]


class PhotoOrderIn(BaseModel):
    """Section 32 Part 6: the desired ordered list of a venue's/court's own photo keys
    (index 0 = cover). Reorder = new order; delete = omit a key; set-cover = put it first."""

    photos: list[str] = Field(default_factory=list)


class VenueListResponse(BaseModel):
    venues: list[VenueListItemOut]
    total: int
    page: int
