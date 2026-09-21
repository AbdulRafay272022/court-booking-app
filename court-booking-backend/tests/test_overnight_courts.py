"""Section 32 Part 3: overnight courts (a court open 3 PM to 3 AM, 6 PM to 6 AM, or 24 hours).

The model under test: a schedule day BELONGS TO THE DAY IT OPENS. A Thursday 3 PM to 3 AM schedule covers Thursday 3 PM
through Friday 3 AM, so a slot at Friday 1:00 AM is a Thursday slot: it is in Thursday's grid, uses Thursday's pricing
rules, is blocked by Thursday's blackouts and is bucketed as Thursday by the growth job. Pakistan has no DST, so all
arithmetic is plain +5 hours and is converted to UTC only at the storage boundary."""
import asyncio
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.blackout import Blackout
from app.models.booking import Booking, BookingStatus
from app.models.user import UserRole
from app.services.availability_service import AvailabilityService
from app.utils.schedule import opening_day_of, rule_matches_window, schedule_window
from app.utils.timezone import pkt_time_to_utc, pkt_today, utc_to_pkt_naive


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _next_weekday(target: int, at_least_days_ahead: int = 3) -> date:
    d = pkt_today() + timedelta(days=at_least_days_ahead)
    while d.weekday() != target:
        d += timedelta(days=1)
    return d


THURSDAY = 3


def _at(day: date, hh: int, mm: int = 0) -> datetime:
    """A Pakistan wall-clock time on a calendar date as a UTC instant (hh may be 24+ for 'the next morning')."""
    return pkt_time_to_utc(day, time(0, 0)) + timedelta(hours=hh, minutes=mm)


async def _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, *, open_, close,
                 slot_minutes=60, price=1000):
    owner = await make_user(phone, role=UserRole.OWNER)
    court = await make_court(await make_venue(owner), slot_minutes=slot_minutes)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=open_, close_time=close)
    if price:
        await make_pricing_rule(court, price_per_slot=price)
    return owner, court


async def _grid(client, court, day: date, headers=None):
    resp = await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()}, headers=headers or {})
    assert resp.status_code == 200, resp.text
    return resp.json()["slots"]


async def _hold(client, court, headers, starts, slot_count=1):
    return await client.post(
        "/api/v1/bookings/hold", headers=headers,
        json={"court_id": str(court.id), "starts_at": _iso(starts), "slot_count": slot_count},
    )


# ---- the grid --------------------------------------------------------------------------------------------

async def test_a_3pm_to_3am_court_has_a_grid_that_runs_across_midnight(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000001",
                             open_=time(15, 0), close=time(3, 0))
    thu = _next_weekday(THURSDAY)
    slots = await _grid(client, court, thu)

    assert len(slots) == 12  # 3 PM ... 2 AM starts
    assert slots[0]["starts_at"] == _iso(_at(thu, 15)) and slots[-1]["ends_at"] == _iso(_at(thu, 27))  # 3 AM Friday
    assert [s["after_midnight"] for s in slots] == [False] * 9 + [True] * 3
    assert slots[9]["starts_at"] == _iso(_at(thu, 24))  # 12:00 AM Friday is the first slot after midnight
    # Friday's own tab is Friday's schedule: it starts at 3 PM, and does NOT repeat Thursday's after-midnight slots
    fri = await _grid(client, court, thu + timedelta(days=1))
    assert fri[0]["starts_at"] == _iso(_at(thu + timedelta(days=1), 15)) and not any(s["after_midnight"] and s["starts_at"] < fri[0]["starts_at"] for s in fri)
    assert len(fri) == 12


async def test_a_6pm_to_6am_court_and_a_24_hour_court_and_a_midnight_close(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    thu = _next_weekday(THURSDAY)
    _o, night = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000002",
                             open_=time(18, 0), close=time(6, 0))
    slots = await _grid(client, night, thu)
    assert len(slots) == 12 and slots[0]["starts_at"] == _iso(_at(thu, 18)) and slots[-1]["ends_at"] == _iso(_at(thu, 30))

    _o, always = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000003",
                              open_=time(6, 0), close=time(6, 0))  # open == close: open 24 hours
    slots = await _grid(client, always, thu)
    assert len(slots) == 24 and slots[0]["starts_at"] == _iso(_at(thu, 6)) and slots[-1]["ends_at"] == _iso(_at(thu, 30))
    assert sum(s["after_midnight"] for s in slots) == 6  # 12 AM to 6 AM belong to Thursday's schedule

    _o, midnight = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000004",
                                open_=time(6, 0), close=time(0, 0))  # closes at midnight
    slots = await _grid(client, midnight, thu)
    assert len(slots) == 18  # 6 AM ... 11 PM: the 11 PM-12 AM slot the old 23:59 workaround lost is back
    assert slots[-1]["ends_at"] == _iso(_at(thu, 24)) and not slots[-1]["after_midnight"]


