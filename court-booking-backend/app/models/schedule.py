import uuid
from datetime import time

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, SmallInteger, Time, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class ScheduleTemplate(UUIDPkMixin, TimestampMixin, Base):
    """Recurring weekly opening hours for a court. The availability grid is
    generated from these on read -- individual slots are never stored, so
    changing a venue's hours never requires a data migration."""

    __tablename__ = "schedule_templates"
    __table_args__ = (
        CheckConstraint("day_of_week BETWEEN 0 AND 6", name="valid_day"),
        # Section 32 Part 3 (overnight courts): a day either closes the same day (open < close) or the next morning
        # (closes_next_day, close <= open: 03:00 vs 15:00, midnight = 00:00, close == open = open 24 hours).
        CheckConstraint(
            "(closes_next_day AND close_time <= open_time) OR (NOT closes_next_day AND open_time < close_time)",
            name="valid_times",
        ),
        Index(
            "idx_schedule_court_day",
            "court_id",
            "day_of_week",
            unique=True,
            postgresql_where=text("is_active"),
        ),
    )

    court_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day_of_week: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    open_time: Mapped[time] = mapped_column(Time, nullable=False)
    close_time: Mapped[time] = mapped_column(Time, nullable=False)
    # The schedule day belongs to the day it OPENS; when this is true the court is still open past midnight, until
    # close_time the next morning. Derived by the API from the times (close_time <= open_time), stored explicitly.
    closes_next_day: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )

    court: Mapped["Court"] = relationship(back_populates="schedule_templates")  # noqa: F821
