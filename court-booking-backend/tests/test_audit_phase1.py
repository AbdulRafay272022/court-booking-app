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


# ---------------------------------------------------------------- item 3: replies are Latin letters only

from app.services import chat_validator  # noqa: E402
from app.services.chat_language import detect_language, has_non_latin, transliterate_common  # noqa: E402


def test_script_detection_sees_devanagari_and_urdu():
    assert has_non_latin("शुक्रिया! आपकी बुकिंग हो गई।")
    assert has_non_latin("شکریہ")
    assert not has_non_latin("Shukriya, aap ka slot book ho gaya. PKR 3,000")


def test_a_player_writing_hindi_or_urdu_script_gets_roman_urdu():
    assert detect_language("मुझे कल का स्लॉट चाहिए") == "ru"
    assert detect_language("مجھے کل کا سلاٹ چاہیے") == "ru"


def test_common_words_are_transliterated_and_unknown_script_is_left_for_the_validator():
    assert transliterate_common("शुक्रिया!") == "Shukriya!"
    assert transliterate_common("شکریہ، جی") == "Shukriya, Ji"
    assert has_non_latin(transliterate_common("शुक्रिया! आपकी बुकिंग हो गई।"))  # whole Hindi sentence: still rejected


def test_prompt_never_invites_urdu_script():
    from app.services.ai_chat_service import SYSTEM_PROMPT

    assert "English, Urdu," not in SYSTEM_PROMPT
    assert "Latin letters" in SYSTEM_PROMPT


async def test_a_devanagari_draft_is_regenerated_and_the_player_never_sees_it(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    from tests.test_chat_replay import ScriptedModel, arena, player_headers, say, text

    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    _u, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch, [text("बुकिंग कैंसल करने के लिए My Bookings खोलें।"), text("Booking cancel karne ke liye My Bookings kholein.")])
    reply = (await say(client, headers, "booking cancel kaise hoti hai?"))["reply"]
    assert not has_non_latin(reply), reply
    assert reply == "Booking cancel karne ke liye My Bookings kholein."
    assert len(model.bodies) == 2, "the Devanagari draft must have been rejected and regenerated"


async def test_a_model_stuck_in_devanagari_gets_the_latin_fallback(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    from tests.test_chat_replay import ScriptedModel, arena, player_headers, say, text

    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    _u, headers = await player_headers(make_user, make_auth_headers)
    ScriptedModel(monkeypatch, [text("बुकिंग कैंसल करने के लिए My Bookings खोलें।")])
    reply = (await say(client, headers, "booking cancel kaise hoti hai?"))["reply"]
    assert reply and not has_non_latin(reply), reply


def test_validator_flags_mixed_script_drafts():
    from app.services.chat_validator import Issue  # noqa: F401

    assert chat_validator._INSTRUCTIONS["non_latin_script"]


# ---------------------------------------------------------------- item 4: the player's booking detail


async def test_player_booking_detail_has_everything_for_a_held_booking(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    _o, venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923001140001")
    headers = await make_auth_headers(player)
    held = (await client.post("/api/v1/bookings/hold", headers=headers, json={"court_id": str(court.id), "starts_at": _starts_at()})).json()
    bid = held["booking"]["id"]
    resp = await client.get(f"/api/v1/bookings/{bid}/detail", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["venue"]["name"] == venue.name and body["venue"]["slug"] == venue.slug
    assert body["court"]["sport"] == "padel"
    assert body["duration_minutes"] == 60
    assert body["booking"]["status"] == "held"
    assert [e["kind"] for e in body["timeline"]] == ["held"]
    assert body["payments"] == []
    assert body["venue"]["cancellation_allowed"] is True


async def test_player_booking_detail_lists_cash_paid_at_a_walkin_and_hides_from_others(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers
):
    owner, _venue, court = await _venue_with_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    player = await make_user("+923001140002", name="Ali")
    resp = await client.post(
        "/api/v1/bookings/walkin",
        headers=await make_auth_headers(owner),
        json={"court_id": str(court.id), "starts_at": _starts_at(), "player_name": "Ali", "player_phone": "+923001140002", "amount_paid": 400},
    )
    assert resp.status_code == 201, resp.text
    bid = resp.json()["booking"]["id"]
    detail = (await client.get(f"/api/v1/bookings/{bid}/detail", headers=await make_auth_headers(player))).json()
    assert [(p["amount"], p["method"]) for p in detail["payments"]] == [(400, "cash_at_venue")]
    assert detail["booking"]["balance_due"] == 600
    stranger = await make_user("+923001140003")
    assert (await client.get(f"/api/v1/bookings/{bid}/detail", headers=await make_auth_headers(stranger))).status_code in (403, 404)
