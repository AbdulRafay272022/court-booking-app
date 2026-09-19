import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, TimestampMixin, UUIDPkMixin, pg_enum


class UserRole(str, enum.Enum):
    PLAYER = "player"
    OWNER = "owner"
    ADMIN = "admin"


class User(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "users"

    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        pg_enum(UserRole, "user_role"),
        default=UserRole.PLAYER,
        server_default="player",
        nullable=False,
    )
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reliability_score: Mapped[float] = mapped_column(
        Numeric(3, 2), default=1.00, server_default=text("1.00"), nullable=False
    )
    total_bookings: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    total_no_shows: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    total_rejections: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    suspension_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    venues: Mapped[list["Venue"]] = relationship(back_populates="owner")  # noqa: F821
    bookings: Mapped[list["Booking"]] = relationship(back_populates="player")  # noqa: F821


class Session(UUIDPkMixin, CreatedAtMixin, Base):
    """A long-lived auth token for one device. Devices carry their own row so a
    user can be logged in on several phones/browsers at once and revoke one
    without touching the others."""

    __tablename__ = "sessions"
    __table_args__ = (
        Index("idx_sessions_expires", "expires_at", postgresql_where=text("NOT is_revoked")),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    device_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()", nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_revoked: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    revoked_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)

    user: Mapped["User"] = relationship()


class OtpRequest(UUIDPkMixin, CreatedAtMixin, Base):
    __tablename__ = "otp_requests"
    __table_args__ = (Index("idx_otp_phone", "phone", "created_at"),)

    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    otp_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    is_used: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
