"""Round 2 Stage 2 schemas (docs/stage2-contract.md; TS mirror packages/types/src/stage2.ts)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class VenueTimerValuesIn(BaseModel):
    hold_minutes: int | None = None
    reminders_enabled: bool | None = None
    first_reminder_after_min: int | None = None
    repeat_every_min: int | None = None
    max_reminders: int | None = None
    auto_cancel_enabled: bool | None = None
    auto_cancel_after_min: int | None = None


class VenueTimerEffectiveOut(BaseModel):
    hold_minutes: int
    reminders_enabled: bool
    first_reminder_after_min: int
    repeat_every_min: int
    max_reminders: int
    auto_cancel_enabled: bool
    auto_cancel_after_min: int


class VenueTimersOut(BaseModel):
    values: VenueTimerValuesIn
    defaults: VenueTimerEffectiveOut
    effective: VenueTimerEffectiveOut


class VenuePermissionsOut(BaseModel):
    venue_id: uuid.UUID
    permissions: list[str]


class MyPermissionsOut(BaseModel):
    role: Literal["owner", "staff", "admin"]
    venue_permissions: list[VenuePermissionsOut]


class OwnerIdentityOut(BaseModel):
    status: Literal["missing", "submitted", "verified", "rejected"]
    masked: str | None
    flags: list[str]
    rejection_reason: str | None = None  # audit 2026-10-28 Phase 2 item 1


class AdminIdentityRowOut(BaseModel):
    user_id: uuid.UUID
    owner_name: str | None
    phone_last4: str | None
    status: Literal["missing", "submitted", "verified", "rejected"]
    masked: str | None
    flags: list[str]
    submitted_at: datetime | None
    rejection_reason: str | None = None
    reviewed_at: datetime | None = None


class AdminIdentityPageOut(BaseModel):
    items: list[AdminIdentityRowOut]
    total: int
    page: int
    page_size: int


class AdminIdentityFullOut(AdminIdentityRowOut):
    number: str
    front_url: str
    back_url: str
    verified_at: datetime | None


class IdentityRejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class WebPushConfigOut(BaseModel):
    enabled: bool
    public_key: str | None


class WebPushKeysIn(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class WebPushSubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)
    keys: WebPushKeysIn
    user_agent: str | None = Field(default=None, max_length=500)


class WebPushUnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)


class WebPushStatusOut(BaseModel):
    subscribed: bool
