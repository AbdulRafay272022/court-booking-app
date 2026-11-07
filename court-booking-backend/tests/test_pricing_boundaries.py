"""fix/nov-7 item 3: pricing rule windows are HALF-OPEN [start, end) and a 30-minute grid cell takes a rule's price only
when the cell STARTS inside the window. A booking that crosses a boundary is priced cell by cell. Windows may cross
midnight. Overlapping rules: more specific, then narrower, then the higher price, then the owner's list order
(app/utils/schedule.rule_rank). Real Postgres for the quote/grid tests."""

from dataclasses import dataclass
from datetime import time

import pytest

from app.services.availability_service import AvailabilityService
from app.utils.schedule import rule_matches_window, rule_rank
from test_overnight_courts import THURSDAY, _at, _court, _grid, _iso, _next_weekday
from app.utils.timezone import utc_to_pkt_naive
from datetime import datetime


def m(h: int, mm: int = 0) -> int:
    return h * 60 + mm


# -- the window rule, cell by cell --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "cell, inside",
    [((14, 30), False), ((15, 0), True), ((17, 30), True), ((18, 0), False)],
)
def test_peak_3pm_to_6pm_takes_cells_that_start_inside(cell, inside):
    s = m(*cell)
    assert rule_matches_window(time(15, 0), time(18, 0), s, s + 30) is inside


@pytest.mark.parametrize(
    "cell, inside",
    [((17, 30), False), ((18, 0), True), ((23, 30), True), ((24, 0), False), ((24, 30), False)],
)
def test_6pm_to_midnight_takes_2330_but_not_0000(cell, inside):
    s = m(*cell)
    assert rule_matches_window(time(18, 0), time(0, 0), s, s + 30) is inside


@pytest.mark.parametrize(
    "cell, inside",
    [((21, 30), False), ((22, 0), True), ((23, 30), True), ((24, 0), True), ((25, 30), True), ((26, 0), False)],
)
def test_a_window_that_crosses_midnight(cell, inside):
    s = m(*cell)
    assert rule_matches_window(time(22, 0), time(2, 0), s, s + 30) is inside


def test_the_end_of_a_cell_is_not_what_decides():
    # a window ending at 18:15 (not on the grid): the 18:00 cell starts inside, so it is in
    assert rule_matches_window(time(15, 0), time(18, 15), m(18), m(18, 30))
    assert not rule_matches_window(time(15, 15), time(18, 0), m(15), m(15, 30))


# -- which rule wins when two overlap -----------------------------------------------------------------------------------


@dataclass
class R:
    name: str
    price_per_slot: float
    day_of_week: list[int] | None = None
    start_time: time | None = None
    end_time: time | None = None
    priority: int = 0
    is_active: bool = True


def winner(rules, dow, cell):
    s = m(*cell)
    rule = AvailabilityService.match_rule_minutes(rules, dow, s, s + 30)
    return rule.name if rule else None


def test_the_order_overlapping_rules_win_in():
    base = R("Base", 2000)
    weekend = R("Weekend", 2500, day_of_week=[5, 6])
    evening = R("Evening", 2800, start_time=time(15), end_time=time(21))
    peak = R("Peak", 3000, start_time=time(15), end_time=time(18))
    weekend_peak = R("Weekend peak", 2600, day_of_week=[5, 6], start_time=time(16), end_time=time(17))
    rules = [base, weekend, evening, peak, weekend_peak]
    assert winner(rules, 0, (10, 0)) == "Base"
    assert winner(rules, 5, (10, 0)) == "Weekend"
    # 1. days + a window beats a window only, even when it is cheaper
    assert winner(rules, 5, (16, 0)) == "Weekend peak"
    # 2. narrower beats wider (both a window only): Peak 3-6 inside Evening 3-9
    assert winner(rules, 0, (16, 0)) == "Peak"
    assert winner(rules, 0, (18, 0)) == "Evening"
    # 3. the same width: the higher price (the peak) wins, whatever the list order
    a = R("A", 2000, start_time=time(18), end_time=time(21), priority=5)
    b = R("B", 3500, start_time=time(19), end_time=time(22), priority=1)
    assert winner([a, b], 0, (19, 30)) == "B"
    # 4. everything equal: the rule lower in the owner's list (higher priority number)
    c = R("C", 3000, start_time=time(18), end_time=time(21), priority=1)
    d = R("D", 3000, start_time=time(18), end_time=time(21), priority=2)
    assert winner([c, d], 0, (19, 0)) == "D"
    assert rule_rank(peak) > rule_rank(evening) > rule_rank(base)


# -- the grid and the quote ----------------------------------------------------------------------------------------------


async def test_quote_prices_a_booking_cell_by_cell_across_the_peak_boundaries(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    # PKR 2000 an hour (1000 a cell), peak 3-6 PM at 3000 an hour (1500 a cell), open 10 AM to midnight
    _o, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090070001",
                             open_=time(10, 0), close=time(0, 0), price=2000)
    await make_pricing_rule(court, name="Peak", priority=1, start_time=time(15, 0), end_time=time(18, 0), price_per_slot=3000)
    await make_pricing_rule(court, name="Late", priority=2, start_time=time(18, 0), end_time=time(0, 0), price_per_slot=4000)
    day = _next_weekday(THURSDAY)

    cells = {}
    for s in await _grid(client, court, day):
        local = utc_to_pkt_naive(datetime.fromisoformat(s["starts_at"].replace("Z", "+00:00")))
        cells[(local.hour, local.minute)] = s["price"]
    assert cells[(14, 30)] == 1000 and cells[(15, 0)] == 1500  # 2:30 not peak, 3:00 peak
    assert cells[(17, 30)] == 1500 and cells[(18, 0)] == 2000  # 5:30 peak, 6:00 the 6 PM-12 AM rate
    assert cells[(23, 30)] == 2000                             # 11:30 PM still inside 6 PM-12 AM

    async def quote(hh, mm, n):
        r = await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(day, hh, mm)), "slot_count": n})
        assert r.status_code == 200, r.text
        return r.json()["price"]

    assert await quote(14, 30, 2) == 1000 + 1500  # 2:30-3:30 crosses into peak
    assert await quote(17, 30, 2) == 1500 + 2000  # 5:30-6:30 crosses out of peak (the 1-hour booking of the label bug)
    assert await quote(15, 0, 6) == 6 * 1500      # 3-6 PM is all peak


async def test_overnight_court_the_cell_at_midnight_is_outside_a_6pm_to_midnight_rule(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090070002",
                             open_=time(16, 0), close=time(2, 0), price=2000)
    await make_pricing_rule(court, name="Night", priority=1, start_time=time(18, 0), end_time=time(0, 0), price_per_slot=4000)
    day = _next_weekday(THURSDAY)
    r = await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(day, 23, 30)), "slot_count": 2})
    assert r.status_code == 200, r.text
    assert r.json()["price"] == 2000 + 1000  # 11:30 PM is Night (2000 a cell), 12:00 AM is the base rate (1000)
