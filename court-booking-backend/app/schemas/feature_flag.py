from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FeatureFlagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    enabled: bool
    label: str
    description: str | None = None
    updated_at: datetime


class FeatureFlagUpdateIn(BaseModel):
    enabled: bool


class PublicFlagsOut(BaseModel):
    """The on/off state of every flag, for the frontends to gate their UI. No
    auth -- knowing a feature is off isn't sensitive, and the client needs it
    before login (e.g. whether to show reviews on a public venue page)."""

    flags: dict[str, bool]
