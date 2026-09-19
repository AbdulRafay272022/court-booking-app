import uuid

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPkMixin


class Message(UUIDPkMixin, CreatedAtMixin, Base):
    """Unified log of in-app chat and WhatsApp messages, scoped to a venue and
    optionally a specific booking."""

    __tablename__ = "messages"
    __table_args__ = (
        Index("idx_messages_booking", "booking_id", "created_at"),
        Index("idx_messages_venue", "venue_id", "created_at"),
        # A given WhatsApp message ID must never be recorded twice -- this is
        # what actually protects against a webhook retry double-processing a
        # message, not an application-level "have I seen this?" check.
        Index("uq_messages_whatsapp_msg_id", "whatsapp_msg_id", unique=True, postgresql_where=text("whatsapp_msg_id IS NOT NULL")),
    )

    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=True
    )
    # Nullable: a WhatsApp conversation can start before any venue is known
    # (one platform number handles every venue; the AI figures out which
    # venue -- if any -- the conversation is about).
    venue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("venues.id"), nullable=True
    )
    # NOTE: for player messages this is literally who sent it; for ai/system
    # messages it's the *thread owner* -- the human on the other end of the
    # exchange, not a real sender. That's what lets a conversation's history
    # be reconstructed with one query (sender_id == user.id, any sender_type)
    # without a separate "conversation" concept. `sender_type` is what
    # actually distinguishes who said a given message.
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    sender_type: Mapped[str] = mapped_column(String(20), nullable=False)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[str] = mapped_column(
        String(20), default="text", server_default=text("'text'"), nullable=False
    )
    whatsapp_msg_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    meta: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)

    booking: Mapped["Booking | None"] = relationship()  # noqa: F821
    venue: Mapped["Venue | None"] = relationship()  # noqa: F821
    sender: Mapped["User | None"] = relationship()  # noqa: F821
