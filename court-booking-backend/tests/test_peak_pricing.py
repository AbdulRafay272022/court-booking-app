"""Peak-hour pricing: a base all-day rate (PKR 3,000) plus a peak rate (PKR 4,000, 6 PM to 11 PM) must charge 4,000 inside
the peak window and 3,000 outside it, on the availability grid, the quote, the hold, and after the owner re-saves the
rules from the settings screen (which sends them back in the order the API returned them)."""

from datetime import time, timedelta

from app.models.user import UserRole
from app.utils.timezone import pkt_time_to_utc, pkt_today

BASE = dict(name="All day", priority=0, day_of_week=None, price_per_slot=3000, floodlight_surcharge=0, advance_percentage=100)
PEAK = dict(name="Peak", priority=1, day_of_week=None, start_time="18:00:00", end_time="23:00:00", price_per_slot=4000,
            floodlight_surcharge=0, advance_percentage=100)


async def _setup(client, make_user, make_venue, make_court, make_schedule, make_auth_headers, phone):
    owner = await make_user(phone, role=UserRole.OWNER)
    court = await make_court(await make_venue(owner), slot_minutes=60)
    day = pkt_today() + timedelta(days=1)
    for d in range(7):
        await make_schedule(court, day_of_week=d, open_time=time(6, 0), close_time=time(23, 0))
    headers = await make_auth_headers(owner)
    return owner, court, day, headers


async def _prices(client, court, day):
    resp = await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})
    assert resp.status_code == 200, resp.text
    out = {}
    for s in resp.json()["slots"]:
        hhmm = (pkt_time_to_utc(day, time(0, 0)) and s["starts_at"])  # keep the raw instant, convert below
        out[s["starts_at"]] = s["price"]
    return out


def _at(day, hh, mm=0):
    return pkt_time_to_utc(day, time(hh, mm)).isoformat().replace("+00:00", "Z")


async def test_peak_rule_applies_inside_the_window_and_base_outside(
    client, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner, court, day, headers = await _setup(client, make_user, make_venue, make_court, make_schedule, make_auth_headers, "+923081000001")
    resp = await client.post(f"/api/v1/courts/{court.id}/pricing", headers=headers, json={"rules": [BASE, PEAK]})
    assert resp.status_code == 200, resp.text

    prices = await _prices(client, court, day)
    assert prices[_at(day, 12, 0)] == 1500  # 30-minute cell of a 60-minute court at 3,000
    assert prices[_at(day, 17, 30)] == 1500
    assert prices[_at(day, 18, 0)] == 2000  # peak: 4,000 per hour
    assert prices[_at(day, 22, 30)] == 2000

    player = await make_user("+923081000002", role=UserRole.PLAYER)
    q = await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": _at(day, 19, 0), "slot_count": 2},
                         headers=await make_auth_headers(player))
    assert q.status_code == 200, q.text
    assert q.json()["price"] == 4000
    hold = await client.post("/api/v1/bookings/hold", headers=await make_auth_headers(player),
                             json={"court_id": str(court.id), "starts_at": _at(day, 19, 0), "slot_count": 2})
    assert hold.status_code == 201, hold.text
    assert hold.json()["booking"]["price"] == 4000


async def test_peak_still_wins_after_the_owner_resaves_rules_in_the_order_the_api_returned_them(
    client, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    """Venue Settings loads a court's rules and saves them back with priority = list position. The API must return them
    lowest priority first (base, then peak), or a re-save silently ranks the base rate above the peak one."""
    owner, court, day, headers = await _setup(client, make_user, make_venue, make_court, make_schedule, make_auth_headers, "+923081000003")
    # the owner first saved the rules peak-first with explicit priorities (peak = 5, base = 0), as an API client may
    first = await client.post(f"/api/v1/courts/{court.id}/pricing", headers=headers,
                              json={"rules": [{**PEAK, "priority": 5}, {**BASE, "priority": 0}]})
    assert first.status_code == 200

    got = await client.get(f"/api/v1/courts/{court.id}")
    rules = got.json()["pricing_rules"]
    assert [r["name"] for r in rules] == ["All day", "Peak"]  # lowest priority first, whatever order they were stored in

    resave = [{"name": r["name"], "priority": i, "day_of_week": r["day_of_week"], "start_time": r["start_time"],
               "end_time": r["end_time"], "price_per_slot": r["price_per_slot"], "floodlight_surcharge": 0,
               "advance_percentage": 100} for i, r in enumerate(rules)]
    assert (await client.post(f"/api/v1/courts/{court.id}/pricing", headers=headers, json={"rules": resave})).status_code == 200
    prices = await _prices(client, court, day)
    assert prices[_at(day, 19, 0)] == 2000
    assert prices[_at(day, 12, 0)] == 1500


async def test_peak_applies_for_an_older_app_build_too(
    legacy_client, client, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner, court, day, headers = await _setup(client, make_user, make_venue, make_court, make_schedule, make_auth_headers, "+923081000004")
    assert (await client.post(f"/api/v1/courts/{court.id}/pricing", headers=headers, json={"rules": [BASE, PEAK]})).status_code == 200
    resp = await legacy_client.get(f"/api/v1/courts/{court.id}/availability", params={"date": day.isoformat()})
    prices = {s["starts_at"]: s["price"] for s in resp.json()["slots"]}
    assert prices[_at(day, 12, 0)] == 3000
    assert prices[_at(day, 19, 0)] == 4000
    player = await make_user("+923081000005", role=UserRole.PLAYER)
    hold = await legacy_client.post("/api/v1/bookings/hold", headers=await make_auth_headers(player),
                                    json={"court_id": str(court.id), "starts_at": _at(day, 19, 0)})
    assert hold.status_code == 201, hold.text
    assert hold.json()["booking"]["price"] == 4000
