import uuid
from datetime import datetime
from typing import Literal

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


class FeedParamsOut(BaseModel):
    """Owner Round 2 (A6). All optional; derived from the row's reference_id; never a phone number."""

    player_name: str | None = None
    court_name: str | None = None
    sport: str | None = None
    venue_name: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    amount: float | None = None
    reason: str | None = None


class FeedLinkOut(BaseModel):
    kind: Literal["approvals", "refunds", "booking", "bookings", "overview", "venue_status", "none"]
    booking_id: uuid.UUID | None = None


class FeedDeliveryOut(BaseModel):
    channel: Literal["push", "whatsapp", "sms", "web_push"]
    status: Literal["sent", "failed"]


class NotificationFeedItemOut(BaseModel):
    id: uuid.UUID
    event_type: str
    kind: str
    created_at: datetime
    params: FeedParamsOut
    link: FeedLinkOut
    deliveries: list[FeedDeliveryOut]


class NotificationFeedPageOut(BaseModel):
    items: list[NotificationFeedItemOut]
    page: int
    page_size: int
    has_more: bool
