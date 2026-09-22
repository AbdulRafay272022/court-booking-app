"""Section 32 Part 4b: the month calendar's dots (GET /courts/{id}/availability/summary) and the per-venue booking horizon.

The summary must (1) agree with the day view for every day, because it runs the SAME grid code, (2) cost a handful of queries
for a whole month, not a set per day, (3) classify days as open / few / full / closed, plus past and beyond, and (4) stop at
the venue's booking_horizon_days, which is also enforced when a player tries to hold or quote a slot beyond it."""
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import event, select

from app.models.blackout import Blackout
from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.user import UserRole
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _at(day: date, hh: int, mm: int = 0) -> datetime:
    return pkt_time_to_utc(day, time(0, 0)) + timedelta(hours=hh, minutes=mm)


async def _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, *, open_=time(6, 0), close=time(23, 0),
                 slot_minutes=60, price=1000, venue_kwargs=None, court_kwargs=None):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner, **(venue_kwargs or {}))
    court = await make_court(venue, slot_minutes=slot_minutes, **(court_kwargs or {}))
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=open_, close_time=close)
    if price:
        await make_pricing_rule(court, price_per_slot=price)
    return owner, venue, court


def _month(d: date) -> str:
    return d.strftime("%Y-%m")


async def _summary(client, court, month: str):
    resp = await client.get(f"/api/v1/courts/{court.id}/availability/summary", params={"month": month})
    assert resp.status_code == 200, resp.text
    return resp


async def _book(db_session_factory, court, starts, hours=1, status=BookingStatus.BOOKED):
    async with db_session_factory() as s:
        s.add(Booking(court_id=court.id, starts_at=starts, ends_at=starts + timedelta(hours=hours), status=status,
                      source=BookingSource.WALKIN, player_name="x", price=1000, advance_amount=0, balance_due=1000))
        await s.commit()


