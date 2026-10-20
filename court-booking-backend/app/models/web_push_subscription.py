import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import UUIDPkMixin


class WebPushSubscription(UUIDPkMixin, Base):
    """One browser Web Push subscription (docs/web-push-plan.md section 3). `endpoint` is the push service URL
    the server POSTs to (host allow-listed at subscribe time); `p256dh`/`auth` are the browser's keys used for
    RFC 8291 encryption. revoked_at NULL = active."""

    __tablename__ = "web_push_subscriptions"
    __table_args__ = (
        UniqueConstraint("endpoint", name="uq_web_push_endpoint"),
        Index("idx_web_push_user_active", "user_id", postgresql_where=text("revoked_at IS NULL")),
        Index("idx_web_push_revoked", "revoked_at", postgresql_where=text("revoked_at IS NOT NULL")),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()  # noqa: F821
