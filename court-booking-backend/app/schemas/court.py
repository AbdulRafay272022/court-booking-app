import uuid
from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, Field


class ScheduleTemplateIn(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    open_time: time
    close_time: time


class ScheduleTemplateOut(ScheduleTemplateIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    is_active: bool


class PricingRuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    priority: int = 0
    day_of_week: list[int] | None = None
    start_time: time | None = None
    end_time: time | None = None
    price_per_slot: float = Field(gt=0)
    floodlight_surcharge: float = Field(default=0, ge=0)
    advance_percentage: float = Field(default=100.00, ge=0, le=100)


class PricingRuleOut(PricingRuleIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    is_active: bool


class BlackoutIn(BaseModel):
    title: str | None = None
    starts_at: datetime
    ends_at: datetime
    reason: str | None = None  # maintenance | weather | private_event | other


class BlackoutOut(BlackoutIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID


class CourtCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sport: str = Field(min_length=1, max_length=50)
    slot_minutes: int = Field(default=60, ge=15, le=240)
    surface_type: str | None = None
    is_indoor: bool = False
    has_floodlights: bool = False
    capacity: int | None = None
    # Section 29 Part C. Defaults match the model's own defaults (unrestricted) so a court
    # created without opinion on this behaves exactly like before this feature existed.
    cancellation_allowed: bool = True
    cancellation_cutoff_hours: int | None = Field(default=None, ge=0)


class CourtUpdateIn(BaseModel):
    name: str | None = None
    sport: str | None = None
    slot_minutes: int | None = Field(default=None, ge=15, le=240)
    surface_type: str | None = None
    is_indoor: bool | None = None
    has_floodlights: bool | None = None
    capacity: int | None = None
    cancellation_allowed: bool | None = None
    cancellation_cutoff_hours: int | None = Field(default=None, ge=0)
    photo_url: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class CourtOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    venue_id: uuid.UUID
    name: str
    sport: str
    slot_minutes: int
    surface_type: str | None
    is_indoor: bool
    has_floodlights: bool
    capacity: int | None
    cancellation_allowed: bool
    cancellation_cutoff_hours: int | None
    photo_url: str | None
    sort_order: int
    is_active: bool
    schedule_templates: list[ScheduleTemplateOut] = Field(default_factory=list)
    pricing_rules: list[PricingRuleOut] = Field(default_factory=list)


class CourtDetailResponse(BaseModel):
    court: CourtOut


class SchedulesIn(BaseModel):
    schedules: list[ScheduleTemplateIn]


class PricingRulesIn(BaseModel):
    rules: list[PricingRuleIn]
