import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class PaymentDispute(UUIDPkMixin, TimestampMixin, Base):
    """A booking whose payment_submitted status expired (the owner never
    acted) while the submitted proof looked like a real payment -- OCR
    verdict wasn't 'mismatch' and it wasn't flagged a duplicate. Written by
    BookingService.expire_stale_bookings so a player who plausibly paid and
    lost their booking isn't a silent gap: an admin has a queue to chase
    down and refund/resolve manually, even though nothing here executes an
    actual refund. See AUDIT_FINDINGS.md finding #5."""

    __tablename__ = "payment_disputes"

    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id"), nullable=False
    )
    player_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reason: Mapped[str] = mapped_column(String(50), nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"), nullable=False)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    booking: Mapped["Booking"] = relationship()  # noqa: F821
    payment: Mapped["Payment"] = relationship()  # noqa: F821
