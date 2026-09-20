import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    # Section 29 Part C: a player-cancellable PAID (booked) slot is a per-court policy, not a
    # single global rule -- some venues (or specific courts) don't allow it at all, others allow
    # it up to N hours before start. Defaults preserve today's de facto behavior (unrestricted)
    # for every existing court until an owner actively opts into a stricter policy.
    cancellation_allowed: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    cancellation_cutoff_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
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
