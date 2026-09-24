from datetime import date, datetime, time, timedelta, timezone

from app.models.booking import Booking, BookingStatus
from app.models.user import UserRole


async def _open_all_week(make_schedule, court) -> None:
    """Every hold/walk-in test in this file uses T10:00:00Z at some
    date.today()+N -- the weekday varies, so open every day of week
    wide enough to cover 10:00 regardless of which one it lands on.
    Needed since create_hold now requires starts_at to be grid-aligned
    to an active schedule_template (see availability_service.is_slot_grid_aligned)."""
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))


def _future_starts_at(days_ahead: int = 1) -> str:
    target = date.today() + timedelta(days=days_ahead)
    return f"{target.isoformat()}T10:00:00+00:00"


async def test_hold_booking_computes_price_and_advance(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000001", role=UserRole.OWNER)
    customer = await make_user("+923004000002", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=1500, advance_percentage=50)
    headers = await make_auth_headers(customer)

    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": _future_starts_at()},
    )
    assert resp.status_code == 201
    body = resp.json()
    booking = body["booking"]
    assert booking["price"] == 1500.0
    assert booking["advance_amount"] == 750.0
    assert booking["balance_due"] == 750.0
    assert booking["status"] == "held"
    assert booking["held_until"] is not None
    assert body["payment_instructions"]["amount"] == 750.0


async def test_ends_at_computed_from_slot_minutes(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000003", role=UserRole.OWNER)
    customer = await make_user("+923004000004", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=90)
    # Schedule hours are PKT wall-clock (UTC-5); a 90-minute grid opening at
    # 15:00 PKT starts its first slot at exactly 10:00 UTC -- what
    # _future_starts_at() always returns -- so 10:00/11:30/13:00/... in UTC
    # terms does include it.
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(15, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    headers = await make_auth_headers(customer)

    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": _future_starts_at()},
    )
    booking = resp.json()["booking"]
    from datetime import datetime

    starts = datetime.fromisoformat(booking["starts_at"])
    ends = datetime.fromisoformat(booking["ends_at"])
    assert (ends - starts).total_seconds() == 90 * 60


async def test_hold_without_pricing_rule_rejected(
    client, make_user, make_venue, make_court, make_schedule, make_auth_headers
):
    owner = await make_user("+923004000005", role=UserRole.OWNER)
    customer = await make_user("+923004000006", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    headers = await make_auth_headers(customer)

    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": _future_starts_at()},
    )
    assert resp.status_code == 400


async def test_overlapping_hold_rejected(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000007", role=UserRole.OWNER)
    customer_a = await make_user("+923004000008", role=UserRole.PLAYER)
    customer_b = await make_user("+923004000009", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court)

    starts_at = _future_starts_at()
    headers_a = await make_auth_headers(customer_a)
    first = await client.post(
        "/api/v1/bookings/hold", headers=headers_a, json={"court_id": str(court.id), "starts_at": starts_at}
    )
    assert first.status_code == 201

    headers_b = await make_auth_headers(customer_b)
    second = await client.post(
        "/api/v1/bookings/hold", headers=headers_b, json={"court_id": str(court.id), "starts_at": starts_at}
    )
    assert second.status_code == 409


async def test_cancel_booking(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    owner = await make_user("+923004000010", role=UserRole.OWNER)
    customer = await make_user("+923004000011", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court)
    headers = await make_auth_headers(customer)

    created = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": _future_starts_at()},
    )
    booking_id = created.json()["booking"]["id"]

    resp = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel", headers=headers, json={"reason": "change of plans"}
    )
    assert resp.status_code == 200
    booking = resp.json()["booking"]
    assert booking["status"] == "cancelled"
    assert booking["cancelled_by"] == "player"


async def test_double_cancel_is_idempotent_noop(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """Calling cancel twice (e.g. a retried request) on an already-cancelled
    booking must be a safe no-op -- 200 with the same cancelled booking, not
    a 400, and it must not re-notify or re-wake the waitlist a second time."""
    pushed = []

    async def fake_push(self, token, title, body, data=None):
        pushed.append(token)

    monkeypatch.setattr("app.services.notification_service.NotificationService._push", fake_push)

    owner = await make_user("+923004000030", role=UserRole.OWNER)
    customer = await make_user("+923004000031", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court)
    headers = await make_auth_headers(customer)

    created = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": _future_starts_at()},
    )
    booking_id = created.json()["booking"]["id"]

    await client.post(
        "/api/v1/users/me/fcm-token", headers=headers, json={"token": "double-cancel-device-token"}
    )

    first = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel", headers=headers, json={"reason": "change of plans"}
    )
    assert first.status_code == 200
    assert first.json()["booking"]["status"] == "cancelled"
    first_push_count = len(pushed)

    second = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel", headers=headers, json={"reason": "change of plans"}
    )
    assert second.status_code == 200, second.text
    assert second.json()["booking"]["status"] == "cancelled"
    assert len(pushed) == first_push_count, "repeat cancel must not re-notify"


