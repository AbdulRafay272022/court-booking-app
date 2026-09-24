import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPkMixin


class Review(UUIDPkMixin, CreatedAtMixin, Base):
    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="valid_rating"),
        Index("idx_reviews_venue", "venue_id", "created_at"),
    )

    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, unique=True
    )
    venue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("venues.id"), nullable=False)
    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Section 32 Part 6: admin moderation + player-edit tracking.
    is_hidden: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    venue: Mapped["Venue"] = relationship(back_populates="reviews")  # noqa: F821
    player: Mapped["User"] = relationship()  # noqa: F821