async def test_a_90_minute_overnight_court_walks_the_same_grid(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000005",
                             open_=time(18, 0), close=time(3, 0), slot_minutes=90)
    thu = _next_weekday(THURSDAY)
    slots = await _grid(client, court, thu)
    assert len(slots) == 6  # 9 hours / 1.5
    assert slots[3]["starts_at"] == _iso(_at(thu, 22, 30)) and slots[4]["starts_at"] == _iso(_at(thu, 24))  # 12:00 AM
    assert slots[4]["after_midnight"] is True and slots[3]["after_midnight"] is False


# ---- bookings across midnight ----------------------------------------------------------------------------

async def test_a_booking_at_1am_belongs_to_thursdays_schedule_and_thursdays_price(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """Thursday has its own price rule (3000); every other day is 1000. A 1:00 AM Friday slot is a THURSDAY slot, so it
    costs 3000 (the calendar day is Friday, whose rule would say 1000)."""
    _o, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000006",
                             open_=time(15, 0), close=time(3, 0), price=1000)
    await make_pricing_rule(court, name="Thursday", priority=5, day_of_week=[THURSDAY], price_per_slot=3000)
    player = await make_user("+923090000007", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    thu = _next_weekday(THURSDAY)
    one_am = _at(thu, 25)  # 1:00 AM Friday

    resp = await _hold(client, court, headers, one_am)
    assert resp.status_code == 201, resp.text
    booking = resp.json()["booking"]
    assert booking["starts_at"] == _iso(one_am) and booking["price"] == 3000.0

    slot = next(s for s in await _grid(client, court, thu, headers) if s["starts_at"] == _iso(one_am))
    assert slot["status"] == "held" and slot["is_mine"] is True and slot["after_midnight"] is True
    # it is not on Friday's grid (Friday's grid starts at 3 PM)
    assert not any(s["starts_at"] == _iso(one_am) for s in await _grid(client, court, thu + timedelta(days=1), headers))


async def test_two_bookings_either_side_of_midnight_and_one_across_it(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _o, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000008",
                             open_=time(15, 0), close=time(3, 0), price=1000)
    a = await make_user("+923090000009", role=UserRole.PLAYER)
    b = await make_user("+923090000010", role=UserRole.PLAYER)
    c = await make_user("+923090000011", role=UserRole.PLAYER)
    ha, hb, hc = await make_auth_headers(a), await make_auth_headers(b), await make_auth_headers(c)
    thu = _next_weekday(THURSDAY)

    assert (await _hold(client, court, ha, _at(thu, 23))).status_code == 201   # 11 PM - 12 AM
    assert (await _hold(client, court, hb, _at(thu, 24))).status_code == 201   # 12 AM - 1 AM, side by side, no clash
    across = await _hold(client, court, hc, _at(thu, 22), slot_count=2)        # 10 PM - 12 AM touches the first
    assert across.status_code == 409 and across.json()["error"]["code"] == "SLOT_ALREADY_TAKEN"
    free_across = await _hold(client, court, hc, _at(thu, 21), slot_count=2)   # 9 PM - 11 PM is clear
    assert free_across.status_code == 201

    # one booking that itself crosses midnight: 1 AM - 3 AM is two slots after midnight; 11 PM-1 AM needs 23:00 free
    d = await make_user("+923090000012", role=UserRole.PLAYER)
    hd = await make_auth_headers(d)
    fri_night = _next_weekday(THURSDAY, 10)
    crossing = await _hold(client, court, hd, _at(fri_night, 23), slot_count=2)  # 11 PM Thursday -> 1 AM Friday
    assert crossing.status_code == 201, crossing.text
    assert crossing.json()["booking"]["ends_at"] == _iso(_at(fri_night, 25)) and crossing.json()["booking"]["price"] == 2000.0


async def test_a_blackout_after_midnight_blocks_the_opening_days_slot(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000013",
                                open_=time(15, 0), close=time(3, 0))
    thu = _next_weekday(THURSDAY)
    async with db_session_factory() as s:
        s.add(Blackout(court_id=court.id, created_by=owner.id, starts_at=_at(thu, 25), ends_at=_at(thu, 27), reason="cleaning"))
        await s.commit()
    slots = {s["starts_at"]: s for s in await _grid(client, court, thu)}
    assert slots[_iso(_at(thu, 25))]["status"] == "blocked" and slots[_iso(_at(thu, 26))]["status"] == "blocked"
    assert slots[_iso(_at(thu, 24))]["status"] == "available"  # 12 AM-1 AM is before the blackout

    player = await make_user("+923090000014", role=UserRole.PLAYER)
    blocked = await _hold(client, court, await make_auth_headers(player), _at(thu, 25))
    assert blocked.status_code == 400 and blocked.json()["error"]["code"] == "SLOT_BLOCKED"


async def test_fifty_players_race_for_the_1am_slot_only_one_wins(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _o, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000015",
                             open_=time(15, 0), close=time(3, 0))
    players = [await make_user(f"+92309001{n:04d}", role=UserRole.PLAYER) for n in range(50)]
    headers = [await make_auth_headers(p) for p in players]
    one_am = _at(_next_weekday(THURSDAY), 25)
    results = await asyncio.gather(*(_hold(client, court, h, one_am) for h in headers))
    codes = [r.status_code for r in results]
    assert codes.count(201) == 1 and codes.count(409) == 49, codes


# ---- pricing windows that cross midnight ---------------------------------------------------------------

async def test_a_peak_window_from_10pm_to_2am_prices_the_slots_on_both_sides_of_midnight(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000016",
                             open_=time(18, 0), close=time(3, 0), price=1000)
    await make_pricing_rule(court, name="Late peak", priority=5, start_time=time(22, 0), end_time=time(2, 0), price_per_slot=3000)
    thu = _next_weekday(THURSDAY)
    price_by_hour = {}
    for s in await _grid(client, court, thu):
        local = utc_to_pkt_naive(datetime.fromisoformat(s["starts_at"].replace("Z", "+00:00")))
        price_by_hour[local.hour] = s["price"]
    assert [price_by_hour[h] for h in (18, 19, 20, 21)] == [1000.0] * 4
    assert [price_by_hour[h] for h in (22, 23, 0, 1)] == [3000.0] * 4   # 10 PM, 11 PM, 12 AM, 1 AM
    assert price_by_hour[2] == 1000.0                                    # 2-3 AM is outside the window

    # a booking that straddles midnight is charged slot by slot: 11 PM (3000) + 12 AM (3000)
    q = await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(thu, 23)), "slot_count": 2})
    assert q.status_code == 200 and q.json()["price"] == 6000.0


