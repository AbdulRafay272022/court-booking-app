import uuid

from sqlalchemy import ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import CreatedAtMixin


class FavoriteVenue(CreatedAtMixin, Base):
    """A venue a player saved. One row per (user, venue): the pair is the primary key, so saving twice is a no-op and the
    table can never hold more rows for a user than there are venues. Private to the user; rows disappear with either the
    user or the venue (ON DELETE CASCADE). A venue that stops being approved/active keeps its rows but is not listed."""

    __tablename__ = "favorite_venues"
    __table_args__ = (Index("idx_favorite_venues_user", "user_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    venue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), primary_key=True)
