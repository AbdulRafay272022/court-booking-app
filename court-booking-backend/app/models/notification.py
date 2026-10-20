import uuid

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPkMixin


class NotificationLog(UUIDPkMixin, CreatedAtMixin, Base):
    """What was sent to whom, over which channel, and why -- lets us report on
    delivery/read rates and on WhatsApp cost category (utility vs marketing)."""

    __tablename__ = "notification_log"
    __table_args__ = (
        Index("idx_notif_user", "user_id", text("created_at DESC")),
        Index("idx_notif_cost", "cost_category", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    template_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), default="sent", server_default=text("'sent'"), nullable=False
    )
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    cost_category: Mapped[str | None] = mapped_column(String(20), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Round 2 Stage 2: small JSON the feed can show when reference_id resolves to nothing (digest numbers,
    # premium/marketing details, reminder counts). Only values already shown to this user; never phone/CNIC.
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    user: Mapped["User"] = relationship()  # noqa: F821