def test_rule_windows_the_ways_an_owner_can_write_them():
    m = lambda h, mm=0: h * 60 + mm  # noqa: E731
    # crosses midnight
    assert rule_matches_window(time(22, 0), time(2, 0), m(23), m(24))
    assert rule_matches_window(time(22, 0), time(2, 0), m(25), m(26))          # 1 AM is inside
    assert not rule_matches_window(time(22, 0), time(2, 0), m(26), m(27))      # 2 AM is not
    assert not rule_matches_window(time(22, 0), time(2, 0), m(21), m(22))
    # entirely after midnight (01:00-03:00 on an overnight court)
    assert rule_matches_window(time(1, 0), time(3, 0), m(25), m(26)) and rule_matches_window(time(1, 0), time(3, 0), m(26), m(27))
    assert not rule_matches_window(time(1, 0), time(3, 0), m(24), m(25))
    # open ended and all day
    assert rule_matches_window(time(18, 0), None, m(19), m(20)) and rule_matches_window(time(18, 0), None, m(25), m(26))
    assert rule_matches_window(None, None, m(3), m(4))
    # "until 00:00" means until midnight
    assert rule_matches_window(None, time(0, 0), m(23), m(24)) and not rule_matches_window(None, time(0, 0), m(24), m(25))
    # an ordinary same-day window behaves exactly as before
    assert rule_matches_window(time(18, 0), time(23, 0), m(18), m(19)) and not rule_matches_window(time(18, 0), time(23, 0), m(22, 30), m(23, 30))


# ---- which day owns an instant ---------------------------------------------------------------------------

def test_which_schedule_day_owns_an_instant():
    class T:  # noqa: D401
        def __init__(self, o, c, n):
            self.open_time, self.close_time, self.closes_next_day = o, c, n

    thu = _next_weekday(THURSDAY)
    week = {d: T(time(15, 0), time(3, 0), True) for d in range(7)}
    assert opening_day_of(datetime.combine(thu + timedelta(days=1), time(1, 0)), week) == thu          # 1 AM Friday -> Thursday
    assert opening_day_of(datetime.combine(thu + timedelta(days=1), time(2, 59)), week) == thu
    assert opening_day_of(datetime.combine(thu + timedelta(days=1), time(3, 0)), week) == thu + timedelta(days=1)  # 3 AM = closed
    assert opening_day_of(datetime.combine(thu + timedelta(days=1), time(16, 0)), week) == thu + timedelta(days=1)
    # a same-day court never hands an instant to the day before
    plain = {d: T(time(6, 0), time(23, 0), False) for d in range(7)}
    assert opening_day_of(datetime.combine(thu, time(1, 0)), plain) == thu
    opens, closes = schedule_window(thu, week[0])
    assert closes - opens == timedelta(hours=12)


