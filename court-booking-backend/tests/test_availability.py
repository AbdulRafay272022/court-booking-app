import time as time_module
from datetime import date, datetime, time, timedelta, timezone

from app.models.booking import Booking, BookingStatus
from app.models.user import UserRole


async def test_schedule_local_time_converts_correctly_to_utc(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, next_weekday
):
    """schedule_templates.open_time/close_time are entered as PKT wall-clock
    hours (Pakistan has no DST, fixed UTC+5). The availability grid -- and
    anything downstream that stores/looks up a real booking timestamp --
    must convert them to real UTC instants, not treat "06:00" as 06:00 UTC."""
    owner = await make_user("+923009900001", role=UserRole.OWNER)
    customer = await make_user("+923009900002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    target_date = next_weekday(0)
    await make_schedule(court, day_of_week=0, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)

    resp = await client.get(
        f"/api/v1/courts/{court.id}/availability", params={"date": target_date.isoformat()}
    )
    slots = resp.json()["slots"]
    first_starts = datetime.fromisoformat(slots[0]["starts_at"])
    last_ends = datetime.fromisoformat(slots[-1]["ends_at"])

    # 06:00 PKT == 01:00 UTC; 23:00 PKT == 18:00 UTC.
    assert first_starts == datetime(target_date.year, target_date.month, target_date.day, 1, 0, tzinfo=timezone.utc)
    assert last_ends == datetime(target_date.year, target_date.month, target_date.day, 18, 0, tzinfo=timezone.utc)

    # A booking held at 19:00 PKT must round-trip through the DB as 14:00 UTC.
    headers = await make_auth_headers(customer)
    starts_at_str = f"{target_date.isoformat()}T14:00:00+00:00"
    hold_resp = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": starts_at_str},
    )
    assert hold_resp.status_code == 201, hold_resp.text
    booking_starts_at = datetime.fromisoformat(hold_resp.json()["booking"]["starts_at"])
    assert booking_starts_at == datetime(
        target_date.year, target_date.month, target_date.day, 14, 0, tzinfo=timezone.utc
    )

    resp_after = await client.get(
        f"/api/v1/courts/{court.id}/availability", params={"date": target_date.isoformat()}
    )
    by_start = {s["starts_at"][11:16]: s for s in resp_after.json()["slots"]}
    assert by_start["14:00"]["status"] == "held"


