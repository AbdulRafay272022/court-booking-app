import uuid

from sqlalchemy import ARRAY, Boolean, ForeignKey, Integer, String, Text, literal_column, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class Court(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "courts"

    venue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sport: Mapped[str] = mapped_column(String(50), nullable=False)
    slot_minutes: Mapped[int] = mapped_column(
        Integer, default=60, server_default=text("60"), nullable=False
    )
    surface_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_indoor: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    has_floodlights: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # DEPRECATED, drop next release (Section 32 Part 4). The cancellation policy moved to
    # `venues.cancellation_allowed` / `venues.cancellation_cutoff_hours`. These two mapped columns are
    # never read or written by the code (the underscore names make any use stand out); they stay in the
    # table for one release only so the migration is reversible.
    _deprecated_cancellation_allowed: Mapped[bool] = mapped_column(
        "cancellation_allowed", Boolean, default=True, server_default=text("true"), nullable=False
    )
    _deprecated_cancellation_cutoff_hours: Mapped[int | None] = mapped_column(
        "cancellation_cutoff_hours", Integer, nullable=True
    )
    # Read-only mirror of the VENUE's policy under the old attribute names, so API responses keep the
    # fields that app builds from before Section 32 Part 4 still read (the mobile app needs an EAS build
    # to update). It is computed by the database from the venue row -- there is only one source of truth.
    cancellation_allowed: Mapped[bool] = column_property(
        literal_column("(SELECT v.cancellation_allowed FROM venues v WHERE v.id = courts.venue_id)", Boolean),
        deferred=False,
    )
    cancellation_cutoff_hours: Mapped[int | None] = column_property(
        literal_column("(SELECT v.cancellation_cutoff_hours FROM venues v WHERE v.id = courts.venue_id)", Integer),
        deferred=False,
    )
    # Deprecated single-photo column (kept one release, unused now that Part 6 added
    # the `photos` gallery below). CourtOut.photo_urls is computed from `photos`.
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Section 32 Part 6: per-court photo gallery, list of S3 keys (mirrors venues.photos);
    # order is display order, index 0 is the cover.
    photos: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )

    venue: Mapped["Venue"] = relationship(back_populates="courts")  # noqa: F821
    schedule_templates: Mapped[list["ScheduleTemplate"]] = relationship(  # noqa: F821
        back_populates="court", cascade="all, delete-orphan"
    )
    pricing_rules: Mapped[list["PricingRule"]] = relationship(  # noqa: F821
        back_populates="court", cascade="all, delete-orphan"
    )
    blackouts: Mapped[list["Blackout"]] = relationship(  # noqa: F821
        back_populates="court", cascade="all, delete-orphan"
    )
    bookings: Mapped[list["Booking"]] = relationship(back_populates="court")  # noqa: F821
