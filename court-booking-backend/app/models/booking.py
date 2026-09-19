import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin, pg_enum


class BookingStatus(str, enum.Enum):
    HELD = "held"
    PAYMENT_SUBMITTED = "payment_submitted"
    BOOKED = "booked"
    COMPLETED = "completed"
    NO_SHOW = "no_show"
    CANCELLED = "cancelled"


class BookingSource(str, enum.Enum):
    APP = "app"
    WHATSAPP = "whatsapp"
    WALKIN = "walkin"
    PHONE = "phone"


class CancelledBy(str, enum.Enum):
    PLAYER = "player"
    OWNER = "owner"
    SYSTEM = "system"


# Statuses that still hold a live claim on the slot -- mirrors the DB partial
# unique index below, which is the actual source of truth for "is this slot
# taken." Keep these two definitions in sync.
LIVE_BOOKING_STATUSES = (BookingStatus.HELD, BookingStatus.PAYMENT_SUBMITTED, BookingStatus.BOOKED)


class Booking(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "bookings"
    __table_args__ = (
        # *** THE SINGLE MOST IMPORTANT LINE OF CODE IN THIS SCHEMA ***
        # Postgres physically refuses a second live booking for the same
        # court+start_time. There is no check-then-write race window: this is
        # what actually prevents double-booking, not application-level locking.
        Index(
            "one_live_booking_per_slot",
            "court_id",
            "starts_at",
            unique=True,
            postgresql_where=text("status IN ('held', 'payment_submitted', 'booked')"),
        ),
        Index("idx_bookings_court_time", "court_id", "starts_at"),
        Index("idx_bookings_held_expiry", "held_until", postgresql_where=text("status = 'held'")),
        Index(
            "idx_bookings_payment_deadline",
            "payment_deadline",
            postgresql_where=text("status = 'payment_submitted'"),
        ),
    )

    court_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courts.id"), nullable=False, index=True
    )
    player_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[BookingStatus] = mapped_column(
        pg_enum(BookingStatus, "booking_status"),
        default=BookingStatus.HELD,
        server_default="held",
        nullable=False,
        index=True,
    )
    source: Mapped[BookingSource] = mapped_column(
        pg_enum(BookingSource, "booking_source"),
        default=BookingSource.APP,
        server_default="app",
        nullable=False,
    )
    player_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    player_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    advance_amount: Mapped[float] = mapped_column(
        Numeric(10, 2), default=0, server_default=text("0"), nullable=False
    )
    amount_paid: Mapped[float] = mapped_column(
        Numeric(10, 2), default=0, server_default=text("0"), nullable=False
    )
    balance_due: Mapped[float] = mapped_column(
        Numeric(10, 2), default=0, server_default=text("0"), nullable=False
    )
    held_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payment_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by: Mapped[CancelledBy | None] = mapped_column(
        pg_enum(CancelledBy, "cancelled_by"), nullable=True
    )
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    checked_in_by: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "owner" | "player"
    # Flag, don't block (same pattern as the passive-owner-inaction signal,
    # finding #14): a check-in timestamp implausibly far outside the
    # booking's own window is a signal for an admin to spot-check, not a
    # reason to reject the check-in itself. NULL means nothing to flag.
    checkin_flag_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    court: Mapped["Court"] = relationship(back_populates="bookings")  # noqa: F821
    player: Mapped["User | None"] = relationship(back_populates="bookings")  # noqa: F821
    payments: Mapped[list["Payment"]] = relationship(  # noqa: F821
        back_populates="booking", cascade="all, delete-orphan"
    )