async def test_basic_slot_generation(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, next_weekday
):
    owner = await make_user("+923011000001", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    await make_schedule(court, day_of_week=0, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3000)

    target_date = next_weekday(0)
    resp = await client.get(
        f"/api/v1/courts/{court.id}/availability", params={"date": target_date.isoformat()}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["slot_minutes"] == 60
    assert len(body["slots"]) == 17
    assert all(s["status"] == "available" for s in body["slots"])


async def test_ninety_minute_slots(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, next_weekday
):
    owner = await make_user("+923011000002", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=90)
    await make_schedule(court, day_of_week=0, open_time=time(6, 0), close_time=time(22, 30))
    await make_pricing_rule(court, price_per_slot=4000)

    target_date = next_weekday(0)
    resp = await client.get(
        f"/api/v1/courts/{court.id}/availability", params={"date": target_date.isoformat()}
    )
    slots = resp.json()["slots"]
    assert len(slots) == 11
    # Schedule hours (06:00-22:30) are PKT; returned starts_at is UTC (PKT-5).
    expected_starts = ["01:00", "02:30", "04:00", "05:30", "07:00", "08:30", "10:00", "11:30", "13:00", "14:30", "16:00"]
    for slot, expected_start in zip(slots, expected_starts):
        assert slot["starts_at"][11:16] == expected_start
        starts = datetime.fromisoformat(slot["starts_at"])
        ends = datetime.fromisoformat(slot["ends_at"])
        assert (ends - starts).total_seconds() == 90 * 60


async def test_blackout_overlay(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, next_weekday
):
    owner = await make_user("+923011000003", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    await make_schedule(court, day_of_week=0, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3000)
    headers = await make_auth_headers(owner)

    target_date = next_weekday(0)
    starts_at = f"{target_date.isoformat()}T10:00:00+00:00"
    ends_at = f"{target_date.isoformat()}T14:00:00+00:00"
    blackout = await client.post(
        f"/api/v1/courts/{court.id}/blackouts",
        headers=headers,
        json={"title": "Maintenance", "starts_at": starts_at, "ends_at": ends_at, "reason": "maintenance"},
    )
    assert blackout.status_code == 201

    resp = await client.get(
        f"/api/v1/courts/{court.id}/availability", params={"date": target_date.isoformat()}
    )
    by_start = {s["starts_at"][11:16]: s for s in resp.json()["slots"]}
    for hour in ("10:00", "11:00", "12:00", "13:00"):
        assert by_start[hour]["status"] == "blocked"
        assert by_start[hour]["reason"] == "maintenance"
    assert by_start["09:00"]["status"] == "available"
    assert by_start["14:00"]["status"] == "available"


async def test_booking_overlay(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, db_session_factory, next_weekday
):
    owner = await make_user("+923011000004", role=UserRole.OWNER)
    customer = await make_user("+923011000005", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    await make_schedule(court, day_of_week=0, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3000)

    target_date = next_weekday(0)
    slot_start = datetime.combine(target_date, time(10, 0), tzinfo=timezone.utc)
    slot_end = datetime.combine(target_date, time(11, 0), tzinfo=timezone.utc)

    async with db_session_factory() as session:
        session.add(
            Booking(
                court_id=court.id,
                player_id=customer.id,
                starts_at=slot_start,
                ends_at=slot_end,
                price=3000,
                status=BookingStatus.BOOKED,
            )
        )
        await session.commit()

    resp = await client.get(
        f"/api/v1/courts/{court.id}/availability", params={"date": target_date.isoformat()}
    )
    by_start = {s["starts_at"][11:16]: s for s in resp.json()["slots"]}
    assert by_start["10:00"]["status"] == "booked"
    assert by_start["09:00"]["status"] == "available"
    assert by_start["11:00"]["status"] == "available"


async def test_pricing_overlay_weekend_peak_vs_default(
    client, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner = await make_user("+923011000006", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    headers = await make_auth_headers(owner)

    # Saturday=5, Sunday=6 in this app's Monday=0 convention.
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))

    await client.post(
        f"/api/v1/courts/{court.id}/pricing",
        headers=headers,
        json={
            "rules": [
                {
                    "name": "Weekend Peak",
                    "priority": 10,
                    "day_of_week": [5, 6],
                    "start_time": "17:00:00",
                    "end_time": "23:00:00",
                    "price_per_slot": 5000,
                    "advance_percentage": 100,
                },
                {"name": "Default", "priority": 0, "price_per_slot": 3000, "advance_percentage": 100},
            ]
        },
    )

    today = date.today()
    saturday = today + timedelta(days=(5 - today.weekday()) % 7 or 7)
    monday = today + timedelta(days=(0 - today.weekday()) % 7 or 7)

    sat_resp = await client.get(
        f"/api/v1/courts/{court.id}/availability", params={"date": saturday.isoformat()}
    )
    # Pricing rule windows (17:00-23:00) are PKT; returned starts_at is UTC
    # (PKT-5), so 18:00 PKT / 10:00 PKT show up as 13:00 / 05:00 UTC.
    sat_by_start = {s["starts_at"][11:16]: s for s in sat_resp.json()["slots"]}
    assert sat_by_start["13:00"]["price"] == 5000.0
    assert sat_by_start["05:00"]["price"] == 3000.0

    mon_resp = await client.get(
        f"/api/v1/courts/{court.id}/availability", params={"date": monday.isoformat()}
    )
    assert all(s["price"] == 3000.0 for s in mon_resp.json()["slots"])


async def test_advance_amount_calculation(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, next_weekday
):
    owner = await make_user("+923011000007", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    await make_schedule(court, day_of_week=0, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=4000, advance_percentage=50)

    target_date = next_weekday(0)
    resp = await client.get(
        f"/api/v1/courts/{court.id}/availability", params={"date": target_date.isoformat()}
    )
    slot = resp.json()["slots"][0]
    assert slot["price"] == 4000.0
    assert slot["advance_amount"] == 2000.0


async def test_no_schedule_means_no_slots(client, make_user, make_venue, make_court, next_weekday):
    owner = await make_user("+923011000008", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    sunday = next_weekday(6)
    resp = await client.get(
        f"/api/v1/courts/{court.id}/availability", params={"date": sunday.isoformat()}
    )
    assert resp.status_code == 200
    assert resp.json()["slots"] == []


async def test_date_range_query_respects_each_days_schedule(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, next_weekday
):
    owner = await make_user("+923011000009", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    await make_pricing_rule(court, price_per_slot=3000)
    # Only Monday (0) and Wednesday (2) are open.
    await make_schedule(court, day_of_week=0, open_time=time(6, 0), close_time=time(9, 0))
    await make_schedule(court, day_of_week=2, open_time=time(6, 0), close_time=time(12, 0))

    start = next_weekday(0)
    end = start + timedelta(days=6)

    resp = await client.get(
        f"/api/v1/courts/{court.id}/availability",
        params={"start_date": start.isoformat(), "end_date": end.isoformat()},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["days"]) == 7
    slot_counts = {d["date"]: len(d["slots"]) for d in body["days"]}
    assert slot_counts[start.isoformat()] == 3  # Monday: 06:00-09:00
    assert slot_counts[(start + timedelta(days=2)).isoformat()] == 6  # Wednesday: 06:00-12:00
    assert slot_counts[(start + timedelta(days=1)).isoformat()] == 0  # Tuesday: closed


async def test_date_range_over_28_days_rejected(client, make_user, make_venue, make_court, next_weekday):
    owner = await make_user("+923011000010", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    start = next_weekday(0)
    end = start + timedelta(days=29)

    resp = await client.get(
        f"/api/v1/courts/{court.id}/availability",
        params={"start_date": start.isoformat(), "end_date": end.isoformat()},
    )
    assert resp.status_code == 400


async def test_venue_wide_availability_covers_all_courts(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, next_weekday
):
    owner = await make_user("+923011000011", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court_a = await make_court(venue, name="Court A", slot_minutes=60)
    court_b = await make_court(venue, name="Court B", slot_minutes=60)
    for court in (court_a, court_b):
        await make_schedule(court, day_of_week=0, open_time=time(6, 0), close_time=time(8, 0))
        await make_pricing_rule(court, price_per_slot=1000)

    target_date = next_weekday(0)
    resp = await client.get(
        f"/api/v1/venues/{venue.id}/availability", params={"date": target_date.isoformat()}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["courts"]) == 2
    for court_availability in body["courts"]:
        assert len(court_availability["slots"]) == 2


async def test_availability_performance_28_day_range(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, next_weekday
):
    owner = await make_user("+923011000012", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3000)

    start = next_weekday(0)
    end = start + timedelta(days=27)

    started = time_module.perf_counter()
    resp = await client.get(
        f"/api/v1/courts/{court.id}/availability",
        params={"start_date": start.isoformat(), "end_date": end.isoformat()},
    )
    elapsed_ms = (time_module.perf_counter() - started) * 1000

    assert resp.status_code == 200
    total_slots = sum(len(d["slots"]) for d in resp.json()["days"])
    assert total_slots == 28 * 17
    # Generous margin over the spec's 200ms target since this also pays for
    # the HTTP round-trip and JSON (de)serialization in the test process.
    assert elapsed_ms < 2000, f"28-day availability took {elapsed_ms:.0f}ms"
