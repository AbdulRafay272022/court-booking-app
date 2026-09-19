import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ReviewCreateIn(BaseModel):
    booking_id: uuid.UUID
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
    rating: int
    comment: str | None
    owner_reply: str | None
    owner_replied_at: datetime | None
    created_at: datetime
