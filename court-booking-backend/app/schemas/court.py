import uuid
from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.court import CourtAdvanceType
from app.utils.schedule import closes_next_day_for


class ScheduleTemplateIn(BaseModel):
    """One weekday's opening hours. The day belongs to the day it OPENS (Section 32 Part 3): 15:00 to 03:00 on Thursday
    is open Thursday 3 PM until Friday 3 AM. `close_time <= open_time` means the court closes the NEXT morning
    (close == open is open 24 hours; close 00:00 is midnight). `closes_next_day` is derived from the times; a client that
    sends it must send the value the times imply."""

    day_of_week: int = Field(ge=0, le=6)
    open_time: time
    close_time: time
    closes_next_day: bool | None = None

    @model_validator(mode="after")
    def _derive_closes_next_day(self) -> "ScheduleTemplateIn":
        implied = closes_next_day_for(self.open_time, self.close_time)
        if self.closes_next_day is not None and self.closes_next_day != implied:
            raise ValueError(
                "closes_next_day must be true exactly when close_time is at or before open_time "
                "(a court that closes at 03:00 after opening at 15:00 closes the next morning)"
            )
        self.closes_next_day = implied
        return self


class ScheduleTemplateOut(ScheduleTemplateIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    is_active: bool
    closes_next_day: bool


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


def _check_advance_rule(advance_type: CourtAdvanceType | None, advance_value: float | None) -> None:
    if advance_type is None:
        return
    if advance_value is None:
        raise ValueError("advance_value is required when advance_type is set")
    if advance_type == CourtAdvanceType.PERCENT and not (0 <= advance_value <= 100):
        raise ValueError("advance_value must be between 0 and 100 when advance_type is 'percent'")
    if advance_type == CourtAdvanceType.FIXED and advance_value < 0:
        raise ValueError("advance_value must be >= 0 when advance_type is 'fixed'")


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
    # Section 32 Part 5: a fixed PKR amount or a percentage, with an optional minimum floor. Null
    # advance_type falls back to the matched pricing rule's own advance_percentage.
    advance_type: CourtAdvanceType | None = None
    advance_value: float | None = None
    advance_minimum: int | None = Field(default=None, ge=0)

    _slot_minutes_ok = field_validator("slot_minutes")(_check_slot_minutes)

    @model_validator(mode="after")
    def _advance_rule_ok(self) -> "CourtCreateIn":
        _check_advance_rule(self.advance_type, self.advance_value)
        return self


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
    advance_type: CourtAdvanceType | None = None
    advance_value: float | None = None
    advance_minimum: int | None = Field(default=None, ge=0)

    _slot_minutes_ok = field_validator("slot_minutes")(_check_slot_minutes)

    @model_validator(mode="after")
    def _advance_rule_ok(self) -> "CourtUpdateIn":
        # Partial update: only enforce the pairing when advance_type is being SET to a real value in this
        # same request (that's when advance_value must come along with it); clearing it to null, or not
        # touching either field, needs no cross-check against whatever the court already has.
        if "advance_type" in self.model_fields_set and self.advance_type is not None:
            _check_advance_rule(self.advance_type, self.advance_value)
        return self


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
    advance_type: CourtAdvanceType | None
    advance_value: float | None
    advance_minimum: int | None
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
