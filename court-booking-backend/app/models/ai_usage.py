import uuid

from sqlalchemy import BigInteger, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import CreatedAtMixin


class AIUsageLog(CreatedAtMixin, Base):
    """One row per AI provider call (chat turn or vision/OCR call), so "did
    switching to Gemini actually save money" (Section 21) has real numbers
    behind it instead of a guess. `reference_id` is the booking_id for a
    vision call; chat turns aren't always scoped to one booking, so it's
    nullable there."""

    __tablename__ = "ai_usage_log"
    __table_args__ = (Index("idx_ai_usage_provider", "provider", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)  # claude | gemini | openai
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)  # chat | vision
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
