import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class WaitlistCreateIn(BaseModel):
    court_id: uuid.UUID
    slot_starts_at: datetime


class WaitlistJoinOut(BaseModel):
    position: int


class WaitlistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    court_id: uuid.UUID
    court_name: str
    venue_id: uuid.UUID
    venue_name: str
    player_id: uuid.UUID
    slot_starts_at: datetime
    position: int
    notified_at: datetime | None
    is_active: bool
    created_at: datetime
