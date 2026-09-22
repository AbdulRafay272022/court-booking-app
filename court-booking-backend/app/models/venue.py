import enum
import uuid

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin, pg_enum


class VenueStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    CHANGES_REQUESTED = "changes_requested"
    REJECTED = "rejected"


class PlanTier(str, enum.Enum):
    FREE = "free"
    PRO = "pro"
    BUSINESS = "business"


class Venue(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "venues"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    area: Mapped[str | None] = mapped_column(String(100), nullable=True)
    location: Mapped[str] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=False
    )
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    whatsapp: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sports: Mapped[list[str]] = mapped_column(ARRAY(String(50)), nullable=False)
    amenities: Mapped[list[str] | None] = mapped_column(ARRAY(String(50)), nullable=True)
    photos: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    bank_details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[VenueStatus] = mapped_column(
        pg_enum(VenueStatus, "venue_status"),
        default=VenueStatus.PENDING,
        server_default="pending",
        nullable=False,
        index=True,
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    auto_approve_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    auto_approve_min_bookings: Mapped[int] = mapped_column(
        Integer, default=5, server_default=text("5"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    # Section 32 Part 4: the cancellation policy is ONE per venue (this deliberately reverses
    # Section 31's per-court policy). Whether a player may cancel a booking they've already paid
    # for, and if so how many hours before the start it stops being allowed (NULL = any time
    # before the start). The old per-court columns on `courts` are deprecated and unused.
    cancellation_allowed: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    cancellation_cutoff_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Section 32 Part 4b: how many days ahead a player can book at this venue (a per-venue setting, default 90). The
    # calendar stops there and holds beyond it are refused; an owner's walk-in is not limited by it.
    booking_horizon_days: Mapped[int] = mapped_column(
        Integer, default=90, server_default=text("90"), nullable=False
    )
    plan_tier: Mapped[PlanTier] = mapped_column(
        pg_enum(PlanTier, "plan_tier"),
        default=PlanTier.FREE,
        server_default="free",
        nullable=False,
    )
    # A per-venue token meant to be printed/posted physically at the venue
    # (one QR per location, not per court, since multiple courts commonly
    # share one entrance) -- POST /bookings/{id}/checkin/self validates a
    # scanned token against this, so a player can self-check-in by being
    # physically present, as an alternative to the owner scanning the
    # player's own QR from My Bookings. See finding #17 in AUDIT_FINDINGS.md.
    checkin_qr_token: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), unique=True, server_default=text("gen_random_uuid()"), nullable=False
    )

    # NOTE: the GIST index on `location` is created automatically by GeoAlchemy2's
    # DDL event listener (named idx_venues_location, matching the spec) as part of
    # table creation -- an explicit Index() here would collide with it.
    __table_args__ = (
        Index("idx_venues_sports", "sports", postgresql_using="gin"),
        CheckConstraint("booking_horizon_days BETWEEN 1 AND 365", name="valid_booking_horizon"),
    )

    owner: Mapped["User"] = relationship(back_populates="venues")  # noqa: F821
    courts: Mapped[list["Court"]] = relationship(  # noqa: F821
        back_populates="venue", cascade="all, delete-orphan"
    )
    reviews: Mapped[list["Review"]] = relationship(back_populates="venue")  # noqa: F821
