import uuid
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin


class AuditLog(CreatedAtMixin, Base):
    """Every state transition, with before/after values, for compliance and
    debugging. Uses a BIGSERIAL id (not UUID) since it's an append-only,
    monotonically-ordered log rather than an entity with a stable identity."""

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("idx_audit_entity", "entity_type", "entity_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    old_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    actor_type: Mapped[str] = mapped_column(
        String(20), default="system", server_default=text("'system'"), nullable=False
    )
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)

    actor: Mapped["User | None"] = relationship()  # noqa: F821
