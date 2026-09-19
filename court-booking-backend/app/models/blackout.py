import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPkMixin


class Blackout(UUIDPkMixin, CreatedAtMixin, Base):
    """A window a court is unavailable: maintenance, rain, a private event."""

    __tablename__ = "blackouts"
    __table_args__ = (
        CheckConstraint("starts_at < ends_at", name="valid_blackout"),
        Index("idx_blackouts_court_time", "court_id", "starts_at", "ends_at"),
    )

    court_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courts.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    court: Mapped["Court"] = relationship(back_populates="blackouts")  # noqa: F821
