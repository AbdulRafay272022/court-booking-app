import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, TimestampMixin, UUIDPkMixin, pg_enum


class UserRole(str, enum.Enum):
    PLAYER = "player"
    OWNER = "owner"
    ADMIN = "admin"


class Gender(str, enum.Enum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"


class City(str, enum.Enum):
    """Fixed pilot city list (Section 26, Part 0). The value is a slug; the
    province is display-only (frontends show "Karachi (Sindh)")."""

    KARACHI = "karachi"
    LAHORE = "lahore"
    ISLAMABAD = "islamabad"
    RAWALPINDI = "rawalpindi"
    FAISALABAD = "faisalabad"
    MULTAN = "multan"
    GUJRANWALA = "gujranwala"
    PESHAWAR = "peshawar"
    KOHAT = "kohat"
    HYDERABAD = "hyderabad"


class OtpPurpose(str, enum.Enum):
    """Why an OTP was issued. Stored so a code minted for one flow can't be
    redeemed in another (e.g. a password-reset code completing a signup)."""

    SIGNUP = "signup"
    REVERIFY = "reverify"
    PASSWORD_RESET = "password_reset"
    PHONE_CHANGE = "phone_change"


class User(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "users"

    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # argon2id hash. NULL for accounts created before Section 26 (they log in
    # via the reset flow, PASSWORD_NOT_SET) and never for a new signup.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Required at signup going forward, nullable only so pre-Section-26 rows
    # survive the migration. Contact info only -- NOT a login identifier yet.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[City | None] = mapped_column(pg_enum(City, "city"), nullable=True)
    gender: Mapped[Gender | None] = mapped_column(pg_enum(Gender, "gender"), nullable=True)
    # When the phone last passed an OTP. NULL = signup never completed. The
    # PHONE_VERIFICATION_TRUST_DAYS window is measured from this, not from
    # any session.
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
        DateTime(timezone=True), server_default=func.now(), nullable=False
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
    purpose: Mapped[OtpPurpose] = mapped_column(
        pg_enum(OtpPurpose, "otp_purpose"),
        default=OtpPurpose.SIGNUP,
        server_default="signup",
        nullable=False,
    )
    # Set for codes that only ONE signed-in user may redeem (phone change): the code is
    # sent to the NEW number, so `phone` alone can't say who asked for it.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    otp_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    is_used: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LoginAttempt(UUIDPkMixin, CreatedAtMixin, Base):
    """One row per FAILED password login, so the per-phone rate limit
    (LOGIN_MAX_FAILED_ATTEMPTS in LOGIN_RATE_LIMIT_WINDOW_MINUTES) is derived
    from data rather than a counter to keep in sync -- same shape as
    otp_requests' own limit. Rows for a phone are cleared on a successful
    login or password reset, so typos followed by success never lock anyone
    out. Keyed by the phone as typed, so unknown phones are throttled too
    (an attacker can't probe for which numbers exist by watching who gets
    throttled)."""

    __tablename__ = "login_attempts"
    __table_args__ = (Index("idx_login_attempts_phone", "phone", "created_at"),)

    phone: Mapped[str] = mapped_column(String(20), nullable=False)


# Case-insensitive uniqueness for email (Section 26 follow-up). A functional unique index on
# lower(email), NOT a plain unique on the column, so "A@x.com" and "a@x.com" collide. NULLs are
# distinct in a unique index, so pre-Section-26 accounts without an email don't conflict.
Index("uq_users_email_lower", func.lower(User.email), unique=True)
