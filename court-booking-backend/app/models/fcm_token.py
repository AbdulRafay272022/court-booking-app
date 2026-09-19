import uuid

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class FCMToken(UUIDPkMixin, TimestampMixin, Base):
    """A push-notification token for one device. A user may have several
    active tokens (one per device they're logged into)."""

    __tablename__ = "fcm_tokens"
    __table_args__ = (Index("idx_fcm_user", "user_id", postgresql_where=text("is_active")),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    platform: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )

    user: Mapped["User"] = relationship()  # noqa: F821
