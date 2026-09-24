import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FeatureFlagKey(str, enum.Enum):
    """The canonical set of admin-controlled global kill switches (Section 32
    Part 12). Stored one row per key in feature_flags; the enum is the source of
    truth for which keys exist and is what the seed and the admin panel iterate.

    Not a Postgres enum -- the column is a plain String so adding a future flag
    is a data insert, not an ALTER TYPE. This class just keeps the vocabulary in
    one place and lets code reference a flag by attribute instead of a literal."""

    OCR_VERIFICATION = "ocr_verification"          # Part 7 -- AI OCR payment extraction + verdicts
    QR_CHECKIN = "qr_checkin"                        # Part 9 -- QR generate/scan check-in
    SPLIT_PAYMENTS = "split_payments"               # Part 5 -- split payments / balance UI
    REFUNDS = "refunds"                              # Part 10 -- manual refund actions
    AI_CHAT_BOOKING = "ai_chat_booking"             # Part 8 -- AI "do you want to book" assistant
    PHOTOS = "photos"                               # Part 6 -- venue/court photo galleries
    REVIEWS = "reviews"                             # Part 6 -- ratings + reviews
    GROWTH_SUGGESTIONS = "growth_suggestions"       # discount/underbooked-slot suggestions
    PUSH_NOTIFICATIONS = "push_notifications"        # push/WhatsApp notification side effects
    AUTO_APPROVE = "auto_approve"                    # auto-confirm payments (separate from OCR)
    WAITLIST = "waitlist"                            # "Notify me" on booked slots
    MARKETING_ANNOUNCEMENTS = "marketing_announcements"  # owner paid broadcast (Tier 3)
    DIGEST_REMINDERS = "digest_reminders"           # owner daily digest + booking reminder jobs


# key -> (human label, one-line description) for the seed and the admin panel.
# All flags ship ON; an admin turns one OFF to fall back to the documented
# pre-feature behavior (see docs/SECTION_32_PLAN.md Part 12).
FEATURE_FLAG_SEED: dict[str, tuple[str, str]] = {
    FeatureFlagKey.OCR_VERIFICATION.value: (
        "AI payment verification",
        "Auto-read payment screenshots and show verdicts. OFF: owner reviews every screenshot by eye.",
    ),
    FeatureFlagKey.QR_CHECKIN.value: (
        "QR check-in",
        "QR generate/scan check-in. OFF: owner marks checked-in / no-show manually from the dashboard.",
    ),
    FeatureFlagKey.SPLIT_PAYMENTS.value: (
        "Split payments",
        "Partial advance + balance and the payment ledger UI. OFF: new bookings require full payment upfront.",
    ),
    FeatureFlagKey.REFUNDS.value: (
        "Manual refunds",
        "Owner refund tracking + mark-refunded. OFF: no new refund actions (already-owed refunds stay visible).",
    ),
    FeatureFlagKey.AI_CHAT_BOOKING.value: (
        "AI chat booking",
        "AI 'do you want to book' assistant. OFF: booking through app screens only; support chat still works.",
    ),
    FeatureFlagKey.PHOTOS.value: (
        "Venue photos",
        "Photo galleries on venue/court pages. OFF: venues show core info only.",
    ),
    FeatureFlagKey.REVIEWS.value: (
        "Ratings & reviews",
        "Player ratings and reviews. OFF: review/rating sections hidden everywhere.",
    ),
    FeatureFlagKey.GROWTH_SUGGESTIONS.value: (
        "Discount suggestions",
        "Underbooked-slot discount suggestions for owners. OFF: no suggestions surfaced.",
    ),
    FeatureFlagKey.PUSH_NOTIFICATIONS.value: (
        "Notifications",
        "Push / WhatsApp notification side effects. OFF: notifications suppressed; booking logic unaffected.",
    ),
    FeatureFlagKey.AUTO_APPROVE.value: (
        "Auto-approve payments",
        "Auto-confirm eligible payments without owner tap. OFF: every payment goes to manual review.",
    ),
    FeatureFlagKey.WAITLIST.value: (
        "Waitlist",
        "'Notify me' on booked slots. OFF: waitlist join hidden; no availability notifications.",
    ),
    FeatureFlagKey.MARKETING_ANNOUNCEMENTS.value: (
        "Announcements",
        "Owner paid broadcast announcements. OFF: the announcement action is disabled.",
    ),
    FeatureFlagKey.DIGEST_REMINDERS.value: (
        "Digest & reminders",
        "Owner daily digest and booking reminder jobs. OFF: those scheduled messages stop sending.",
    ),
}


class FeatureFlag(Base):
    """One admin-controlled global kill switch. Read at the point of use (via
    FeatureFlagService, cached briefly on app.state) so an admin can flip a flag
    with no redeploy. A missing row is treated as ON (fail-open) so a newly-added
    flag key doesn't accidentally disable a live feature before its seed lands."""

    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(100), nullable=False, server_default=text("''"))
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
