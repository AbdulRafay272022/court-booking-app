"""Advance-payment explanation for the owner Settings / onboarding screens (Owner Round 2, A11).

Nothing here changes how an advance is calculated: every number comes from
`AvailabilityService.compute_advance` applied exactly the way the availability grid and `quote_range` apply it
(per 30-minute cell: the court's priced unit's advance times the cell's fraction of that unit, summed, rounded once
to 2 decimals). `advance_for_minutes` is that same summation for a booking of uniform price, so the
example the owner sees is the amount a player would really be asked for.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.court import Court, CourtAdvanceType
from app.models.pricing import PricingRule
from app.services.availability_service import GRID_MINUTES, AvailabilityService
from app.services.feature_flag_service import flag_on


def advance_for_minutes(unit_price: float, court: Court, rule: PricingRule, minutes: int) -> float:
    """The advance for a booking of `minutes` (a multiple of 30) at `unit_price` per court slot unit
    (`court.slot_minutes`): sum of the per-cell advances, rounded once -- quote_range's own arithmetic."""
    fraction = AvailabilityService.slot_fraction(court)
    cells = max(1, minutes // GRID_MINUTES)
    per_cell = AvailabilityService.compute_advance(unit_price, court, rule) * fraction
    return round(per_cell * cells, 2)


def _explain_rule(rules: list[PricingRule], court: Court) -> PricingRule | None:
    """The rule the example is priced with: the court's cheapest active rule (the same one `starts_from_price`
    advertises), ties broken by the more general rule."""
    active = [r for r in rules if r.is_active]
    if not active:
        return None
    return min(
        active,
        key=lambda r: (AvailabilityService.price_for_rule(r, court) or 0.0, r.day_of_week is not None, r.start_time is not None),
    )


async def explain_advance(db: AsyncSession, court_id: uuid.UUID) -> dict:
    court = await db.get(Court, court_id)
    rules = list((await db.execute(select(PricingRule).where(PricingRule.court_id == court_id))).scalars().all())
    rule = _explain_rule(rules, court)
    slot_minutes = int(court.slot_minutes)
    # "1 ghante ka rate": one hour when the minimum booking fits in an hour, else the minimum booking itself
    example_minutes = 60 if slot_minutes <= 60 else slot_minutes
    example_minutes = max(GRID_MINUTES, (example_minutes // GRID_MINUTES) * GRID_MINUTES)

    if court.advance_type == CourtAdvanceType.FIXED:
        mode = "fixed"
    elif court.advance_type == CourtAdvanceType.PERCENT:
        mode = "percent"
    else:
        mode = "default"
    value = float(court.advance_value) if court.advance_value is not None and mode != "default" else None
    minimum = int(court.advance_minimum) if court.advance_minimum is not None else None

    split_on = await flag_on(db, "split_payments")
    if rule is None:
        return {
            "mode": mode,
            "value": value,
            "minimum": minimum,
            "hourly_price": None,
            "example_minutes": example_minutes,
            "example_total": 0,
            "example_advance": 0,
            "default_rule": {"source": "none", "percentage": None, "value_if_nothing_set": 0},
        }

    unit_price = AvailabilityService.price_for_rule(rule, court) or 0.0
    hourly_price = round(unit_price * 60 / slot_minutes, 2)
    example_total = round(unit_price * example_minutes / slot_minutes, 2)
    example_advance = advance_for_minutes(unit_price, court, rule, example_minutes)
    # what the same example would be if the owner had set nothing on the court (no override, no minimum)
    bare = Court(slot_minutes=slot_minutes, advance_type=None, advance_value=None, advance_minimum=None)
    if_nothing = advance_for_minutes(unit_price, bare, rule, example_minutes)
    if not split_on:  # split-payments kill switch: every new booking is paid in full up front
        example_advance = example_total
        if_nothing = example_total
    return {
        "mode": mode,
        "value": value,
        "minimum": minimum,
        "hourly_price": hourly_price,
        "example_minutes": example_minutes,
        "example_total": example_total,
        "example_advance": example_advance,
        "default_rule": {
            "source": "pricing_rule",
            "percentage": float(rule.advance_percentage),
            "value_if_nothing_set": if_nothing,
        },
    }
