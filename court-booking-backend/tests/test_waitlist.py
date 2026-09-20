import asyncio
from datetime import date, datetime, time, timedelta, timezone

from app.jobs.expiry_job import cleanup_waitlist
from app.models.user import UserRole
from app.models.waitlist import WaitlistEntry


async def test_join_and_list_waitlist(client, make_user, make_venue, make_court, make_auth_headers):
    owner = await make_user("+923007000001", role=UserRole.OWNER)
    customer = await make_user("+923007000002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(customer)

    target = date.today() + timedelta(days=2)
    resp = await client.post(
        "/api/v1/waitlist",
        headers=headers,
        json={"court_id": str(court.id), "slot_starts_at": f"{target.isoformat()}T18:00:00+00:00"},
    )
    assert resp.status_code == 201
    assert resp.json()["position"] == 1

    listing = await client.get("/api/v1/waitlist/mine", headers=headers)
    assert len(listing.json()) == 1
    assert listing.json()[0]["is_active"] is True
    assert listing.json()[0]["position"] == 1
    assert listing.json()[0]["court_name"] == court.name


async def test_join_position_is_fifo(client, make_user, make_venue, make_court, make_auth_headers):
    owner = await make_user("+923007000010", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    target = date.today() + timedelta(days=2)
    slot_starts_at = f"{target.isoformat()}T18:00:00+00:00"

    positions = []
    for i in range(3):
        player = await make_user(f"+92300701100{i}", role=UserRole.PLAYER)
        headers = await make_auth_headers(player)
        resp = await client.post(
            "/api/v1/waitlist",
            headers=headers,
            json={"court_id": str(court.id), "slot_starts_at": slot_starts_at},
        )
        positions.append(resp.json()["position"])

    assert positions == [1, 2, 3]


async def test_duplicate_waitlist_join_returns_409(client, make_user, make_venue, make_court, make_auth_headers):
    owner = await make_user("+923007000020", role=UserRole.OWNER)
    customer = await make_user("+923007000021", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(customer)

    target = date.today() + timedelta(days=2)
    payload = {"court_id": str(court.id), "slot_starts_at": f"{target.isoformat()}T18:00:00+00:00"}

    first = await client.post("/api/v1/waitlist", headers=headers, json=payload)
    second = await client.post("/api/v1/waitlist", headers=headers, json=payload)
    assert first.status_code == 201
    assert second.status_code == 409


async def test_cancel_then_rejoin_waitlist_allowed(
    client, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923007000030", role=UserRole.OWNER)
    customer = await make_user("+923007000031", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers = await make_auth_headers(customer)

    target = date.today() + timedelta(days=2)
    payload = {"court_id": str(court.id), "slot_starts_at": f"{target.isoformat()}T18:00:00+00:00"}

    joined = await client.post("/api/v1/waitlist", headers=headers, json=payload)
    entry_id = None
    listing = await client.get("/api/v1/waitlist/mine", headers=headers)
    entry_id = listing.json()[0]["id"]

    cancelled = await client.delete(f"/api/v1/waitlist/{entry_id}", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["is_active"] is False

    rejoined = await client.post("/api/v1/waitlist", headers=headers, json=payload)
    assert rejoined.status_code == 201
    assert rejoined.json()["position"] == 1


async def test_cannot_cancel_another_players_waitlist_entry(
    client, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923007000040", role=UserRole.OWNER)
    customer_a = await make_user("+923007000041", role=UserRole.PLAYER)
    customer_b = await make_user("+923007000042", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    headers_a = await make_auth_headers(customer_a)
    headers_b = await make_auth_headers(customer_b)

    target = date.today() + timedelta(days=2)
    payload = {"court_id": str(court.id), "slot_starts_at": f"{target.isoformat()}T18:00:00+00:00"}
    await client.post("/api/v1/waitlist", headers=headers_a, json=payload)
    entry_id = (await client.get("/api/v1/waitlist/mine", headers=headers_a)).json()[0]["id"]

    resp = await client.delete(f"/api/v1/waitlist/{entry_id}", headers=headers_b)
    assert resp.status_code == 404


async def test_cancelling_booking_notifies_all_matching_waitlisters(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Deliberate departure from strict FIFO exclusivity (finding #15):
    every active waitlist entry for the freed court+slot is notified at
    once, not just the FIFO-first one -- waitlist means you'll hear about
    it first, not that your place in line reserves the slot."""
    # Slot-reopened is a Tier 1 (push-only, see Section 8) notification -- it
    # never goes out over WhatsApp, so we capture pushes, not WhatsApp sends.
    pushed = []

    async def fake_push(self, token, title, body, data=None):
        pushed.append(token)

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    owner = await make_user("+923007000003", role=UserRole.OWNER)
    customer = await make_user("+923007000004", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    target = date.today() + timedelta(days=2)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)

    # Schedule hours are PKT; 18:00 PKT is 13:00 UTC (PKT-5).
    slot_starts_at = f"{target.isoformat()}T13:00:00+00:00"

    waiters = []
    for i in range(3):
        waiter = await make_user(f"+92300700050{i}", role=UserRole.PLAYER)
        waiter_headers = await make_auth_headers(waiter)
        await client.post(
            "/api/v1/users/me/fcm-token", headers=waiter_headers, json={"token": f"waiter-token-{i}"}
        )
        await client.post(
            "/api/v1/waitlist",
            headers=waiter_headers,
            json={"court_id": str(court.id), "slot_starts_at": slot_starts_at},
        )
        waiters.append(waiter)

    customer_headers = await make_auth_headers(customer)
    booking = await client.post(
        "/api/v1/bookings/hold",
        headers=customer_headers,
        json={"court_id": str(court.id), "starts_at": slot_starts_at},
    )
    booking_id = booking.json()["booking"]["id"]

    await client.post(f"/api/v1/bookings/{booking_id}/cancel", headers=customer_headers, json={})

    assert sorted(pushed) == ["waiter-token-0", "waiter-token-1", "waiter-token-2"]


async def test_first_waitlisted_player_to_hold_wins_others_see_slot_gone(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """No exclusive hold is created for any notified waitlist entry (finding
    #15's chosen design) -- two notified players racing to actually hold
    the slot resolve exactly like any other two players racing for the
    same slot, via the existing one_live_booking_per_slot unique index."""
    async def fake_push(self, token, title, body, data=None):
        return None

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    owner = await make_user("+923007000070", role=UserRole.OWNER)
    customer = await make_user("+923007000071", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    target = date.today() + timedelta(days=2)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)

    slot_starts_at = f"{target.isoformat()}T13:00:00+00:00"

    waiter_a = await make_user("+923007000072", role=UserRole.PLAYER)
    waiter_b = await make_user("+923007000073", role=UserRole.PLAYER)
    headers_a = await make_auth_headers(waiter_a)
    headers_b = await make_auth_headers(waiter_b)
    for headers in (headers_a, headers_b):
        await client.post(
            "/api/v1/waitlist",
            headers=headers,
            json={"court_id": str(court.id), "slot_starts_at": slot_starts_at},
        )

    customer_headers = await make_auth_headers(customer)
    booking = await client.post(
        "/api/v1/bookings/hold",
        headers=customer_headers,
        json={"court_id": str(court.id), "starts_at": slot_starts_at},
    )
    booking_id = booking.json()["booking"]["id"]
    await client.post(f"/api/v1/bookings/{booking_id}/cancel", headers=customer_headers, json={})
    # Both waiter_a and waiter_b were notified by the cancel above -- now
    # race them both trying to actually hold the freed slot.

    resp_a, resp_b = await asyncio.gather(
        client.post(
            "/api/v1/bookings/hold", headers=headers_a, json={"court_id": str(court.id), "starts_at": slot_starts_at}
        ),
        client.post(
            "/api/v1/bookings/hold", headers=headers_b, json={"court_id": str(court.id), "starts_at": slot_starts_at}
        ),
    )
    codes = {resp_a.status_code, resp_b.status_code}
    assert codes == {201, 409}, f"a={resp_a.status_code} b={resp_b.status_code}"


async def test_waitlist_cleanup_deactivates_past_slots(db_session_factory, make_user, make_venue, make_court):
    owner = await make_user("+923007000060", role=UserRole.OWNER)
    customer = await make_user("+923007000061", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    past_slot = datetime.now(timezone.utc) - timedelta(hours=1)
    async with db_session_factory() as session:
        entry = WaitlistEntry(court_id=court.id, player_id=customer.id, slot_starts_at=past_slot)
        session.add(entry)
        await session.commit()
        entry_id = entry.id

    deactivated_count = await cleanup_waitlist(session_factory=db_session_factory)
    assert deactivated_count == 1

    async with db_session_factory() as session:
        refreshed = await session.get(WaitlistEntry, entry_id)
        assert refreshed.is_active is False


async def test_waitlist_advances_to_next_person_after_grace_period(
    db_session_factory, make_user, make_venue, make_court, monkeypatch
):
    pushed = []

    async def fake_push(self, token, title, body, data=None):
        pushed.append(token)

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    owner = await make_user("+923007000070", role=UserRole.OWNER)
    waiter_a = await make_user("+923007000071", role=UserRole.PLAYER)
    waiter_b = await make_user("+923007000072", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    future_slot = datetime.now(timezone.utc) + timedelta(days=2)

    async with db_session_factory() as session:
        from app.models.fcm_token import FCMToken

        session.add(FCMToken(user_id=waiter_a.id, token="waiter-a-token"))
        session.add(FCMToken(user_id=waiter_b.id, token="waiter-b-token"))
        # waiter_a was already notified 11 minutes ago (past the 10-minute
        # grace period) and never acted; waiter_b is still waiting.
        session.add(
            WaitlistEntry(
                court_id=court.id,
                player_id=waiter_a.id,
                slot_starts_at=future_slot,
                notified_at=datetime.now(timezone.utc) - timedelta(minutes=11),
            )
        )
        session.add(WaitlistEntry(court_id=court.id, player_id=waiter_b.id, slot_starts_at=future_slot))
        await session.commit()

    await cleanup_waitlist(session_factory=db_session_factory)
    assert pushed == ["waiter-b-token"]

    async with db_session_factory() as session:
        from sqlalchemy import select

        result = await session.execute(
            select(WaitlistEntry).where(WaitlistEntry.player_id == waiter_a.id)
        )
        assert result.scalar_one().is_active is False
