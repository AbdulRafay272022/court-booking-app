from app.models.user import UserRole


async def test_owner_can_create_court(client, make_user, make_venue, make_auth_headers):
    owner = await make_user("+923002000001", role=UserRole.OWNER)
    venue = await make_venue(owner)
    headers = await make_auth_headers(owner)

    resp = await client.post(
        f"/api/v1/venues/{venue.id}/courts",
        headers=headers,
        json={
            "name": "Court A",
            "sport": "futsal",
            "slot_minutes": 60,
            "surface_type": "artificial_turf",
            "is_indoor": False,
            "has_floodlights": True,
        },
    )
    assert resp.status_code == 201
    court = resp.json()["court"]
    assert court["sport"] == "futsal"
    assert court["slot_minutes"] == 60
    assert court["has_floodlights"] is True


async def test_creating_court_adds_sport_to_venue(client, make_user, make_venue, make_auth_headers):
    owner = await make_user("+923002000002", role=UserRole.OWNER)
    venue = await make_venue(owner, sports=["padel"])
    headers = await make_auth_headers(owner)

    await client.post(
        f"/api/v1/venues/{venue.id}/courts",
        headers=headers,
        json={"name": "Court B", "sport": "futsal"},
    )

    resp = await client.get(f"/api/v1/venues/{venue.id}")
    assert set(resp.json()["sports"]) == {"padel", "futsal"}


async def test_non_owner_cannot_create_court(client, make_user, make_venue, make_auth_headers):
    owner = await make_user("+923002000003", role=UserRole.OWNER)
    other_owner = await make_user("+923002000004", role=UserRole.OWNER)
    venue = await make_venue(owner)
    headers = await make_auth_headers(other_owner)

    resp = await client.post(
        f"/api/v1/venues/{venue.id}/courts",
        headers=headers,
        json={"name": "Court A", "sport": "futsal"},
    )
    assert resp.status_code == 403


