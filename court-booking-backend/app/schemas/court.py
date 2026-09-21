import uuid
from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ScheduleTemplateIn(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    open_time: time
    close_time: time

    @model_validator(mode="after")
    def _close_after_open(self) -> "ScheduleTemplateIn":
        # schedule_templates has CHECK (open_time < close_time) and the availability grid is
        # built within one calendar day, so hours that run past midnight (e.g. 06:00 -> 02:00)
        # are not representable. Without this the INSERT hit the constraint and the request
        # answered an unhandled 500 (which the browser then reported as a network error).
        if self.close_time <= self.open_time:
            raise ValueError(
                "close_time must be later than open_time; hours past midnight are not supported yet "
                "(use 23:59 as the latest closing time)"
            )
        return self


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


# Section 32 Part 4: the slot lengths an owner may choose per court. 90 is here for padel.
ALLOWED_SLOT_MINUTES = (30, 60, 90, 120)


def _check_slot_minutes(v: int | None) -> int | None:
    if v is not None and v not in ALLOWED_SLOT_MINUTES:
        raise ValueError("slot_minutes must be one of 30, 60, 90 or 120")
    return v


class CourtCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sport: str = Field(min_length=1, max_length=50)
    slot_minutes: int = 60
    surface_type: str | None = None
    is_indoor: bool = False
    has_floodlights: bool = False
    capacity: int | None = None
    # The cancellation policy is per VENUE now (Section 32 Part 4). A client that still sends
    # cancellation_allowed / cancellation_cutoff_hours for a court has them ignored: unknown fields are
    # dropped by this model, and nothing here writes the deprecated court columns.

    _slot_minutes_ok = field_validator("slot_minutes")(_check_slot_minutes)


class CourtUpdateIn(BaseModel):
    name: str | None = None
    sport: str | None = None
    slot_minutes: int | None = None
    surface_type: str | None = None
    is_indoor: bool | None = None
    has_floodlights: bool | None = None
    capacity: int | None = None
    photo_url: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None

    _slot_minutes_ok = field_validator("slot_minutes")(_check_slot_minutes)


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
    # DEPRECATED read-only mirror of the venue's policy (see Court.cancellation_allowed): kept so app builds
    # from before Section 32 Part 4 still work. New clients read venue.cancellation_* instead.
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
