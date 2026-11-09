"""fix/nov-9 items 9-12 (migration c3e8a1f5b902): each refund sent and the player's answer; escalations to Khelo."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import CreatedAtMixin, TimestampMixin, UUIDPkMixin


class RefundTransfer(UUIDPkMixin, CreatedAtMixin, Base):
    """One "Refund bhej diya" by the venue (a refund can go in parts)."""

    __tablename__ = "refund_transfers"

    dispute_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payment_disputes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    screenshot_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    sent_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    ocr_amount: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    ocr_receiver: Mapped[str | None] = mapped_column(Text, nullable=True)
    # match | mismatch | unreadable | no_screenshot
    ocr_verdict: Mapped[str] = mapped_column(String(14), nullable=False, default="no_screenshot", server_default=text("'no_screenshot'"))
    # why it is not a match: amount | receiver | receiver_not_visible | amount_not_visible | no_payout_details
    ocr_reasons: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    player_response: Mapped[str | None] = mapped_column(String(14), nullable=True)  # received | not_received
    player_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # rows written by the migration for refunds sent before it: never OCR-checked, the player is not asked about them
    backfilled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))


class Escalation(UUIDPkMixin, TimestampMixin, Base):
    """"Khelo se shikayat karein": the player takes a venue's "no" to the super admin."""

    __tablename__ = "escalations"
    __table_args__ = (UniqueConstraint("kind", "source_id", name="uq_escalations_kind_source"),)

    kind: Mapped[str] = mapped_column(String(14), nullable=False)  # no_show | short_payment | refund
    # the NoShowReply / ShortPaymentClaim / RefundTransfer it is about
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    booking_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True)
    venue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("venues.id"), nullable=False, index=True)
    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="open", server_default=text("'open'"), index=True)
    admin_decision: Mapped[str | None] = mapped_column(String(10), nullable=True)  # player | venue
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
