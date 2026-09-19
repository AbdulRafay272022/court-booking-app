import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPkMixin


class WaitlistEntry(UUIDPkMixin, CreatedAtMixin, Base):
    __tablename__ = "waitlist"
    __table_args__ = (
        # Partial (not plain) unique: a player can only be on the waitlist for
        # a given court+slot once *while active* -- after cancelling, they can
        # join again. Mirrors one_live_booking_per_slot's "only live rows
        # count" pattern rather than a blanket historical uniqueness rule.
        Index(
            "unique_active_waitlist",
            "court_id",
            "player_id",
            "slot_starts_at",
            unique=True,
            postgresql_where=text("is_active"),
        ),
        Index("idx_waitlist_slot", "court_id", "slot_starts_at", postgresql_where=text("is_active")),
    )

    court_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("courts.id"), nullable=False)
    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    slot_starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )

    court: Mapped["Court"] = relationship()  # noqa: F821
    player: Mapped["User"] = relationship()  # noqa: F821
