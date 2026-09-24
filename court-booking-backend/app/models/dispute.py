import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, text
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
    down and refund/resolve manually. See AUDIT_FINDINGS.md finding #5.

    Section 32 Part 10 added the refund_* columns: this same row (reused,
    not a parallel table) is now also where a manual, no-payment-gateway
    refund is tracked end to end -- how much is owed, whether it's been
    paid outside the app, and by whom/when/with what reference."""

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

    # Section 32 Part 10 (manual refunds). `refund_amount` is computed once,
    # at the moment this row is written (BookingService), from what was
    # actually paid -- never recomputed later, since the booking's own
    # amount_paid doesn't change after cancellation. `refund_status` is a
    # plain string (mirrors `reason`'s own styling, not a full Postgres ENUM
    # -- this codebase reserves real ENUMs for core state-machine columns).
    refund_amount: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    refund_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="owed", server_default=text("'owed'")
    )
    refunded_amount: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    refund_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    refund_screenshot_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    refunded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    booking: Mapped["Booking"] = relationship()  # noqa: F821
    payment: Mapped["Payment"] = relationship()  # noqa: F821
