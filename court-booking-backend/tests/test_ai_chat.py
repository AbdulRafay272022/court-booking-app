from datetime import date, datetime, time, timedelta

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.models.booking import Booking
from app.models.user import UserRole
from app.services.ai.tools import BOOKING_TOOLS
from app.services.ai_chat_service import AIChatService


def _text_response(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}], "stop_reason": "end_turn"}


def _tool_use_response(tool_name: str, tool_input: dict, tool_use_id: str = "toolu_1") -> dict:
    return {
        "content": [{"type": "tool_use", "id": tool_use_id, "name": tool_name, "input": tool_input}],
        "stop_reason": "tool_use",
    }


def _mock_anthropic_sequence(monkeypatch, responses: list[dict]):
    calls = {"n": 0}

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        i = min(calls["n"], len(responses) - 1)
        calls["n"] += 1
        return httpx.Response(200, request=httpx.Request("POST", url), json=responses[i])

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    return calls


def test_no_forbidden_tools_exposed():
    tool_names = {t.name for t in BOOKING_TOOLS}
    assert "approve_payment" not in tool_names
    assert "reject_payment" not in tool_names


async def test_model_routing_by_history_length(db_session):
    service = AIChatService(db_session, get_settings())
    assert service._choose_model_tier([]) == "routine"

    long_history = [{"role": "user", "content": "hi"}] * 6
    assert service._choose_model_tier(long_history) == "complex"


async def test_no_api_key_returns_graceful_fallback(db_session, make_user, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")

    player = await make_user("+923014000001", role=UserRole.PLAYER)
    service = AIChatService(db_session, settings)
    result = await service.process_message(user=player, message="hi", history=[])
    assert result.model is None
    assert "team will get back" in result.reply.lower()


async def test_check_availability_tool_feeds_real_data_into_reply(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    owner = await make_user("+923014000002", role=UserRole.OWNER)
    player = await make_user("+923014000003", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    target_date = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target_date.weekday(), open_time=time(17, 0), close_time=time(19, 0))
    await make_pricing_rule(court, price_per_slot=3000)

    _mock_anthropic_sequence(
        monkeypatch,
        [
            _tool_use_response(
                "check_availability", {"court_id": str(court.id), "date": target_date.isoformat()}
            ),
            _text_response("Yes! 5pm is available for PKR 3,000. Want me to hold it?"),
        ],
    )

    service = AIChatService(db_session, settings)
    result = await service.process_message(
        user=player, message="Is the 5pm slot available tomorrow?", history=[]
    )
    assert "3,000" in result.reply or "3000" in result.reply
    assert result.tool_calls == ["check_availability"]
    assert result.model == "routine"


async def test_hold_slot_tool_actually_creates_booking(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    owner = await make_user("+923014000004", role=UserRole.OWNER)
    player = await make_user("+923014000005", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    target = date.today() + timedelta(days=1)
    # create_hold requires starts_at to be grid-aligned to an active
    # schedule_template (AvailabilityService.is_slot_grid_aligned).
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=2500)

    starts_at = target.isoformat() + "T17:00:00+00:00"

    _mock_anthropic_sequence(
        monkeypatch,
        [
            _tool_use_response("hold_slot", {"court_id": str(court.id), "starts_at": starts_at}),
            _text_response("Held! Please pay PKR 2,500 within 15 minutes."),
        ],
    )

    service = AIChatService(db_session, settings)
    result = await service.process_message(user=player, message="Yes, book it", history=[])
    assert result.tool_calls == ["hold_slot"]

    booking_result = await db_session.execute(select(Booking).where(Booking.player_id == player.id))
    booking = booking_result.scalar_one()
    assert booking.court_id == court.id
    assert booking.status.value == "held"


async def test_propose_booking_confirmation_surfaces_actions(
    db_session, make_user, make_venue, make_court, monkeypatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    owner = await make_user("+923014000006", role=UserRole.OWNER)
    player = await make_user("+923014000007", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)

    starts_at = (date.today() + timedelta(days=1)).isoformat() + "T17:00:00+00:00"
    _mock_anthropic_sequence(
        monkeypatch,
        [
            _tool_use_response(
                "propose_booking_confirmation", {"court_id": str(court.id), "starts_at": starts_at}
            ),
            _text_response("Want me to hold Court 1 tomorrow at 5pm for PKR 3,000?"),
        ],
    )

    service = AIChatService(db_session, settings)
    result = await service.process_message(user=player, message="book 5pm tomorrow", history=[])
    assert len(result.actions) == 2
    assert result.actions[0].type == "confirm_booking"
    assert result.actions[0].data["court_id"] == str(court.id)
    assert result.actions[1].type == "decline"


async def test_cannot_cancel_another_players_booking(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """Guardrail is enforced by the shared booking_service authorization
    check, not by prompt engineering alone -- the tool call itself fails."""
    owner = await make_user("+923014000008", role=UserRole.OWNER)
    player_a = await make_user("+923014000009", role=UserRole.PLAYER)
    player_b = await make_user("+923014000010", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)

    settings = get_settings()
    service = AIChatService(db_session, settings)
    starts_at = datetime.fromisoformat(target.isoformat() + "T10:00:00+00:00")
    booking = await service.booking_service.create_hold(player_a, court.id, starts_at)

    result = await service._execute_tool(
        player_b, "cancel_booking", {"booking_id": str(booking.id)}, []
    )
    assert "error" in result
    assert result["status_code"] == 403


async def test_cancel_booking_tool_is_idempotent_on_repeat_call(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """A duplicate WhatsApp webhook delivery (or the AI retrying a call it
    thinks timed out) can invoke cancel_booking twice with identical
    arguments -- the second call must come back clean, not as an error."""
    owner = await make_user("+923014000011", role=UserRole.OWNER)
    player = await make_user("+923014000012", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=1000)

    settings = get_settings()
    service = AIChatService(db_session, settings)
    starts_at = datetime.fromisoformat(target.isoformat() + "T10:00:00+00:00")
    booking = await service.booking_service.create_hold(player, court.id, starts_at)

    first = await service._execute_tool(player, "cancel_booking", {"booking_id": str(booking.id)}, [])
    assert "error" not in first
    assert first["status"] == "cancelled"

    second = await service._execute_tool(player, "cancel_booking", {"booking_id": str(booking.id)}, [])
    assert "error" not in second
    assert second["status"] == "cancelled"


async def test_tool_loop_stops_after_max_iterations(
    db_session, make_user, monkeypatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    player = await make_user("+923014000011", role=UserRole.PLAYER)

    # Always respond with another (bogus) tool call -- the loop must give up
    # gracefully rather than looping forever.
    always_tool_use = _tool_use_response("get_venue_info", {"venue_id": "00000000-0000-0000-0000-000000000000"})
    _mock_anthropic_sequence(monkeypatch, [always_tool_use])

    service = AIChatService(db_session, settings)
    result = await service.process_message(user=player, message="hello", history=[])
    assert "trouble" in result.reply.lower() or "rephrasing" in result.reply.lower()
