"""Audit build 2026-10-28, Phase 1 (no migration). One section per item; see docs/audit-build-progress.md."""

from app.services.auth_service import AuthService


# ---------------------------------------------------------------- item 1: /auth/me never 500s


async def test_auth_me_is_401_when_the_session_rotates_between_lookups(client, make_user, make_auth_headers, monkeypatch):
    """CurrentUser resolved the token, then a parallel refresh revoked the session before get_me's own lookup."""
    user = await make_user("+923001110001")
    headers = await make_auth_headers(user)

    async def _gone(self, token):
        return None

    async def _user(self, token):
        return user

    monkeypatch.setattr(AuthService, "get_user_from_token", _user)
    monkeypatch.setattr(AuthService, "get_session_from_token", _gone)
    resp = await client.get("/api/v1/auth/me", headers=headers)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "SESSION_EXPIRED"


async def test_auth_me_still_works(client, make_user, make_auth_headers):
    user = await make_user("+923001110002")
    resp = await client.get("/api/v1/auth/me", headers=await make_auth_headers(user))
    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == str(user.id)


# ---------------------------------------------------------------- item 2: hidden venues stay hidden

from datetime import date, time, timedelta  # noqa: E402

from app.models.user import UserRole  # noqa: E402
from app.models.venue import VenueStatus  # noqa: E402


def _starts_at() -> str:
    return f"{(date.today() + timedelta(days=3)).isoformat()}T10:00:00Z"


async def _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, **venue_kwargs):
    owner = await make_user("+923001120001", role=UserRole.OWNER)
    venue = await make_venue(owner, **venue_kwargs)
    court = await make_court(venue)
    for day in range(7):
        await make_schedule(court, day_of_week=day, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court)
    return owner, venue, court


async def test_pending_venue_page_is_404_for_players_but_open_for_its_owner(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, _court = await _venue_with_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, status=VenueStatus.PENDING
    )
    player = await make_user("+923001120002")
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}")).status_code == 404
    assert (await client.get(f"/api/v1/venues/{venue.id}", headers=await make_auth_headers(player))).status_code == 404
    mine = await client.get(f"/api/v1/venues/{venue.id}", headers=await make_auth_headers(owner))
    assert mine.status_code == 200
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}", headers=await make_auth_headers(owner))).status_code == 200


async def test_deleted_or_rejected_venue_slots_and_quote_are_hidden(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, venue, court = await _venue_with_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, is_active=False
    )
    day = (date.today() + timedelta(days=3)).isoformat()
    month = day[:7]
    for url in (
        f"/api/v1/courts/{court.id}/availability?date={day}",
        f"/api/v1/venues/{venue.id}/availability?date={day}",
        f"/api/v1/courts/{court.id}/quote?starts_at={_starts_at()}",
        f"/api/v1/courts/{court.id}/availability/summary?month={month}",
    ):
        resp = await client.get(url)
        assert resp.status_code == 404, url
        assert resp.json()["error"]["code"] == "VENUE_NOT_FOUND", url
    # the owner keeps their walk-in grid
    owner_headers = await make_auth_headers(owner)
    assert (await client.get(f"/api/v1/courts/{court.id}/availability?date={day}", headers=owner_headers)).status_code == 200


async def test_rejected_venue_is_hidden(client, make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    _o, venue, _c = await _venue_with_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, status=VenueStatus.REJECTED
    )
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}")).status_code == 404


async def test_soft_deleted_venue_cannot_be_held_by_court_id(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _owner, _venue, court = await _venue_with_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, is_active=False
    )
    player = await make_user("+923001120003")
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=await make_auth_headers(player),
        json={"court_id": str(court.id), "starts_at": _starts_at()},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VENUE_NOT_APPROVED"


async def test_live_venue_still_opens_and_holds(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _owner, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    assert (await client.get(f"/api/v1/venues/by-slug/{venue.slug}")).status_code == 200
    player = await make_user("+923001120004")
    resp = await client.post(
        "/api/v1/bookings/hold",
        headers=await make_auth_headers(player),
        json={"court_id": str(court.id), "starts_at": _starts_at()},
    )
    assert resp.status_code == 201


async def test_ai_tools_do_not_describe_hidden_venues(db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    from app.config import get_settings
    from app.services.ai_chat_service import AIChatService

    _o, venue, court = await _venue_with_court(
        make_user, make_venue, make_court, make_schedule, make_pricing_rule, status=VenueStatus.PENDING
    )
    svc = AIChatService(db_session, get_settings())
    assert "error" in await svc._tool_get_venue_info({"venue_id": str(venue.id)})
    assert "error" in await svc._tool_get_venue_courts({"venue_id": str(venue.id)})
    out = await svc._tool_check_availability({"court_id": str(court.id), "date": (date.today() + timedelta(days=3)).isoformat()})
    assert "error" in out
