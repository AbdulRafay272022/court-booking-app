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
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    owner = await make_user("+923014000006", role=UserRole.OWNER)
    player = await make_user("+923014000007", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    target = date.today() + timedelta(days=1)
    # A confirmation may only be proposed for a REAL available slot (see the tests below), so the
    # court needs a schedule: 17:00 UTC is 22:00 PKT, inside 06:00-23:00 PKT.
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3000)

    starts_at = target.isoformat() + "T17:00:00+00:00"
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


async def test_propose_confirmation_rejects_a_time_that_is_not_an_available_slot(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """Production chat 2026-09-20: the model 'proposed' 10:30 PM - 12:00 AM (a block that isn't on the
    court's grid) and re-proposed a different date each turn. It may now only propose a real slot;
    otherwise it gets an error telling it to call check_availability, and NO buttons are shown."""
    owner = await make_user("+923014000030", role=UserRole.OWNER)
    player = await make_user("+923014000031", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=90)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3500)
    service = AIChatService(db_session, get_settings())

    for bad in (
        target.isoformat() + "T17:30:00+00:00",  # 22:30 PKT: off the 06:00 + 90min grid
        target.isoformat() + "T17:00:00",  # no timezone
        "not-a-date",
    ):
        actions = []
        result = await service._execute_tool(
            player, "propose_booking_confirmation", {"court_id": str(court.id), "starts_at": bad}, actions
        )
        assert "error" in result, bad
        assert actions == [], bad

    actions = []
    good = await service._execute_tool(
        player,
        "propose_booking_confirmation",
        {"court_id": str(court.id), "starts_at": target.isoformat() + "T16:00:00+00:00"},  # 21:00 PKT
        actions,
    )
    assert good["ok"] is True
    assert good["label"].endswith("9:00 PM - 10:30 PM")
    assert [a.type for a in actions] == ["confirm_booking", "decline"]


async def test_check_availability_speaks_pakistan_time_and_shows_late_slots(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """The tool hands the model ready-made PKT labels (no UTC to mis-convert -- the 'Utu' players saw),
    and no longer truncates at 15 slots, which hid the evening slots of a 60-minute court."""
    owner = await make_user("+923014000032", role=UserRole.OWNER)
    player = await make_user("+923014000033", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=2000)
    service = AIChatService(db_session, get_settings())

    result = await service._execute_tool(
        player, "check_availability", {"court_id": str(court.id), "date": target.isoformat()}, []
    )
    labels = [s["label"] for s in result["slots"]]
    assert len(labels) == 17  # 06:00 ... 22:00 -- all of them, not the first 15
    assert labels[0].endswith("6:00 AM - 7:00 AM")
    assert labels[-1].endswith("10:00 PM - 11:00 PM")
    assert all("UTC" not in label and "+00:00" not in label for label in labels)
    assert all(s["starts_at"].endswith("+00:00") for s in result["slots"])  # still UTC for tool round-trips


def test_system_prompt_knows_today_and_forbids_mentioning_utc():
    """The model has no clock (it once offered '15 May' in September) and used to volunteer UTC."""
    from datetime import timezone

    from app.services.ai_chat_service import build_system_prompt

    prompt = build_system_prompt(datetime(2026, 9, 20, 16, 15, tzinfo=timezone.utc))  # 21:15 PKT
    assert "Sunday, 20 September 2026, 9:15 PM" in prompt
    assert "NEVER" in prompt and "UTC" in prompt  # the rule forbidding it
    assert "label" in prompt


async def _availability_then_reply(db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch, phones, reply_text):
    """check_availability (two 60-min slots: 5-6 PM and 6-7 PM PKT), then a plain-text `reply_text`."""
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    owner = await make_user(phones[0], role=UserRole.OWNER)
    player = await make_user(phones[1], role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(17, 0), close_time=time(19, 0))
    await make_pricing_rule(court, price_per_slot=3000)
    _mock_anthropic_sequence(
        monkeypatch,
        [
            _tool_use_response("check_availability", {"court_id": str(court.id), "date": target.isoformat()}),
            _text_response(reply_text),
        ],
    )
    result = await AIChatService(db_session, settings).process_message(user=player, message="kal shaam ko?", history=[])
    return court, target, result


async def test_reply_naming_one_offered_slot_gets_a_yes_no_proposal_even_if_the_model_skipped_the_tool(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    """Production chat 2026-09-20: the model asked to book in plain text without calling
    propose_booking_confirmation, so the player's 'yes' had nothing to confirm. The service now ties
    a booking question that names exactly one slot from THIS turn's availability to that slot."""
    court, target, result = await _availability_then_reply(
        db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch,
        ("+923014000040", "+923014000041"), "5:00 PM - 6:00 PM available hai, PKR 3,000. Kya main book kar doon?",
    )
    assert [a.type for a in result.actions] == ["confirm_booking", "decline"]
    assert result.actions[0].data == {"court_id": str(court.id), "starts_at": target.isoformat() + "T12:00:00+00:00"}


async def test_no_proposal_is_attached_when_the_reply_is_ambiguous_or_not_about_booking(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    _court, _target, both = await _availability_then_reply(
        db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch,
        ("+923014000042", "+923014000043"), "5:00 PM - 6:00 PM aur 6:00 PM - 7:00 PM dono khaali hain. Kaunsa book karun?",
    )
    assert both.actions == []  # two slots named: which one would "yes" mean?

    _court, _target, info = await _availability_then_reply(
        db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch,
        ("+923014000044", "+923014000045"), "5:00 PM - 6:00 PM ka slot khaali hai, Rs. 3,000.",
    )
    assert info.actions == []  # informational only: no booking intent, no buttons


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
