import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPkMixin


class Payment(UUIDPkMixin, CreatedAtMixin, Base):
    """One payment-proof submission for a booking. A booking can have more than
    one row here -- e.g. a rejected proof followed by a resubmission."""

    __tablename__ = "payments"
    __table_args__ = (
        # Stops two concurrent payment-proof submissions for the same
        # booking outright -- the second INSERT blocks on/fails this
        # constraint instead of both racing through OCR and each getting a
        # row, one of which could later silently un-confirm the other's
        # already-approved booking (see booking_service's atomic-transition
        # guards on confirm_booking/mark_payment_submitted for the other
        # half of this fix).
        Index(
            "one_pending_payment_per_booking",
            "booking_id",
            unique=True,
            postgresql_where=text("review_verdict IS NULL"),
        ),
    )

    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True
    )
    proof_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    proof_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    amount_claimed: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    ocr_amount: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    ocr_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ocr_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ocr_verdict: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ocr_confidence: Mapped[float | None] = mapped_column(Numeric(3, 2), nullable=True)
    ocr_raw: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_duplicate: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    duplicate_of: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id"), nullable=True
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    review_verdict: Mapped[str | None] = mapped_column(String(20), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auto_approved: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )

    booking: Mapped["Booking"] = relationship(back_populates="payments")  # noqa: F821