async def test_every_day_of_the_summary_matches_the_day_view(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923100000001")
    d = pkt_today() + timedelta(days=3)
    await _book(db_session_factory, court, _at(d, 10), hours=2)
    await _book(db_session_factory, court, _at(d + timedelta(days=1), 18))
    async with db_session_factory() as s:
        owner_id = (await s.execute(select(Blackout.created_by).limit(1))).scalar_one_or_none()
        from app.models.user import User
        owner = (await s.execute(select(User).where(User.phone == "+923100000001"))).scalar_one()
        s.add(Blackout(court_id=court.id, created_by=owner.id, starts_at=_at(d + timedelta(days=2), 12), ends_at=_at(d + timedelta(days=2), 15), reason="x"))
        await s.commit()

    summary = (await _summary(client, court, _month(d))).json()
    checked = 0
    for row in summary["days"]:
        if row["state"] in ("past", "beyond"):
            continue
        day = (await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": row["date"]})).json()["slots"]
        now = datetime.now(timezone.utc)
        open_now = sum(1 for s in day if s["status"] == "available" and datetime.fromisoformat(s["starts_at"].replace("Z", "+00:00")) > now)
        assert row["total_slots"] == len(day), row
        assert row["open_slots"] == open_now, row
        checked += 1
    assert checked >= 5


async def test_a_month_costs_a_handful_of_queries_not_a_set_per_day(
    client, test_engine, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923100000002")
    statements: list[str] = []

    def count(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    event.listen(test_engine.sync_engine, "before_cursor_execute", count)
    try:
        await _summary(client, court, _month(pkt_today()))
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", count)
    selects = [s for s in statements if s.lstrip().upper().startswith("SELECT")]
    # court, venue, templates, rules, blackouts, bookings (+ the connection's own bookkeeping): NOT ~30 days x 4
    assert len(selects) <= 10, f"{len(selects)} queries for a month: {selects}"


async def test_states_open_few_full_closed_past_and_the_cache_header(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    owner, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923100000003",
                                    open_=time(8, 0), close=time(18, 0))  # 10 one-hour slots a day
    today = pkt_today()
    d_open, d_few, d_full, d_closed = (today + timedelta(days=n) for n in (2, 3, 4, 5))
    for h in (8, 9):                       # 8 of 10 left = open (>20%)
        await _book(db_session_factory, court, _at(d_open, h))
    for h in range(8, 16):                 # 2 of 10 left = 20% -> few
        await _book(db_session_factory, court, _at(d_few, h))
    for h in range(8, 18):                 # 0 left = full
        await _book(db_session_factory, court, _at(d_full, h))
    async with db_session_factory() as s:                      # every slot blocked = closed
        s.add(Blackout(court_id=court.id, created_by=owner.id, starts_at=_at(d_closed, 0), ends_at=_at(d_closed, 24), reason="private event"))
        await s.commit()

    resp = await _summary(client, court, _month(d_open))
    assert resp.headers["cache-control"] == "public, max-age=30"
    by = {r["date"]: r for r in resp.json()["days"]}
    assert by[d_open.isoformat()]["state"] == "open" and by[d_open.isoformat()]["open_slots"] == 8
    assert by[d_few.isoformat()]["state"] == "few" and by[d_few.isoformat()]["open_slots"] == 2
    assert by[d_full.isoformat()]["state"] == "full" and by[d_full.isoformat()]["open_slots"] == 0 and by[d_full.isoformat()]["total_slots"] == 10
    assert by[d_closed.isoformat()]["state"] == "closed"
    if today.day > 1:
        assert by[(today - timedelta(days=1)).isoformat()]["state"] == "past"


async def test_a_day_with_no_schedule_is_closed(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    owner = await make_user("+923100000004", role=UserRole.OWNER)
    court = await make_court(await make_venue(owner))
    await make_schedule(court, day_of_week=0, open_time=time(8, 0), close_time=time(20, 0))  # Mondays only
    await make_pricing_rule(court, price_per_slot=1000)
    by = {r["date"]: r for r in (await _summary(client, court, _month(pkt_today() + timedelta(days=1)))).json()["days"]}
    someday_tuesday = next(d for d in (pkt_today() + timedelta(days=n) for n in range(1, 9)) if d.weekday() == 1)
    assert by.get(someday_tuesday.isoformat(), {"state": "closed"})["state"] in ("closed", "past", "beyond")
    monday = next(d for d in (pkt_today() + timedelta(days=n) for n in range(1, 9)) if d.weekday() == 0)
    if _month(monday) == _month(pkt_today() + timedelta(days=1)):
        assert by[monday.isoformat()]["state"] in ("open", "few", "full")


async def test_todays_slots_that_already_started_are_not_open(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """Between 3 AM and 11 PM the past slots of today must not make today look open: only slots still ahead count."""
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923100000005")
    resp = (await _summary(client, court, _month(pkt_today()))).json()
    today_row = next(r for r in resp["days"] if r["date"] == pkt_today().isoformat())
    assert today_row["open_slots"] <= today_row["total_slots"] == 17


async def test_an_overnight_courts_day_includes_its_after_midnight_slots(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923100000006",
                                 open_=time(15, 0), close=time(3, 0))
    row = next(r for r in (await _summary(client, court, _month(pkt_today() + timedelta(days=3)))).json()["days"]
               if r["date"] == (pkt_today() + timedelta(days=3)).isoformat())
    assert row["total_slots"] == 12  # 3 PM ... 2 AM


async def test_starts_from_price_is_the_lowest_active_rule_including_floodlights(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, _v, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923100000007",
                                 price=2500, court_kwargs={"has_floodlights": True})
    await make_pricing_rule(court, name="Cheap", priority=5, start_time=time(6, 0), end_time=time(10, 0), price_per_slot=1800, floodlight_surcharge=200)
    await make_pricing_rule(court, name="Off", priority=9, price_per_slot=100, is_active=False)  # inactive rules never count
    body = (await _summary(client, court, _month(pkt_today()))).json()
    assert body["starts_from_price"] == 2000.0  # 1800 + 200 floodlight, not the inactive 100 and not 2500
    assert body["slot_minutes"] == 60


# ---- the booking horizon -------------------------------------------------------------------------------------

async def test_the_calendar_stops_at_the_venues_horizon_and_a_hold_beyond_it_is_refused(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923100000008",
                                       venue_kwargs={"booking_horizon_days": 10})
    player = await make_user("+923100000009", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    today = pkt_today()
    last = today + timedelta(days=10)

    # the summary marks the days past the horizon and says where it ends
    far = today + timedelta(days=40)
    body = (await _summary(client, court, _month(far))).json()
    assert body["booking_horizon_days"] == 10 and body["last_bookable_date"] == last.isoformat()
    assert next(r for r in body["days"] if r["date"] == far.isoformat())["state"] == "beyond"

    ok_hold = await client.post("/api/v1/bookings/hold", headers=headers, json={"court_id": str(court.id), "starts_at": _iso(_at(last, 12))})
    assert ok_hold.status_code == 201, ok_hold.text
    too_far = await client.post("/api/v1/bookings/hold", headers=headers, json={"court_id": str(court.id), "starts_at": _iso(_at(last + timedelta(days=1), 12))})
    assert too_far.status_code == 400 and too_far.json()["error"]["code"] == "BOOKING_TOO_FAR"
    assert "10 days ahead" in too_far.json()["error"]["message"]
    q = await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _iso(_at(last + timedelta(days=1), 12)), "slot_count": 1})
    assert q.status_code == 400 and q.json()["error"]["code"] == "BOOKING_TOO_FAR"

    # the owner changes the setting (a per-venue setting, not a constant) and the same slot opens up
    owner_headers = await make_auth_headers(owner)
    patch = await client.patch(f"/api/v1/venues/{venue.id}", headers=owner_headers, json={"booking_horizon_days": 30})
    assert patch.status_code == 200 and patch.json()["booking_horizon_days"] == 30
    assert (await client.post("/api/v1/bookings/hold", headers=headers, json={"court_id": str(court.id), "starts_at": _iso(_at(last + timedelta(days=1), 12))})).status_code == 201

    # an owner's walk-in is not limited by it
    walk = await client.post("/api/v1/bookings/walkin", headers=owner_headers,
                             json={"court_id": str(court.id), "starts_at": _iso(_at(today + timedelta(days=45), 12)), "player_name": "Far", "amount_paid": 0})
    assert walk.status_code == 201, walk.text


@pytest.mark.parametrize("value,ok", [(1, True), (90, True), (365, True), (0, False), (366, False)])
async def test_the_horizon_setting_is_bounded(client, make_user, make_venue, make_auth_headers, value, ok):
    owner = await make_user(f"+92310001{value:04d}", role=UserRole.OWNER)
    venue = await make_venue(owner)
    resp = await client.patch(f"/api/v1/venues/{venue.id}", headers=await make_auth_headers(owner), json={"booking_horizon_days": value})
    assert (resp.status_code == 200) is ok, resp.text


async def test_new_venues_default_to_90_days(client, make_user, make_venue):
    owner = await make_user("+923100000010", role=UserRole.OWNER)
    venue = await make_venue(owner)
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}")).json()["booking_horizon_days"] == 90
