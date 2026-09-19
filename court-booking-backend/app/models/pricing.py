import uuid
from datetime import time

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Numeric, SmallInteger, String, Time, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import TimestampMixin, UUIDPkMixin


class PricingRule(UUIDPkMixin, TimestampMixin, Base):
    """Rules are evaluated in priority order (highest first); the first rule
    whose day/time window matches a slot sets its price."""

    __tablename__ = "pricing_rules"
    __table_args__ = (Index("idx_pricing_court", "court_id", text("priority DESC")),)

    court_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courts.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    day_of_week: Mapped[list[int] | None] = mapped_column(ARRAY(SmallInteger), nullable=True)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    price_per_slot: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    floodlight_surcharge: Mapped[float] = mapped_column(
        Numeric(10, 2), default=0, server_default=text("0"), nullable=False
    )
    advance_percentage: Mapped[float] = mapped_column(
        Numeric(5, 2), default=100.00, server_default=text("100.00"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true"), nullable=False
    )

    court: Mapped["Court"] = relationship(back_populates="pricing_rules")  # noqa: F821
