"""Shared fixtures (Owner Round 2): the backend must agree with the JSON cases the web and mobile apps test against.

- packages/types/src/fixtures/advance-cases.json: the advance for a booking total under each court/pricing rule,
  checked against BOTH `advance_for_minutes` (the explain endpoint's helper) and the real availability grid
  (`AvailabilityService.build_day_slots` cells summed exactly like `quote_range`), so the shared cases cannot drift
  from what a player is actually charged.
- packages/types/src/fixtures/reminder-schedule-cases.json: `reminder_schedule` (B1).

Pure functions, no database.
"""

import json
from datetime import date, datetime, time
from pathlib import Path

import pytest

from app.models.court import Court, CourtAdvanceType
from app.models.pricing import PricingRule
from app.models.schedule import ScheduleTemplate
from app.services.advance_explain import advance_for_minutes
from app.services.availability_service import AvailabilityService
from app.services.reminder_schedule import reminder_schedule, shift_to_open_hours

FIXTURES = Path(__file__).resolve().parents[2] / "court-booking-frontend" / "packages" / "types" / "src" / "fixtures"
ADVANCE_CASES = json.loads((FIXTURES / "advance-cases.json").read_text(encoding="utf-8"))
REMINDER_CASES = json.loads((FIXTURES / "reminder-schedule-cases.json").read_text(encoding="utf-8"))

_MODES = {"default": None, "fixed": CourtAdvanceType.FIXED, "percent": CourtAdvanceType.PERCENT}


def _objects(case: dict) -> tuple[Court, PricingRule, float, int]:
    rule_in = case["rule"]
    court = Court(
        slot_minutes=case["slot_minutes"],
        advance_type=_MODES[rule_in["mode"]],
        advance_value=rule_in["value"],
        advance_minimum=rule_in["minimum"],
        has_floodlights=False,
    )
    unit_price = case["total"] / case["units"]
    rule = PricingRule(
        price_per_slot=unit_price,
        advance_percentage=rule_in["defaultPercentage"],
        floodlight_surcharge=0,
        is_active=True,
        priority=0,
        day_of_week=None,
        start_time=None,
        end_time=None,
    )
    minutes = int(round(case["units"] * case["slot_minutes"]))
    return court, rule, unit_price, minutes


def test_advance_cases_cover_the_required_situations():
    names = " | ".join(c["name"] for c in ADVANCE_CASES)
    for needle in ("nothing set", "pricing-rule percentage", "fixed amount", "minimum above", "minimum below", "rounding", "multi-slot", "fixed above total"):
        assert needle in names, needle


@pytest.mark.parametrize("case", ADVANCE_CASES, ids=[c["name"] for c in ADVANCE_CASES])
def test_advance_case_matches_backend_helper(case):
    court, rule, unit_price, minutes = _objects(case)
    assert advance_for_minutes(unit_price, court, rule, minutes) == pytest.approx(case["expected"], abs=0.001)


@pytest.mark.parametrize("case", ADVANCE_CASES, ids=[c["name"] for c in ADVANCE_CASES])
def test_advance_case_matches_real_availability_grid(case):
    court, rule, _unit_price, minutes = _objects(case)
    day = date(2026, 10, 14)
    template = ScheduleTemplate(day_of_week=day.weekday(), open_time=time(6, 0), close_time=time(23, 0), closes_next_day=False, is_active=True)
    slots = AvailabilityService.build_day_slots(court, day, template, [rule], [], [])
    picked = slots[: minutes // 30]
    total = round(sum(s.price_exact for s in picked), 2)
    advance = round(sum(s.advance_exact for s in picked), 2)
    assert total == pytest.approx(case["total"], abs=0.001)
    assert advance == pytest.approx(case["expected"], abs=0.001)


@pytest.mark.parametrize("case", REMINDER_CASES, ids=[c["name"] for c in REMINDER_CASES])
def test_reminder_schedule_case(case):
    i = case["input"]
    reminders, warning, cancel_at = reminder_schedule(i["first"], i["every"], i["max"], i["autoCancel"])
    assert reminders == case["expected"]["reminders"]
    assert warning == case["expected"]["finalWarning"]
    assert cancel_at == case["expected"]["cancelAt"]


def test_reminder_spec_examples_present():
    by_name = {c["name"]: c for c in REMINDER_CASES}
    y30 = next(c for n, c in by_name.items() if "Y=30" in n)
    assert y30["expected"] == {"reminders": [10], "finalWarning": 25, "cancelAt": 30}
    y120 = next(c for n, c in by_name.items() if "Y=120" in n)
    assert y120["expected"] == {"reminders": [10, 40, 70, 100], "finalWarning": 115, "cancelAt": 120}


def test_shift_to_open_hours_same_day_window():
    open_t, close_t = time(9, 0), time(23, 0)
    assert shift_to_open_hours(datetime(2026, 10, 14, 12, 0), open_t, close_t) == datetime(2026, 10, 14, 12, 0)
    assert shift_to_open_hours(datetime(2026, 10, 14, 3, 0), open_t, close_t) == datetime(2026, 10, 14, 9, 0)
    assert shift_to_open_hours(datetime(2026, 10, 14, 23, 30), open_t, close_t) == datetime(2026, 10, 15, 9, 0)
    assert shift_to_open_hours(datetime(2026, 10, 14, 23, 0), open_t, close_t) == datetime(2026, 10, 15, 9, 0)


def test_shift_to_open_hours_overnight_and_always_open():
    open_t, close_t = time(16, 0), time(2, 0)
    assert shift_to_open_hours(datetime(2026, 10, 14, 1, 0), open_t, close_t) == datetime(2026, 10, 14, 1, 0)
    assert shift_to_open_hours(datetime(2026, 10, 14, 20, 0), open_t, close_t) == datetime(2026, 10, 14, 20, 0)
    assert shift_to_open_hours(datetime(2026, 10, 14, 3, 0), open_t, close_t) == datetime(2026, 10, 14, 16, 0)
    assert shift_to_open_hours(datetime(2026, 10, 14, 3, 0), time(0, 0), time(0, 0)) == datetime(2026, 10, 14, 3, 0)
    assert shift_to_open_hours(datetime(2026, 10, 14, 3, 0), None, None) == datetime(2026, 10, 14, 3, 0)