async def test_cannot_hold_in_the_past(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000012", role=UserRole.OWNER)
    customer = await make_user("+923004000013", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court)
    headers = await make_auth_headers(customer)

    yesterday = date.today() - timedelta(days=1)
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        json={"court_id": str(court.id), "starts_at": f"{yesterday.isoformat()}T10:00:00+00:00"},
    )
    assert resp.status_code == 400


async def test_player_can_only_cancel_own_booking(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000014", role=UserRole.OWNER)
    customer_a = await make_user("+923004000015", role=UserRole.PLAYER)
    customer_b = await make_user("+923004000016", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court)

    headers_a = await make_auth_headers(customer_a)
    created = await client.post(
        "/api/v1/bookings/hold",
        headers=headers_a,
        json={"court_id": str(court.id), "starts_at": _future_starts_at()},
    )
    booking_id = created.json()["booking"]["id"]

    headers_b = await make_auth_headers(customer_b)
    resp = await client.get(f"/api/v1/bookings/{booking_id}", headers=headers_b)
    assert resp.status_code == 403

    cancel_resp = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel", headers=headers_b, json={}
    )
    assert cancel_resp.status_code == 403


async def test_owner_can_cancel_any_booking_at_their_venue(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000017", role=UserRole.OWNER)
    customer = await make_user("+923004000018", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court)

    customer_headers = await make_auth_headers(customer)
    created = await client.post(
        "/api/v1/bookings/hold",
        headers=customer_headers,
        json={"court_id": str(court.id), "starts_at": _future_starts_at()},
    )
    booking_id = created.json()["booking"]["id"]

    owner_headers = await make_auth_headers(owner)
    resp = await client.post(f"/api/v1/bookings/{booking_id}/cancel", headers=owner_headers, json={})
    assert resp.status_code == 200
    assert resp.json()["booking"]["cancelled_by"] == "owner"


async def test_walkin_booking_is_booked_immediately(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000019", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)
    headers = await make_auth_headers(owner)

    resp = await client.post(
        "/api/v1/bookings/walkin",
        headers=headers,
        json={
            "court_id": str(court.id),
            "starts_at": _future_starts_at(),
            "player_name": "Ahmed Khan",
            "player_phone": "+923009999999",
            "amount_paid": 3000,
        },
    )
    assert resp.status_code == 201
    booking = resp.json()["booking"]
    assert booking["status"] == "booked"
    assert booking["source"] == "walkin"
    assert booking["player_id"] is None  # no matching registered user
    assert booking["amount_paid"] == 3000.0


async def test_walkin_links_existing_player_by_phone(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000020", role=UserRole.OWNER)
    existing_player = await make_user("+923004000021", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)
    headers = await make_auth_headers(owner)

    resp = await client.post(
        "/api/v1/bookings/walkin",
        headers=headers,
        json={
            "court_id": str(court.id),
            "starts_at": _future_starts_at(),
            "player_name": "Existing Player",
            "player_phone": existing_player.phone,
            "amount_paid": 3000,
        },
    )
    assert resp.status_code == 201
    assert resp.json()["booking"]["player_id"] == str(existing_player.id)


async def test_walkin_for_held_slot_conflicts(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000022", role=UserRole.OWNER)
    customer = await make_user("+923004000023", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=3000)

    starts_at = _future_starts_at()
    customer_headers = await make_auth_headers(customer)
    await client.post(
        "/api/v1/bookings/hold", headers=customer_headers, json={"court_id": str(court.id), "starts_at": starts_at}
    )

    owner_headers = await make_auth_headers(owner)
    resp = await client.post(
        "/api/v1/bookings/walkin",
        headers=owner_headers,
        json={
            "court_id": str(court.id),
            "starts_at": starts_at,
            "player_name": "Walk-in",
            "amount_paid": 3000,
        },
    )
    assert resp.status_code == 409


async def test_source_tracking(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers):
    owner = await make_user("+923004000024", role=UserRole.OWNER)
    customer = await make_user("+923004000025", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=1000)

    customer_headers = await make_auth_headers(customer)
    app_booking = await client.post(
        "/api/v1/bookings/hold",
        headers=customer_headers,
        json={"court_id": str(court.id), "starts_at": _future_starts_at()},
    )
    assert app_booking.json()["booking"]["source"] == "app"

    owner_headers = await make_auth_headers(owner)
    walkin_booking = await client.post(
        "/api/v1/bookings/walkin",
        headers=owner_headers,
        json={
            "court_id": str(court.id),
            "starts_at": _future_starts_at(days_ahead=2),
            "player_name": "Walk-in",
            "amount_paid": 1000,
        },
    )
    assert walkin_booking.json()["booking"]["source"] == "walkin"


async def test_checkin_completes_booked_slot(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000026", role=UserRole.OWNER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=1000)
    headers = await make_auth_headers(owner)

    walkin = await client.post(
        "/api/v1/bookings/walkin",
        headers=headers,
        json={
            "court_id": str(court.id),
            "starts_at": _future_starts_at(),
            "player_name": "Walk-in",
            "amount_paid": 1000,
        },
    )
    booking_id = walkin.json()["booking"]["id"]

    resp = await client.post(f"/api/v1/bookings/{booking_id}/checkin", headers=headers)
    assert resp.status_code == 200
    booking = resp.json()["booking"]
    assert booking["status"] == "completed"
    assert booking["checked_in_at"] is not None


async def test_checkin_rejects_unconfirmed_booking(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000027", role=UserRole.OWNER)
    customer = await make_user("+923004000028", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court)

    customer_headers = await make_auth_headers(customer)
    created = await client.post(
        "/api/v1/bookings/hold",
        headers=customer_headers,
        json={"court_id": str(court.id), "starts_at": _future_starts_at()},
    )
    booking_id = created.json()["booking"]["id"]

    owner_headers = await make_auth_headers(owner)
    resp = await client.post(f"/api/v1/bookings/{booking_id}/checkin", headers=owner_headers)
    assert resp.status_code == 400


async def test_player_self_checkin_via_venue_qr_sets_checked_in_at(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """Alternative to the owner-scan checkin: a player scans a QR physically
    posted at the venue. See finding #17 in AUDIT_FINDINGS.md."""
    owner = await make_user("+923004000029", role=UserRole.OWNER)
    customer = await make_user("+923004000030", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=1000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    walkin = await client.post(
        "/api/v1/bookings/walkin",
        headers=owner_headers,
        json={
            "court_id": str(court.id),
            "starts_at": _future_starts_at(),
            "player_name": "Self Checkin Player",
            "player_phone": customer.phone,
            "amount_paid": 1000,
        },
    )
    booking_id = walkin.json()["booking"]["id"]

    checkin = await client.post(
        f"/api/v1/bookings/{booking_id}/checkin/self",
        headers=customer_headers,
        json={"venue_qr_token": str(venue.checkin_qr_token)},
    )
    assert checkin.status_code == 200, checkin.text
    body = checkin.json()["booking"]
    assert body["status"] == "completed"
    assert body["checked_in_at"] is not None
    assert body["checked_in_by"] == "player"


async def test_self_checkin_rejects_wrong_venue_token(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923004000031", role=UserRole.OWNER)
    customer = await make_user("+923004000032", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=1000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    walkin = await client.post(
        "/api/v1/bookings/walkin",
        headers=owner_headers,
        json={
            "court_id": str(court.id),
            "starts_at": _future_starts_at(),
            "player_name": "Self Checkin Player",
            "player_phone": customer.phone,
            "amount_paid": 1000,
        },
    )
    booking_id = walkin.json()["booking"]["id"]

    import uuid as uuid_module

    checkin = await client.post(
        f"/api/v1/bookings/{booking_id}/checkin/self",
        headers=customer_headers,
        json={"venue_qr_token": str(uuid_module.uuid4())},
    )
    assert checkin.status_code == 400
    assert checkin.json()["error"]["code"] == "INVALID_CHECKIN_CODE"


async def test_owner_marks_no_show_after_the_grace_window(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923004000033", role=UserRole.OWNER)
    customer = await make_user("+923004000034", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    owner_headers = await make_auth_headers(owner)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) - timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) - timedelta(hours=1),
            price=1000,
            status=BookingStatus.BOOKED,
        )
        session.add(booking)
        await session.commit()
        booking_id = booking.id

    resp = await client.post(f"/api/v1/bookings/{booking_id}/no-show", headers=owner_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()["booking"]
    assert body["status"] == "no_show"

    async with db_session_factory() as session:
        player = await session.get(type(customer), customer.id)
        assert player.total_no_shows == 1


async def test_owner_cannot_mark_no_show_before_the_grace_window(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923004000035", role=UserRole.OWNER)
    customer = await make_user("+923004000036", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    owner_headers = await make_auth_headers(owner)

    async with db_session_factory() as session:
        # Started 5 minutes ago -- well inside the default 60-minute grace window.
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            ends_at=datetime.now(timezone.utc) + timedelta(minutes=55),
            price=1000,
            status=BookingStatus.BOOKED,
        )
        session.add(booking)
        await session.commit()
        booking_id = booking.id

    resp = await client.post(f"/api/v1/bookings/{booking_id}/no-show", headers=owner_headers)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "TOO_EARLY_FOR_NO_SHOW"


async def test_owner_cannot_mark_no_show_on_a_checked_in_booking(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923004000037", role=UserRole.OWNER)
    customer = await make_user("+923004000038", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    owner_headers = await make_auth_headers(owner)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) - timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) - timedelta(hours=1),
            price=1000,
            status=BookingStatus.COMPLETED,
            checked_in_at=datetime.now(timezone.utc) - timedelta(hours=2),
        )
        session.add(booking)
        await session.commit()
        booking_id = booking.id

    resp = await client.post(f"/api/v1/bookings/{booking_id}/no-show", headers=owner_headers)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_BOOKING_STATE"


async def test_a_different_owner_cannot_mark_no_show(
    client, db_session_factory, make_user, make_venue, make_court, make_auth_headers
):
    owner = await make_user("+923004000039", role=UserRole.OWNER)
    other_owner = await make_user("+923004000040", role=UserRole.OWNER)
    customer = await make_user("+923004000047", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    other_headers = await make_auth_headers(other_owner)

    async with db_session_factory() as session:
        booking = Booking(
            court_id=court.id,
            player_id=customer.id,
            starts_at=datetime.now(timezone.utc) - timedelta(hours=2),
            ends_at=datetime.now(timezone.utc) - timedelta(hours=1),
            price=1000,
            status=BookingStatus.BOOKED,
        )
        session.add(booking)
        await session.commit()
        booking_id = booking.id

    resp = await client.post(f"/api/v1/bookings/{booking_id}/no-show", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "NOT_YOUR_BOOKING"


async def test_self_checkin_and_owner_checkin_are_mutually_idempotent(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """Whichever check-in path happens first wins; the second attempt via
    the other path must be a safe no-op, not an error."""
    owner = await make_user("+923004000033", role=UserRole.OWNER)
    customer = await make_user("+923004000034", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=1000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)

    walkin = await client.post(
        "/api/v1/bookings/walkin",
        headers=owner_headers,
        json={
            "court_id": str(court.id),
            "starts_at": _future_starts_at(),
            "player_name": "Idempotent Player",
            "player_phone": customer.phone,
            "amount_paid": 1000,
        },
    )
    booking_id = walkin.json()["booking"]["id"]

    owner_first = await client.post(f"/api/v1/bookings/{booking_id}/checkin", headers=owner_headers)
    assert owner_first.status_code == 200
    assert owner_first.json()["booking"]["checked_in_by"] == "owner"
    first_checked_in_at = owner_first.json()["booking"]["checked_in_at"]

    # Player attempts self-checkin second -- must be a no-op, not an error,
    # and must not overwrite who actually checked the booking in.
    player_second = await client.post(
        f"/api/v1/bookings/{booking_id}/checkin/self",
        headers=customer_headers,
        json={"venue_qr_token": str(venue.checkin_qr_token)},
    )
    assert player_second.status_code == 200, player_second.text
    body = player_second.json()["booking"]
    assert body["checked_in_by"] == "owner"
    assert body["checked_in_at"] == first_checked_in_at


async def test_implausibly_timed_checkin_flagged_for_admin_not_blocked(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """A check-in far outside the booking's own window is a signal for an
    admin to spot-check, not a reason to reject it -- see finding #17."""
    admin = await make_user("+923004000035", role=UserRole.ADMIN)
    owner = await make_user("+923004000036", role=UserRole.OWNER)
    customer = await make_user("+923004000037", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court, price_per_slot=1000)
    owner_headers = await make_auth_headers(owner)
    customer_headers = await make_auth_headers(customer)
    admin_headers = await make_auth_headers(admin)

    # A booking starting several days from now -- checking in "now" is
    # implausibly early relative to its window.
    far_future = _future_starts_at(days_ahead=5)
    walkin = await client.post(
        "/api/v1/bookings/walkin",
        headers=owner_headers,
        json={
            "court_id": str(court.id),
            "starts_at": far_future,
            "player_name": "Early Checkin Player",
            "player_phone": customer.phone,
            "amount_paid": 1000,
        },
    )
    booking_id = walkin.json()["booking"]["id"]

    checkin = await client.post(
        f"/api/v1/bookings/{booking_id}/checkin/self",
        headers=customer_headers,
        json={"venue_qr_token": str(venue.checkin_qr_token)},
    )
    # Not blocked -- still succeeds.
    assert checkin.status_code == 200, checkin.text
    assert checkin.json()["booking"]["checked_in_at"] is not None

    flagged = await client.get("/api/v1/admin/disputes/flagged-checkins", headers=admin_headers)
    assert flagged.status_code == 200
    booking_ids = {row["booking_id"] for row in flagged.json()}
    assert booking_id in booking_ids
    row = next(r for r in flagged.json() if r["booking_id"] == booking_id)
    assert row["flag_reason"] == "implausible_timing"


async def test_naive_datetime_in_hold_request_returns_clean_400_not_500(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    """Pydantic v2 accepts an ISO datetime with no UTC offset as naive;
    comparing that against BookingService.create_hold's timezone-aware
    datetime.now() used to raise an uncaught TypeError (a raw 500). See
    finding #26 in AUDIT_FINDINGS.md -- confirmed reproducing before this
    fix, via a direct pytest repro against the real endpoint."""
    owner = await make_user("+923004000038", role=UserRole.OWNER)
    customer = await make_user("+923004000039", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court)
    headers = await make_auth_headers(customer)

    target = date.today() + timedelta(days=1)
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=headers,
        # No trailing Z / UTC offset -- naive per Pydantic's parsing.
        json={"court_id": str(court.id), "starts_at": f"{target.isoformat()}T10:00:00"},
    )
    assert resp.status_code != 500
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_create_hold_rejects_naive_datetime_from_non_http_callers(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """The HTTP endpoint's Pydantic schema catches a naive starts_at before
    it ever reaches BookingService.create_hold, but two other call sites
    build starts_at straight from datetime.fromisoformat() with no such
    validation -- the AI chat's hold_slot tool and the WhatsApp
    button-reply handler (both call create_hold directly). This exercises
    create_hold's own defensive guard directly, the safety net for both of
    those paths."""
    from datetime import date as date_cls
    from datetime import datetime, timedelta

    from app.config import get_settings
    from app.errors import ErrorCode
    from app.services.booking_service import BookingService

    owner = await make_user("+923004000040", role=UserRole.OWNER)
    customer = await make_user("+923004000041", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    await _open_all_week(make_schedule, court)
    await make_pricing_rule(court)

    target = date_cls.today() + timedelta(days=1)
    naive_starts_at = datetime.fromisoformat(f"{target.isoformat()}T10:00:00")  # no offset -> naive
    assert naive_starts_at.tzinfo is None

    service = BookingService(db_session, get_settings())
    try:
        await service.create_hold(customer, court.id, naive_starts_at)
        assert False, "expected AppError for a naive starts_at"
    except Exception as exc:
        assert getattr(exc, "code", None) == ErrorCode.VALIDATION_ERROR
        assert getattr(exc, "status_code", None) == 400