async def test_update_court_fields(client, make_user, make_venue, make_court, make_auth_headers):
    owner = await make_user("+923002000005", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(owner)

    resp = await client.patch(
        f"/api/v1/courts/{court.id}", headers=headers, json={"has_floodlights": True}
    )
    assert resp.status_code == 200
    assert resp.json()["has_floodlights"] is True


async def test_slot_minutes_varies_by_sport(client, make_user, make_venue, make_auth_headers):
    owner = await make_user("+923002000006", role=UserRole.OWNER)
    venue = await make_venue(owner)
    headers = await make_auth_headers(owner)

    padel = await client.post(
        f"/api/v1/venues/{venue.id}/courts",
        headers=headers,
        json={"name": "Padel Court", "sport": "padel", "slot_minutes": 90},
    )
    futsal = await client.post(
        f"/api/v1/venues/{venue.id}/courts",
        headers=headers,
        json={"name": "Futsal Court", "sport": "futsal", "slot_minutes": 60},
    )
    assert padel.json()["court"]["slot_minutes"] == 90
    assert futsal.json()["court"]["slot_minutes"] == 60


async def test_hours_that_used_to_500_are_now_overnight_hours_and_real_nonsense_is_a_clean_422(
    client, make_user, make_venue, make_court, make_auth_headers
):
    """Production incident 2026-09-20: an owner typed 06:00 -> 02:00. The DB's old CHECK (open_time < close_time)
    rejected the INSERT and the API answered an unhandled 500 ("Can't reach the server"). Since Section 32 Part 3 those
    hours are REAL overnight hours, so they are accepted (closes_next_day derived). What must stay true: input that is
    genuinely contradictory is a normal 422 VALIDATION_ERROR, never a 500, and nothing is written."""
    owner = await make_user("+923002000040", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(owner)
    url = f"/api/v1/courts/{court.id}/schedule"

    # contradictory: the flag says one thing, the times another
    for row in (
        {"day_of_week": 0, "open_time": "06:00:00", "close_time": "02:00:00", "closes_next_day": False},
        {"day_of_week": 0, "open_time": "06:00:00", "close_time": "23:00:00", "closes_next_day": True},
    ):
        resp = await client.post(url, headers=headers, json={"schedules": [row]})
        assert resp.status_code == 422, resp.text
        assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert (await client.get(f"/api/v1/courts/{court.id}")).json()["schedule_templates"] == []

    # the shapes the old rule refused are all valid now, with the flag derived from the times
    for open_time, close_time, flag in [
        ("06:00:00", "02:00:00", True),   # closes 2 AM next morning
        ("06:00:00", "06:00:00", True),   # open 24 hours
        ("06:00:00", "00:00:00", True),   # closes at midnight (the last slot is no longer lost to "23:59")
        ("06:00:00", "23:59:00", False),  # an ordinary same-day day
    ]:
        resp = await client.post(url, headers=headers, json={"schedules": [{"day_of_week": 0, "open_time": open_time, "close_time": close_time}]})
        assert resp.status_code == 200, (open_time, close_time, resp.text)
        assert resp.json()[0]["closes_next_day"] is flag


async def test_an_overnight_day_that_runs_into_the_next_days_opening_is_refused(
    client, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923002000041", role=UserRole.OWNER)
    court = await make_court(await make_venue(owner))
    headers = await make_auth_headers(owner)
    url = f"/api/v1/courts/{court.id}/schedule"

    # Thursday (3) 3 PM -> 3 AM Friday, Friday (4) opens at 2 AM: 1 hour of overlap
    resp = await client.post(
        url, headers=headers,
        json={"schedules": [
            {"day_of_week": 3, "open_time": "15:00:00", "close_time": "03:00:00"},
            {"day_of_week": 4, "open_time": "02:00:00", "close_time": "23:00:00"},
        ]},
    )
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "Thursday" in resp.json()["error"]["message"] and "Friday" in resp.json()["error"]["message"]
    assert (await client.get(f"/api/v1/courts/{court.id}")).json()["schedule_templates"] == []

    # the check also sees days ALREADY stored that this request does not touch, and the week wraps (Sunday -> Monday)
    ok = await client.post(url, headers=headers, json={"schedules": [{"day_of_week": 0, "open_time": "06:00:00", "close_time": "23:00:00"}]})
    assert ok.status_code == 200
    resp = await client.post(url, headers=headers, json={"schedules": [{"day_of_week": 6, "open_time": "18:00:00", "close_time": "08:00:00"}]})
    assert resp.status_code == 422 and "Sunday" in resp.json()["error"]["message"] and "Monday" in resp.json()["error"]["message"]

    # closing exactly when the next day opens is fine
    fine = await client.post(url, headers=headers, json={"schedules": [{"day_of_week": 6, "open_time": "18:00:00", "close_time": "06:00:00"}]})
    assert fine.status_code == 200


async def test_schedule_upsert_replaces_only_targeted_days(
    client, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923002000007", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(owner)

    first = await client.post(
        f"/api/v1/courts/{court.id}/schedule",
        headers=headers,
        json={
            "schedules": [
                {"day_of_week": 0, "open_time": "06:00:00", "close_time": "23:00:00"},
                {"day_of_week": 1, "open_time": "06:00:00", "close_time": "23:00:00"},
            ]
        },
    )
    assert first.status_code == 200
    assert len(first.json()) == 2

    # Replace only Monday's hours; Tuesday should be untouched.
    second = await client.post(
        f"/api/v1/courts/{court.id}/schedule",
        headers=headers,
        json={"schedules": [{"day_of_week": 0, "open_time": "08:00:00", "close_time": "22:00:00"}]},
    )
    assert second.status_code == 200
    # The response is the full currently-active schedule, not just the diff:
    # Monday's new hours plus Tuesday, which was left untouched.
    assert len(second.json()) == 2
    by_day = {t["day_of_week"]: t for t in second.json()}
    assert by_day[0]["open_time"] == "08:00:00"
    assert by_day[1]["open_time"] == "06:00:00"

    court_resp = await client.get(f"/api/v1/courts/{court.id}")
    templates = {t["day_of_week"]: t for t in court_resp.json()["schedule_templates"]}
    assert len(templates) == 2
    assert templates[0]["open_time"] == "08:00:00"
    assert templates[1]["open_time"] == "06:00:00"


async def test_pricing_rules_priority_order(client, make_user, make_venue, make_court, make_auth_headers):
    owner = await make_user("+923002000008", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(owner)

    resp = await client.post(
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
                    "floodlight_surcharge": 500,
                    "advance_percentage": 50,
                },
                {"name": "Weekday Default", "priority": 0, "price_per_slot": 3000, "advance_percentage": 100},
            ]
        },
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_blackout_creation(client, make_user, make_venue, make_court, make_auth_headers):
    owner = await make_user("+923002000009", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(owner)

    resp = await client.post(
        f"/api/v1/courts/{court.id}/blackouts",
        headers=headers,
        json={
            "title": "Maintenance",
            "starts_at": "2026-10-05T06:00:00+05:00",
            "ends_at": "2026-10-05T18:00:00+05:00",
            "reason": "maintenance",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["reason"] == "maintenance"


async def test_court_deactivation_notifies_players_with_live_bookings(
    client, make_user, make_venue, make_court, make_auth_headers, db_session_factory, monkeypatch
):
    """Deactivating a court used to silently leave existing live bookings
    untouched with zero signal to the player anything changed -- confirmed
    by reproducing this before the fix. See finding #27 in
    AUDIT_FINDINGS.md. Deliberately does NOT auto-cancel the booking (a
    deactivation might be temporary, and auto-cancelling a paid booking has
    the same refund-tracking gap as finding #5/#13) -- it notifies the
    player and leaves an audit trail for the owner instead."""
    from datetime import datetime, timedelta, timezone

    from app.models.audit import AuditLog
    from app.models.booking import Booking, BookingStatus
    from sqlalchemy import select

    pushed = []

    async def fake_push(self, token, title, body, data=None):
        pushed.append((token, body))

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    owner = await make_user("+923002000010", role=UserRole.OWNER)
    customer = await make_user("+923002000011", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    owner_headers = await make_auth_headers(owner)

    await client.post(
        "/api/v1/users/me/fcm-token", headers=await make_auth_headers(customer), json={"token": "player-token"}
    )

    starts_at = datetime.now(timezone.utc) + timedelta(days=2)
    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(hours=1),
            price=1000,
            advance_amount=1000,
            amount_paid=1000,
            status=BookingStatus.BOOKED,
        )
        session.add(booking)
        await session.commit()
        booking_id = booking.id

    resp = await client.delete(f"/api/v1/courts/{court.id}", headers=owner_headers)
    assert resp.status_code == 204

    async with db_session_factory() as session:
        refreshed_court = await session.get(type(court), court.id)
        assert refreshed_court.is_active is False

        refreshed_booking = await session.get(Booking, booking_id)
        # Not blocked, not auto-cancelled -- still exactly what it was.
        assert refreshed_booking.status == BookingStatus.BOOKED

        audit_rows = (
            await session.execute(
                select(AuditLog).where(
                    AuditLog.action == "court.deactivated_with_live_booking",
                    AuditLog.entity_id == booking_id,
                )
            )
        ).scalars().all()
        assert len(audit_rows) == 1

    assert len(pushed) == 1
    assert pushed[0][0] == "player-token"
    assert "unavailable" in pushed[0][1].lower()