async def test_the_service_agrees_for_holds_walk_ins_and_quotes(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000017",
                             open_=time(15, 0), close=time(3, 0))
    service = AvailabilityService(db_session)
    thu = _next_weekday(THURSDAY)
    one_am = _at(thu, 25)
    assert await service.schedule_day_of(court, one_am) == thu
    assert await service.is_slot_grid_aligned(court, one_am) is True
    assert await service.is_slot_grid_aligned(court, _at(thu, 25, 30)) is False   # off the grid
    assert await service.is_slot_grid_aligned(court, _at(thu, 27)) is False        # 3 AM: closed
    price, _adv = await service.price_for_range_with_advance(court, one_am, one_am + timedelta(hours=1))
    assert price == 1000.0

    # the calendar-day view ("what is free on Friday?") = Thursday's tail + Friday's slots up to midnight
    friday = thu + timedelta(days=1)
    calendar = await service.get_slots_starting_on(court, friday)
    starts = [utc_to_pkt_naive(s.starts_at) for s in calendar]
    assert starts[0] == datetime.combine(friday, time(0, 0)) and starts[2] == datetime.combine(friday, time(2, 0))
    assert starts[3] == datetime.combine(friday, time(15, 0)) and starts[-1] == datetime.combine(friday, time(23, 0))
    assert all(s.date() == friday for s in starts)


# ---- the owner's Today and the growth job --------------------------------------------------------------

async def test_owner_today_shows_after_midnight_players_and_does_not_double_count_them(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923090000018",
                                open_=time(15, 0), close=time(3, 0))
    headers = await make_auth_headers(owner)
    thu = _next_weekday(THURSDAY)
    walkin = await client.post(
        "/api/v1/bookings/walkin", headers=headers,
        json={"court_id": str(court.id), "starts_at": _iso(_at(thu, 25)), "player_name": "Night Owl", "amount_paid": 400},
    )
    assert walkin.status_code == 201, walkin.text

    today_thu = (await client.get("/api/v1/owners/today", params={"date_": thu.isoformat()}, headers=headers)).json()
    slot = next(s for c in today_thu["courts"] for s in c["slots"] if s["starts_at"] == _iso(_at(thu, 25)))
    assert slot["player_name"] == "Night Owl" and slot["amount_paid"] == 400.0   # found although it starts on Friday
    assert today_thu["summary"]["total_bookings"] == 1

    today_fri = (await client.get("/api/v1/owners/today", params={"date_": (thu + timedelta(days=1)).isoformat()}, headers=headers)).json()
    assert today_fri["summary"]["total_bookings"] == 0          # the 1 AM booking belongs to Thursday's night
    assert today_fri["summary"]["total_revenue"] == 0.0


async def test_the_growth_job_buckets_a_1am_friday_booking_under_thursday(
    db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    from app.jobs.growth_job import compute_slot_stats
    from app.models.stats import SlotStats

    owner = await make_user("+923090000019", role=UserRole.OWNER)
    player = await make_user("+923090000020", role=UserRole.PLAYER)
    court = await make_court(await make_venue(owner), created_at=datetime.now(timezone.utc) - timedelta(days=200))
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(15, 0), close_time=time(3, 0))
    await make_pricing_rule(court, price_per_slot=1500)
    # a past Friday's 1:00 AM slot (Thursday night's shift)
    past_thu = pkt_today() - timedelta(days=30)
    while past_thu.weekday() != THURSDAY:
        past_thu -= timedelta(days=1)
    starts = _at(past_thu, 25)
    async with db_session_factory() as s:
        s.add(Booking(court_id=court.id, player_id=player.id, starts_at=starts, ends_at=starts + timedelta(hours=1),
                      price=1500, amount_paid=1500, status=BookingStatus.BOOKED))
        await s.commit()

    async with db_session_factory() as s:
        await compute_slot_stats(s)
        await s.commit()
    async with db_session_factory() as s:
        rows = (await s.execute(select(SlotStats).where(SlotStats.court_id == court.id))).scalars().all()
    assert [(r.day_of_week, r.hour) for r in rows] == [(THURSDAY, 1)]   # Thursday's 1 AM, not Friday's
