import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ReviewCreateIn(BaseModel):
    booking_id: uuid.UUID
    rating: int = Field(ge=1, le=5)
    comment: str | None = None


class ReviewUpdateIn(BaseModel):
    """Player edits their own review within the 7-day window (Section 32 Part 6)."""

    rating: int = Field(ge=1, le=5)
    comment: str | None = None


class ReviewReplyIn(BaseModel):
    owner_reply: str = Field(min_length=1)


class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    booking_id: uuid.UUID
    venue_id: uuid.UUID
    player_id: uuid.UUID
    # Only the player's FIRST name is ever shown publicly (privacy). Set by the service.
    player_first_name: str | None = None
    rating: int
    comment: str | None
    owner_reply: str | None
    owner_replied_at: datetime | None
    is_hidden: bool = False
    created_at: datetime
    updated_at: datetime | None = None


class ReviewSummaryOut(BaseModel):
    """Aggregate shown on venue/search cards (Section 32 Part 6)."""

    average_rating: float | None = None
    review_count: int = 0
