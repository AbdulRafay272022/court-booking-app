import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    channel: str
    event_type: str
    status: str
    cost_category: str | None
    reference_id: uuid.UUID | None
    created_at: datetime
