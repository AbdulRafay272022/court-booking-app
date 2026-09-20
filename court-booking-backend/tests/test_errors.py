from datetime import date, time, timedelta

from app.config import get_settings
from app.errors import ErrorCode
from app.main import create_app
from app.models.blackout import Blackout
from app.models.user import UserRole
from app.models.venue import VenueStatus


def test_startup_fails_with_wildcard_cors_in_production(monkeypatch):
    """ALLOWED_ORIGINS=['*'] + allow_credentials=True is valid CORS (browsers
    just won't honor the wildcard for credentialed requests), but it's
    reduced defense-in-depth that should never ship to production by
    accident -- see finding #10 in AUDIT_FINDINGS.md."""
    settings = get_settings()
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", ["*"])

    try:
        create_app()
        assert False, "create_app() should have raised with wildcard CORS + DEBUG=false"
    except RuntimeError as exc:
        assert "ALLOWED_ORIGINS" in str(exc)


def test_startup_succeeds_with_explicit_origins_in_production(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", ["https://app.example.com"])

    create_app()  # must not raise


def test_startup_allows_wildcard_cors_in_debug(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", ["*"])

    create_app()  # must not raise -- local dev convenience


async def test_error_envelope_shape_on_404(client, make_user, make_auth_headers):
    player = await make_user("+923012000001", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    import uuid

    resp = await client.get(f"/api/v1/bookings/{uuid.uuid4()}", headers=headers)
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == ErrorCode.BOOKING_NOT_FOUND
    assert "message" in body["error"]
    assert body["error"]["details"] == {}


async def test_error_envelope_on_validation_error(client):
    resp = await client.post("/api/v1/auth/request-otp", json={})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == ErrorCode.VALIDATION_ERROR
    assert "errors" in body["error"]["details"]


async def test_forbidden_role_guard_uses_error_envelope(client, make_user, make_auth_headers):
    player = await make_user("+923012000002", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    resp = await client.get("/api/v1/admin/stats", headers=headers)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == ErrorCode.FORBIDDEN


async def test_slot_already_taken_error_code(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923012000003", role=UserRole.OWNER)
    player_a = await make_user("+923012000004", role=UserRole.PLAYER)
    player_b = await make_user("+923012000005", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)

    starts_at = f"{(date.today() + timedelta(days=1)).isoformat()}T10:00:00+00:00"
    headers_a = await make_auth_headers(player_a)
    headers_b = await make_auth_headers(player_b)

    first = await client.post(
        "/api/v1/bookings/hold", headers=headers_a, json={"court_id": str(court.id), "starts_at": starts_at}
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/v1/bookings/hold", headers=headers_b, json={"court_id": str(court.id), "starts_at": starts_at}
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == ErrorCode.SLOT_ALREADY_TAKEN


async def test_slot_in_past_error_code(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923012000006", role=UserRole.OWNER)
    player = await make_user("+923012000007", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    headers = await make_auth_headers(player)

    past = f"{(date.today() - timedelta(days=1)).isoformat()}T10:00:00+00:00"
    resp = await client.post(
        "/api/v1/bookings/hold", headers=headers, json={"court_id": str(court.id), "starts_at": past}
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == ErrorCode.SLOT_IN_PAST


async def test_slot_blocked_by_blackout_error_code(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923012000008", role=UserRole.OWNER)
    player = await make_user("+923012000009", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    headers = await make_auth_headers(player)

    starts_at_dt_str = f"{(date.today() + timedelta(days=1)).isoformat()}T10:00:00+00:00"
    from datetime import datetime

    starts_at = datetime.fromisoformat(starts_at_dt_str)
    async with db_session_factory() as session:
        session.add(
            Blackout(court_id=court.id, starts_at=starts_at, ends_at=starts_at + timedelta(hours=2), reason="maintenance")
        )
        await session.commit()

    resp = await client.post(
        "/api/v1/bookings/hold", headers=headers, json={"court_id": str(court.id), "starts_at": starts_at_dt_str}
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == ErrorCode.SLOT_BLOCKED


async def test_venue_not_approved_blocks_booking(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923012000010", role=UserRole.OWNER)
    player = await make_user("+923012000011", role=UserRole.PLAYER)
    venue = await make_venue(owner, status=VenueStatus.PENDING)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    headers = await make_auth_headers(player)

    starts_at = f"{(date.today() + timedelta(days=1)).isoformat()}T10:00:00+00:00"
    resp = await client.post(
        "/api/v1/bookings/hold", headers=headers, json={"court_id": str(court.id), "starts_at": starts_at}
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == ErrorCode.VENUE_NOT_APPROVED


async def test_not_your_booking_error_code(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner = await make_user("+923012000012", role=UserRole.OWNER)
    player_a = await make_user("+923012000013", role=UserRole.PLAYER)
    player_b = await make_user("+923012000014", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)

    starts_at = f"{(date.today() + timedelta(days=1)).isoformat()}T10:00:00+00:00"
    headers_a = await make_auth_headers(player_a)
    headers_b = await make_auth_headers(player_b)

    booking = await client.post(
        "/api/v1/bookings/hold", headers=headers_a, json={"court_id": str(court.id), "starts_at": starts_at}
    )
    booking_id = booking.json()["booking"]["id"]

    resp = await client.get(f"/api/v1/bookings/{booking_id}", headers=headers_b)
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == ErrorCode.NOT_YOUR_BOOKING


async def test_invalid_otp_error_code(client, monkeypatch):
    async def fake_send(self, payload):
        return {"messages": [{"id": "x"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", fake_send)

    phone = "+923012000015"
    await client.post(
        "/api/v1/auth/signup",
        json={
            "name": "Test User", "email": "t@example.com", "phone": phone, "city": "lahore",
            "gender": "male", "password": "longenough-1", "confirm_password": "longenough-1",
        },
    )
    resp = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": phone, "otp": "000000"})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == ErrorCode.INVALID_OTP


async def test_otp_expired_error_code(client):
    resp = await client.post("/api/v1/auth/verify-signup-otp", json={"phone": "+923012000016", "otp": "123456"})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == ErrorCode.OTP_EXPIRED


async def test_request_id_header_present_and_echoed(client):
    resp = await client.get("/health")
    assert "x-request-id" in resp.headers

    resp2 = await client.get("/health", headers={"X-Request-ID": "my-custom-id"})
    assert resp2.headers["x-request-id"] == "my-custom-id"


async def test_rate_limit_returns_429_with_error_envelope(db_session_factory, monkeypatch):
    from httpx import ASGITransport, AsyncClient

    from app.database import get_db

    settings = get_settings()
    monkeypatch.setattr(settings, "RATE_LIMIT_PER_MINUTE", 3)

    application = create_app()

    async def _get_db_override():
        async with db_session_factory() as session:
            yield session

    application.dependency_overrides[get_db] = _get_db_override

    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        statuses = [(await ac.get("/api/v1/venues")).status_code for _ in range(5)]

    assert statuses.count(429) >= 1
    assert statuses[:3] == [200, 200, 200]
