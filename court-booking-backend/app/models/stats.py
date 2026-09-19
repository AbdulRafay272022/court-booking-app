import uuid
from datetime import date

from sqlalchemy import (
    BigInteger,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SlotStats(Base):
    """Nightly-materialized booking-rate stats per court/day-of-week/hour, so
    the growth dashboard doesn't scan the full bookings table on every
    request. See app/jobs/growth_job.py."""

    __tablename__ = "slot_stats"
    __table_args__ = (
        UniqueConstraint("court_id", "day_of_week", "hour", "computed_at", name="unique_stat"),
        Index("idx_stats_court", "court_id", "computed_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    court_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("courts.id"), nullable=False)
    day_of_week: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    hour: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    total_slots: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    booked_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    booking_rate: Mapped[float] = mapped_column(
        Numeric(5, 4), default=0, server_default=text("0"), nullable=False
    )
    avg_price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    weeks_of_data: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    computed_at: Mapped[date] = mapped_column(Date, nullable=False)

    court: Mapped["Court"] = relationship()  # noqa: F821
