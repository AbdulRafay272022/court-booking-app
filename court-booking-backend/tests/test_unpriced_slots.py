"""fix/nov-9 item 4: a slot the list shows as open must be bookable. An open hour with no price rule (production: Court Site
Padel 2 opened 6 AM on Sunday, its rates start at 10 AM) used to be listed "available" at PKR 0 while the hold refused it
with INVALID_SLOT_TIME ("That time isn't available anymore"). It is listed as unavailable now."""
from datetime import date, time, timedelta

from app.models.user import UserRole
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def _next_sunday() -> date:
    d = pkt_today() + timedelta(days=2)
    while d.weekday() != 6:
        d += timedelta(days=1)
    return d


async def test_hours_without_a_rate_are_not_listed_as_open_and_every_open_slot_can_be_quoted(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923091110001", role=UserRole.OWNER)
    court = await make_court(await make_venue(owner), slot_minutes=60)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(4, 0))
    # like Padel 2: the only rate starts at 10 AM, the court opens at 6 AM
    await make_pricing_rule(court, price_per_slot=3500, start_time=time(10, 0), end_time=time(6, 0))
    sun = _next_sunday()
    resp = await client.get(f"/api/v1/courts/{court.id}/availability", params={"date": sun.isoformat()})
    slots = resp.json()["slots"]
    six_thirty = _iso(pkt_time_to_utc(sun, time(6, 30)))
    s630 = next(s for s in slots if s["starts_at"] == six_thirty)
    assert s630["status"] == "blocked" and s630["price"] == 0
    assert all(s["status"] == "blocked" for s in slots if s["price"] == 0)
    # every slot listed as available is really bookable: the quote for its minimum booking succeeds
    open_slots = [s for s in slots if s["status"] == "available"]
    assert open_slots and open_slots[0]["starts_at"] == _iso(pkt_time_to_utc(sun, time(10, 0)))
    for s in open_slots[:-1]:  # the last 30-minute cell can't hold a 60-minute minimum
        q = await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": s["starts_at"]})
        assert q.status_code == 200, (s["starts_at"], q.text)
    # and 6:30 AM is refused as unavailable, not as a vanished slot
    headers = await make_auth_headers(await make_user("+923091110002"))
    hold = await client.post("/api/v1/bookings/hold", headers=headers, json={"court_id": str(court.id), "starts_at": six_thirty, "slot_count": 2})
    assert hold.status_code == 400 and hold.json()["error"]["code"] == "SLOT_BLOCKED", hold.text
