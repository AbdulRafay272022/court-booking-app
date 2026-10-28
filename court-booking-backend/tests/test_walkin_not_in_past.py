"""POST /bookings/walkin refuses a start time that has already passed (WALKIN_IN_PAST, 400).

THE RULE (owner-approved): judged on the 30-minute grid slot the booking STARTS in. The slot currently in progress (it has
started but not ended) is still allowed -- owners log people who have just arrived. A slot that has already ENDED is refused.
So at 7:10 PM the 7:00-7:30 slot is fine, 6:30-7:00 is not. The comparison is between real instants (UTC == PKT instants), so
an overnight court's 1:00 AM slot, which belongs to the PREVIOUS schedule day, is judged by when it actually happens."""
from datetime import datetime, time, timedelta

import pytest

from app.models.user import UserRole
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _at(day_offset: int, hh: int, mm: int = 0) -> datetime:
    """A Pakistan wall-clock time `day_offset` days from today as a UTC instant (hh may be 24+ for the next morning)."""
    return pkt_time_to_utc(pkt_today() + timedelta(days=day_offset), time(0, 0)) + timedelta(hours=hh, minutes=mm)


async def _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, *, open_=time(6, 0), close=time(23, 0)):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    for dow in range(7):
        await make_schedule(court, day_of_week=dow, open_time=open_, close_time=close)
    await make_pricing_rule(court, price_per_slot=1000)
    return owner, court


def _freeze(monkeypatch, instant: datetime):
    monkeypatch.setattr("app.services.booking_service.utc_now", lambda: instant)


async def _walkin(client, headers, court, starts, count=2):
    return await client.post(
        "/api/v1/bookings/walkin", headers=headers,
        json={"court_id": str(court.id), "starts_at": _iso(starts), "slot_count": count, "player_phone": "+923009990001", "player_name": "Walk In", "amount_paid": 0},
    )


def _is_past(resp) -> bool:
    return resp.status_code == 400 and resp.json()["error"]["code"] == "WALKIN_IN_PAST"


async def test_a_slot_that_has_ended_is_refused_the_one_in_progress_and_later_ones_are_allowed(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    owner, court = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923180000001")
    oh = await make_auth_headers(owner)
    _freeze(monkeypatch, _at(3, 19, 10))  # three days from now, 7:10 PM Pakistan time

    # 6:00 PM (6:00-6:30 and later) and 6:30 PM (slot 6:30-7:00 ended at 7:00) are over
    for hh, mm in ((18, 0), (18, 30), (12, 0)):
        r = await _walkin(client, oh, court, _at(3, hh, mm))
        assert _is_past(r), (hh, mm, r.text)
    err = (await _walkin(client, oh, court, _at(3, 18, 30))).json()["error"]
    assert "already passed" in err["message"]

    # 7:00 PM: that 30-minute slot is IN PROGRESS (7:00-7:30, it is 7:10): allowed, a 60-minute booking from 7:00 to 8:00
    now_slot = await _walkin(client, oh, court, _at(3, 19, 0))
    assert now_slot.status_code == 201, now_slot.text
    assert now_slot.json()["booking"]["starts_at"] == _iso(_at(3, 19, 0))
    assert now_slot.json()["booking"]["ends_at"] == _iso(_at(3, 20, 0))

    # later today is allowed
    assert (await _walkin(client, oh, court, _at(3, 21, 0))).status_code == 201


async def test_the_boundary_is_exact_a_slot_ending_this_very_minute_is_over(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    owner, court = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923180000002")
    oh = await make_auth_headers(owner)
    _freeze(monkeypatch, _at(3, 19, 0))  # exactly 7:00 PM
    assert _is_past(await _walkin(client, oh, court, _at(3, 18, 30)))  # 6:30-7:00 ended at 7:00
    assert (await _walkin(client, oh, court, _at(3, 19, 0))).status_code == 201  # 7:00-7:30 just started


async def test_yesterday_is_refused_today_and_tomorrow_follow_the_clock(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """Real clock, no freezing: yesterday at noon is always over; tomorrow at noon is always ahead."""
    owner, court = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923180000003")
    oh = await make_auth_headers(owner)
    assert _is_past(await _walkin(client, oh, court, _at(-1, 12, 0)))
    assert _is_past(await _walkin(client, oh, court, _at(-30, 12, 0)))
    assert (await _walkin(client, oh, court, _at(1, 12, 0))).status_code == 201


async def test_today_early_slots_are_refused_and_late_slots_allowed_relative_to_now(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    owner, court = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923180000004")
    oh = await make_auth_headers(owner)
    _freeze(monkeypatch, _at(2, 13, 45))  # 1:45 PM two days from now
    assert _is_past(await _walkin(client, oh, court, _at(2, 6, 0)))  # this morning
    assert _is_past(await _walkin(client, oh, court, _at(2, 13, 0)))  # 1:00-1:30 over
    assert (await _walkin(client, oh, court, _at(2, 13, 30))).status_code == 201  # 1:30-2:00 in progress (1:45)
    assert (await _walkin(client, oh, court, _at(2, 18, 0))).status_code == 201  # this evening
    assert _is_past(await _walkin(client, oh, court, _at(1, 18, 0)))  # the day before


async def test_overnight_court_a_1_am_slot_belongs_to_the_previous_schedule_day_and_is_judged_by_when_it_happens(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Court open 3 PM -> 3 AM. The schedule day D runs from D 3:00 PM to D+1 3:00 AM. It is now D+1 1:10 AM (still the
    schedule day D). The slots D+1 12:30-1:00 AM is over, D+1 1:00-1:30 AM is in progress, D+1 1:30 AM is ahead; and D 6 PM is long
    gone even though it is the 'same schedule day'. A check on the calendar DATE would get this wrong."""
    owner, court = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923180000005",
                                open_=time(15, 0), close=time(3, 0))
    oh = await make_auth_headers(owner)
    _freeze(monkeypatch, _at(3, 25, 10))  # day 3 + 25h10 = day 4, 1:10 AM
    assert _is_past(await _walkin(client, oh, court, _at(3, 18, 0)))  # day 3, 6 PM
    assert _is_past(await _walkin(client, oh, court, _at(3, 24, 30)))  # 12:30 AM (belongs to day 3's schedule)
    in_progress = await _walkin(client, oh, court, _at(3, 25, 0))  # 1:00-1:30 AM, in progress
    assert in_progress.status_code == 201, in_progress.text
    assert in_progress.json()["booking"]["starts_at"] == _iso(_at(3, 25, 0))
    # ...and the evening of the next calendar day (its own schedule day) is ahead
    assert (await _walkin(client, oh, court, _at(4, 18, 0))).status_code == 201


async def test_a_past_walkin_creates_nothing_and_a_plain_wrong_start_keeps_its_own_error(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    from sqlalchemy import func, select

    from app.models.booking import Booking

    owner, court = await _setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923180000006")
    oh = await make_auth_headers(owner)
    assert _is_past(await _walkin(client, oh, court, _at(-1, 12, 0)))
    assert await db_session.scalar(select(func.count()).select_from(Booking)) == 0
    # a future off-grid start is still INVALID_SLOT_TIME, not the past error
    off = await _walkin(client, oh, court, _at(2, 18, 10))
    assert off.status_code == 400 and off.json()["error"]["code"] == "INVALID_SLOT_TIME"
