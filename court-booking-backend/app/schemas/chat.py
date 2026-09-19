import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ChatMessageIn(BaseModel):
    venue_id: uuid.UUID | None = None
    booking_id: uuid.UUID | None = None
    message: str = Field(min_length=1, max_length=2000)


class ChatActionOut(BaseModel):
    type: str
    label: str
    data: dict


class ChatMessageOut(BaseModel):
    reply: str
    actions: list[ChatActionOut] = Field(default_factory=list)


class ChatHistoryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sender_type: str
    channel: str
    content: str
    created_at: datetime
