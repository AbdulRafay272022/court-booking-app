import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class StaffPermissionCatalogItem(BaseModel):
    """One grantable permission, for the owner's staff-permissions UI. `available`
    is False when the permission's global feature flag is currently OFF -- the UI
    greys it out and the backend refuses to grant it."""

    key: str
    label: str
    flag_required: str | None = None
    available: bool


class StaffMemberOut(BaseModel):
    id: uuid.UUID
    venue_id: uuid.UUID
    venue_name: str
    staff_user_id: uuid.UUID
    name: str | None = None
    phone: str
    is_active: bool
    permissions: list[str]
    created_at: datetime


class StaffCreateIn(BaseModel):
    venue_id: uuid.UUID
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=6, max_length=20)
    password: str = Field(min_length=8, max_length=128)
    permissions: list[str] = Field(default_factory=list)


class StaffPermissionsUpdateIn(BaseModel):
    permissions: list[str]


class StaffActiveUpdateIn(BaseModel):
    is_active: bool
