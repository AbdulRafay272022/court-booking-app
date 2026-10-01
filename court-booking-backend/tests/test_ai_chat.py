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


async def _add_proposal(db_session, user, court, starts_at, *, channel="app", age_minutes=0, states_slot=True, content=None, **extra):
    """An assistant message that proposed `starts_at` (the court's minimum booking) -- what a bare "yes" is answering."""
    from datetime import timezone

    from app.models.message import Message
    from app.utils.timezone import format_slot_label

    start = datetime.fromisoformat(starts_at)
    label = format_slot_label(start, start + timedelta(minutes=court.slot_minutes))
    slot_count = court.slot_minutes // 30  # Part 4c: the fixed 30-minute grid; slot_minutes is the court's minimum booking
    db_session.add(
        Message(
            sender_id=user.id, sender_type="ai", channel=channel, message_type="text",
            content=content or (f"Court 1, {label}, PKR 2,500. Shall I book it? Reply Yes or No" if states_slot else "Shall I book it?"),
            created_at=datetime.now(timezone.utc) - timedelta(minutes=age_minutes),
            meta={"actions": [{"type": "confirm_booking", "label": "Yes, book it",
                               "data": {"court_id": str(court.id), "starts_at": starts_at, "slot_count": slot_count, "label": label, **extra}}]},
        )
    )
    await db_session.commit()


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
    # hold_slot only runs for a slot the assistant's previous message stated and proposed (rule 16)
    await _add_proposal(db_session, player, court, starts_at)

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
    player = await make_user("+923014000007", role=UserRole.PLAYER, name="Sara Ahmed")
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
    assert good["label"].startswith("9:00 PM to 10:30 PM, ")
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
    # Part 4c: a start every 30 minutes, 06:00 ... 22:00 (a 60-minute booking from 22:30 would pass the 11 PM close),
    # each shown as the court's whole minimum booking -- all of them, not the first 15
    assert len(labels) == 33
    assert labels[0].startswith("6:00 AM to 7:00 AM, ")
    assert labels[1].startswith("6:30 AM to 7:30 AM, ")
    assert labels[-1].startswith("10:00 PM to 11:00 PM, ")
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


async def test_ai_reply_never_shows_a_24_hour_time_or_an_iso_timestamp(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    """Regression (real replies 2026-09-20): "slots only run up to 17:30", "from 07:00 to 08:30", mixed with
    "9:00 PM" in the same message. Whatever the model writes, the player must never SEE a clock time without
    AM/PM or a raw ISO timestamp."""
    from app.utils.timezone import contains_24h_time

    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    owner = await make_user("+923014000050", role=UserRole.OWNER)
    player = await make_user("+923014000051", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=2500)
    _mock_anthropic_sequence(
        monkeypatch,
        [
            _tool_use_response("check_availability", {"court_id": str(court.id), "date": target.isoformat()}),
            _text_response(
                "Slots only run up to 17:30 (07:00 to 08:30 is free), and 9:00 PM is open. "
                "Booked at 2026-09-23T14:30:00+00:00."
            ),
        ],
    )
    result = await AIChatService(db_session, settings).process_message(user=player, message="9 pm?", history=[])
    assert not contains_24h_time(result.reply), result.reply
    assert "T14:30" not in result.reply and "+00:00" not in result.reply, result.reply
    assert "5:30 PM" in result.reply and "9:00 PM" in result.reply


async def test_hold_slot_tool_result_carries_labels_not_iso_timestamps(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """The hold result used to hand the model `held_until` as an ISO string, which it then re-formatted."""
    import re

    owner = await make_user("+923014000052", role=UserRole.OWNER)
    player = await make_user("+923014000053", role=UserRole.PLAYER)
    venue = await make_venue(owner)
    court = await make_court(venue, slot_minutes=60)
    target = date.today() + timedelta(days=1)
    await make_schedule(court, day_of_week=target.weekday(), open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=2500)

    result = await AIChatService(db_session, get_settings())._execute_tool(
        player, "hold_slot", {"court_id": str(court.id), "starts_at": target.isoformat() + "T14:00:00+00:00"}, []
    )
    assert "error" not in result, result
    assert "held_until" not in result
    assert re.fullmatch(r"\d{1,2}:\d{2} [AP]M", result["held_until_label"]), result
    assert result["label"].startswith("7:00 PM to 8:00 PM, ")


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
        ("+923014000040", "+923014000041"), "5:00 PM to 6:00 PM available hai, PKR 3,000. Kya main book kar doon?",
    )
    assert [a.type for a in result.actions] == ["confirm_booking", "decline"]
    assert {k: result.actions[0].data[k] for k in ("court_id", "starts_at")} == {"court_id": str(court.id), "starts_at": target.isoformat() + "T12:00:00+00:00"}
    assert result.actions[0].data["label"]  # the exact slot is stored with the proposal


async def test_no_proposal_is_attached_when_the_reply_is_ambiguous_or_not_about_booking(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    _court, _target, both = await _availability_then_reply(
        db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch,
        ("+923014000042", "+923014000043"), "5:00 PM to 6:00 PM aur 6:00 PM to 7:00 PM dono khaali hain. Kaunsa book karun?",
    )
    assert both.actions == []  # two slots named: which one would "yes" mean?

    _court, _target, info = await _availability_then_reply(
        db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch,
        ("+923014000044", "+923014000045"), "5:00 PM to 6:00 PM ka slot khaali hai, Rs. 3,000.",
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


# --- Section 32 Part 8: outgoing-reply sanitizer -----------------------------
from app.services.ai_chat_service import sanitize_reply, _strip_button_talk, _strip_markdown


def test_sanitize_strips_markdown_bold_that_whatsapp_shows_literally():
    assert _strip_markdown("Pay **PKR 3,500** now") == "Pay PKR 3,500 now"
    assert _strip_markdown("__Court 1__ is free") == "Court 1 is free"
    assert _strip_markdown("# Heading\n- item one\n- item two").strip() == "Heading\nitem one\nitem two"


def test_sanitize_removes_button_tap_click_wording():
    for text in [
        "Please tap the button below to confirm.",
        "Click the Yes button to book it.",
        "Press the buttons to continue.",
    ]:
        cleaned = _strip_button_talk(text).lower()
        assert "button" not in cleaned
        assert "tap" not in cleaned and "click" not in cleaned and "press" not in cleaned


def test_sanitize_keeps_the_reply_yes_or_no_fallback():
    text = "Shall I book it? Reply Yes or No"
    assert _strip_button_talk(text) == text


def test_sanitize_reply_combines_all_safety_nets():
    # 24-hour time + markdown + button talk in one reply.
    out = sanitize_reply("**Great!** Your slot is 19:00 to 20:00. Tap the Yes button below to confirm.")
    assert "**" not in out
    assert "19:00" not in out  # enforce_display_format handles the clock
    assert "button" not in out.lower() and "tap" not in out.lower()


# --- Bookings that cross midnight (owner report 2026-09-30) ---------------------------------------------
# "9 PM to 12 AM on the 26th" must be ONE booking anchored to its START (21:00 on the 26th) that ends at midnight;
# the assistant used to treat the 12 AM end as the 27th and refuse. Exact Pakistan wall-clock times throughout.
from app.models.blackout import Blackout
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _future_day(weekday: int = 5) -> date:
    """The next given weekday (Saturday by default) at least 4 days ahead, so every slot is in the future."""
    d = pkt_today() + timedelta(days=4)
    while d.weekday() != weekday:
        d += timedelta(days=1)
    return d


def _pkt(day: date, hh: int, mm: int = 0) -> datetime:
    """A Pakistan wall-clock time on `day` as a UTC instant (hh may be 24+ for 'the next morning')."""
    return pkt_time_to_utc(day, time(0, 0)) + timedelta(hours=hh, minutes=mm)


async def _midnight_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone, *, open_, close,
                          slot_minutes=60, days=range(7)):
    owner = await make_user(phone, role=UserRole.OWNER)
    court = await make_court(await make_venue(owner), slot_minutes=slot_minutes)
    for dow in days:
        await make_schedule(court, day_of_week=dow, open_time=open_, close_time=close)
    await make_pricing_rule(court, price_per_slot=1000)
    return owner, court


async def _slot_labels(service, player, court, day: date) -> list[str]:
    res = await service._execute_tool(player, "check_availability", {"court_id": str(court.id), "date": day.isoformat()}, [])
    return [s["label"] for s in res["slots"]]


async def _propose(service, player, court, start_utc: datetime, minutes: int):
    actions: list = []
    res = await service._execute_tool(
        player, "propose_booking_confirmation",
        {"court_id": str(court.id), "starts_at": start_utc.isoformat(), "duration_minutes": minutes}, actions,
    )
    return res, actions


async def test_9pm_to_12am_is_one_booking_anchored_to_the_start_date_on_a_midnight_closing_court(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """A court open 4 PM to 12 AM (close 00:00, closes_next_day), Saturday only. Saturday 9 PM for 3 hours ends at
    midnight; Sunday has NO schedule at all, and that must not matter."""
    _o, court = await _midnight_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                      "+923014100001", open_=time(16, 0), close=time(0, 0), days=[5])
    player = await make_user("+923014100002", role=UserRole.PLAYER)
    sat = _future_day(5)
    service = AIChatService(db_session, get_settings())

    labels = await _slot_labels(service, player, court, sat)
    assert any(l.startswith("11:00 PM to 12:00 AM, ") for l in labels), labels  # last slot ends AT midnight
    assert await _slot_labels(service, player, court, sat + timedelta(days=1)) == []  # Sunday: closed, no tail

    res, actions = await _propose(service, player, court, _pkt(sat, 21), 180)
    assert res.get("ok") is True, res
    assert res["label"].startswith("9:00 PM to 12:00 AM, ")
    assert res["duration_text"] == "3 hours" and res["total_price_text"] == "PKR 3,000"
    assert {k: actions[0].data[k] for k in ("court_id", "starts_at", "slot_count")} == {"court_id": str(court.id), "starts_at": _pkt(sat, 21).isoformat(), "slot_count": 6}  # six 30-minute slots
    assert actions[0].data["label"].startswith("9:00 PM to 12:00 AM") and actions[0].data["total_price_text"]

    held = await service._execute_tool(
        player, "hold_slot", {"court_id": str(court.id), "starts_at": _pkt(sat, 21).isoformat(), "duration_minutes": 180}, []
    )
    assert "error" not in held, held
    booking = (await db_session.execute(select(Booking).where(Booking.player_id == player.id))).scalar_one()
    assert (booking.starts_at, booking.ends_at) == (_pkt(sat, 21), _pkt(sat, 24))


async def test_1130pm_to_1230am_crosses_midnight_via_the_quote_hold_and_assistant_paths(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, client, make_auth_headers
):
    """Non-AI path too: quote and hold of 11:30 PM -> 12:30 AM, on a 3:30 PM-1:30 AM court (60-min grid on the half
    hour) and on two 24-hour courts (open == close). All are Saturday-schedule slots even though they end on Sunday."""
    player = await make_user("+923014100004", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    sat = _future_day(5)
    service = AIChatService(db_session, get_settings())

    for phone, open_, close in (("+923014100003", time(15, 30), time(1, 30)), ("+923014100005", time(0, 0), time(0, 0)),
                                ("+923014100006", time(6, 0), time(6, 0))):
        _o, court = await _midnight_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone,
                                          open_=open_, close=close, slot_minutes=30 if open_ == close else 60)
        start = _pkt(sat, 23, 30)
        slots = 2  # one hour = two 30-minute slots, whatever the court's own minimum
        quote = await client.get(f"/api/v1/courts/{court.id}/quote", params={"starts_at": start.isoformat(), "slot_count": slots})
        assert quote.status_code == 200, (open_, close, quote.text)
        assert datetime.fromisoformat(quote.json()["ends_at"]) == _pkt(sat, 24, 30), quote.json()

        res, _actions = await _propose(service, player, court, start, 60)
        assert res.get("ok") is True, (open_, close, res)
        assert res["label"].startswith("11:30 PM to Sun 12:30 AM, Sat "), res
        hold = await client.post("/api/v1/bookings/hold", headers=headers,
                                 json={"court_id": str(court.id), "starts_at": start.isoformat(), "slot_count": slots})
        assert hold.status_code in (200, 201), (open_, close, hold.text)


async def test_12am_start_belongs_to_the_previous_schedule_day_on_an_overnight_court(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """3 PM to 3 AM court: Sunday 12:00 AM is a SATURDAY slot. The assistant finds it when asked about Sunday (by start
    date), quotes it, and a Saturday blackout covering it blocks it (it is NOT governed by Sunday's schedule)."""
    _o, court = await _midnight_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923014100007",
                                      open_=time(15, 0), close=time(3, 0))
    player = await make_user("+923014100008", role=UserRole.PLAYER)
    sat = _future_day(5)
    sun = sat + timedelta(days=1)
    service = AIChatService(db_session, get_settings())

    sunday_labels = await _slot_labels(service, player, court, sun)
    assert any(l.startswith("12:00 AM to 1:00 AM, ") for l in sunday_labels), sunday_labels  # tail of Saturday
    res, _a = await _propose(service, player, court, _pkt(sun, 0), 60)
    assert res.get("ok") is True and res["label"].startswith("12:00 AM to 1:00 AM, "), res

    db_session.add(Blackout(court_id=court.id, starts_at=_pkt(sat, 22), ends_at=_pkt(sat, 26), reason="maintenance"))
    await db_session.commit()
    blocked, actions = await _propose(service, player, court, _pkt(sun, 0), 60)
    assert "error" in blocked and actions == []  # Saturday's blackout reaches into Sunday's early hours


async def test_a_genuinely_booked_slot_still_rejects_a_midnight_crossing_booking(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    _o, court = await _midnight_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923014100009",
                                      open_=time(16, 0), close=time(0, 0))
    player = await make_user("+923014100010", role=UserRole.PLAYER)
    other = await make_user("+923014100011", role=UserRole.PLAYER)
    sat = _future_day(5)
    service = AIChatService(db_session, get_settings())
    await service.booking_service.create_hold(other, court.id, _pkt(sat, 23), 2)  # 11 PM to 12 AM taken

    assert not any(l.startswith("11:00 PM to 12:00 AM, ") for l in await _slot_labels(service, player, court, sat))
    res, actions = await _propose(service, player, court, _pkt(sat, 21), 180)
    assert "error" in res and "already booked" in res["error"].lower() and actions == [], res
    ok, _a = await _propose(service, player, court, _pkt(sat, 21), 120)  # 9 PM to 11 PM is still fine
    assert ok.get("ok") is True and ok["label"].startswith("9:00 PM to 11:00 PM, ")


async def test_midnight_crossing_booking_ignores_a_closed_or_blacked_out_next_day(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """Overnight court open Saturday only (3 PM to 3 AM); Sunday has no schedule and a Sunday blackout (8 AM-8 PM)
    exists. 11:30 PM Saturday to 12:30 AM Sunday is still bookable: it belongs to Saturday's schedule."""
    _o, court = await _midnight_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923014100012",
                                      open_=time(15, 0), close=time(3, 0), days=[5], slot_minutes=30)
    player = await make_user("+923014100013", role=UserRole.PLAYER)
    sat = _future_day(5)
    sun = sat + timedelta(days=1)
    db_session.add(Blackout(court_id=court.id, starts_at=_pkt(sun, 8), ends_at=_pkt(sun, 20)))
    await db_session.commit()
    service = AIChatService(db_session, get_settings())

    res, actions = await _propose(service, player, court, _pkt(sat, 23, 30), 60)
    assert res.get("ok") is True and res["label"].startswith("11:30 PM to Sun 12:30 AM, Sat "), res
    assert actions[0].data["slot_count"] == 2
    late, _a = await _propose(service, player, court, _pkt(sat, 26, 30), 60)  # 2:30 AM + 1 h would end 3:30 AM: past close
    assert "error" in late


async def _range(service, player, court, day: date, start: str, end: str | None):
    args = {"court_id": str(court.id), "date": day.isoformat(), "start_time": start}
    if end is not None:
        args["end_time"] = end
    return (await service._execute_tool(player, "check_availability", args, []))["requested_range"]


async def test_check_availability_judges_the_requested_range_by_its_start_date(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """The assistant hands check_availability the START date plus start_time/end_time and gets the real range back.
    An end at or before the start is the next morning, so "9 PM to 12 AM" on Saturday is Saturday's booking, and a
    closed Sunday (no schedule) cannot make it unavailable."""
    _o, court = await _midnight_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923014100020",
                                      open_=time(16, 0), close=time(0, 0), days=[5])
    player = await make_user("+923014100021", role=UserRole.PLAYER)
    other = await make_user("+923014100022", role=UserRole.PLAYER)
    sat = _future_day(5)
    service = AIChatService(db_session, get_settings())

    for start, end in (("21:00", "00:00"), ("9 PM", "12 AM"), ("21:00", "midnight")):
        rng = await _range(service, player, court, sat, start, end)
        assert rng["available"] is True, (start, end, rng)
        assert rng["starts_at"] == _pkt(sat, 21).isoformat() and rng["duration_minutes"] == 180
        assert rng["label"].startswith("9:00 PM to 12:00 AM, Sat ") and rng["total_price_text"] == "PKR 3,000"
    # asking about "the 27th" (the end's date) is what used to go wrong: Sunday has no 9 PM slot, correctly
    sun = await _range(service, player, court, sat + timedelta(days=1), "21:00", "00:00")
    assert sun["available"] is False

    # same-day range, and a start with no end (one slot)
    assert (await _range(service, player, court, sat, "18:00", "20:00"))["duration_minutes"] == 120
    assert (await _range(service, player, court, sat, "22:00", None))["label"].startswith("10:00 PM to 11:00 PM, ")

    # genuinely unavailable: past closing, off the grid, bad input, and a booked slot inside the range
    assert (await _range(service, player, court, sat, "23:00", "01:00"))["available"] is False  # runs past midnight close
    assert (await _range(service, player, court, sat, "21:30", "23:30"))["available"] is True   # 21:30 is on the 30-min grid
    assert (await _range(service, player, court, sat, "21:10", "23:10"))["available"] is False  # off the grid
    below = await _range(service, player, court, sat, "21:00", "21:30")  # 30 minutes on a 60-minute-minimum court
    assert below["available"] is False and "minimum booking" in below["error"].lower(), below
    assert (await _range(service, player, court, sat, "banana", "00:00"))["available"] is False
    await service.booking_service.create_hold(other, court.id, _pkt(sat, 23), 2)
    taken = await _range(service, player, court, sat, "21:00", "00:00")
    assert taken["available"] is False and "already booked" in taken["error"].lower(), taken
    assert (await _range(service, player, court, sat, "21:00", "23:00"))["available"] is True


async def test_assistant_books_9pm_to_12am_end_to_end_with_a_mocked_model(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    """The model's turn for "book 9 PM to 12 AM on Saturday": check_availability(start date, 21:00, 00:00) ->
    propose_booking_confirmation(starts_at/duration copied from requested_range) -> the Yes/No actions carry the
    right 3-slot range anchored at 9 PM Saturday."""
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    _o, court = await _midnight_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923014100023",
                                      open_=time(16, 0), close=time(0, 0))
    player = await make_user("+923014100024", role=UserRole.PLAYER, name="Sara Ahmed")
    sat = _future_day(5)
    start = _pkt(sat, 21).isoformat()
    _mock_anthropic_sequence(
        monkeypatch,
        [
            _tool_use_response("check_availability", {"court_id": str(court.id), "date": sat.isoformat(), "start_time": "21:00", "end_time": "00:00"}),
            _tool_use_response("propose_booking_confirmation", {"court_id": str(court.id), "starts_at": start, "duration_minutes": 180}, "toolu_2"),
            _text_response("9:00 PM to 12:00 AM, PKR 3,000. Shall I book it? Reply Yes or No"),
        ],
    )
    result = await AIChatService(db_session, settings).process_message(user=player, message="9 pm to 12 am saturday", history=[])
    assert result.tool_calls == ["check_availability", "propose_booking_confirmation"]
    assert {k: result.actions[0].data[k] for k in ("court_id", "starts_at", "slot_count")} == {"court_id": str(court.id), "starts_at": start, "slot_count": 6}


def test_system_prompt_anchors_midnight_crossing_bookings_to_the_start_date():
    from app.services.ai_chat_service import SYSTEM_PROMPT
    from app.services.ai.tools import BOOKING_TOOLS

    assert "12 AM as an END" in SYSTEM_PROMPT and "NOT on the 27th" in SYSTEM_PROMPT and "start_time" in SYSTEM_PROMPT
    props = next(t for t in BOOKING_TOOLS if t.name == "check_availability").parameters["properties"]
    assert {"start_time", "end_time"} <= set(props)


# --- The name the player gives in chat (owner report: "extracts the player's name incorrectly") -------------------
# The assistant never captured a name at all: the booking always carried the ACCOUNT's name (blank for someone who
# first wrote on WhatsApp), so "mera naam Ali hai" / "book for my friend Ali Khan" produced a booking under Sara Ahmed
# (or under nobody). player_name now travels propose_booking_confirmation -> the Yes action -> hold.
from app.models.message import Message


async def _name_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phones, *, venue_name="Clifton Padel Club",
                      court_name="Court 1", player_name="Sara Ahmed"):
    owner = await make_user(phones[0], role=UserRole.OWNER)
    venue = await make_venue(owner, name=venue_name)
    court = await make_court(venue, name=court_name, slot_minutes=60)
    for dow in range(7):
        await make_schedule(court, day_of_week=dow, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3500)
    player = await make_user(phones[1], role=UserRole.PLAYER, name=player_name)
    return court, player


async def test_a_name_given_in_chat_rides_on_the_proposal_and_the_hold_not_the_account_name(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    court, player = await _name_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923014200001", "+923014200002"))
    service = AIChatService(db_session, get_settings())
    day = _future_day(5)
    start = _pkt(day, 19).isoformat()

    # "mera naam Ali hai" / "book for my friend Ali Khan" / sloppy spacing and punctuation from the model
    for said, kept in (("Ali", "Ali"), ("Ali Khan", "Ali Khan"), ("  ali   khan. ", "ali khan"), ("Padel Khan", "Padel Khan")):
        actions: list = []
        res = await service._execute_tool(player, "propose_booking_confirmation",
                                          {"court_id": str(court.id), "starts_at": start, "player_name": said}, actions)
        assert res["ok"] is True
        assert actions[0].data["player_name"] == kept, (said, actions[0].data)

    held = await service._execute_tool(player, "hold_slot", {"court_id": str(court.id), "starts_at": start, "player_name": "Ali Khan"}, [])
    assert "error" not in held, held
    booking = (await db_session.execute(select(Booking).where(Booking.player_id == player.id))).scalar_one()
    assert booking.player_name == "Ali Khan"  # NOT "Sara Ahmed"
    assert booking.player_phone == player.phone  # the contact number is still the account's


async def test_no_name_given_keeps_the_account_name_and_a_whatsapp_guest_stays_nameless(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    court, player = await _name_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923014200003", "+923014200004"))
    guest = await make_user("+923014200005", role=UserRole.PLAYER)  # a WhatsApp-first guest: no name on the account
    service = AIChatService(db_session, get_settings())
    day = _future_day(5)

    actions: list = []
    await service._execute_tool(player, "propose_booking_confirmation", {"court_id": str(court.id), "starts_at": _pkt(day, 19).isoformat()}, actions)
    assert "player_name" not in actions[0].data
    await service._execute_tool(player, "hold_slot", {"court_id": str(court.id), "starts_at": _pkt(day, 19).isoformat()}, [])
    await service._execute_tool(guest, "hold_slot", {"court_id": str(court.id), "starts_at": _pkt(day, 20).isoformat()}, [])
    named = (await db_session.execute(select(Booking.player_id, Booking.player_name))).all()
    assert {pid: name for pid, name in named} == {player.id: "Sara Ahmed", guest.id: None}


async def test_a_court_venue_sport_or_city_word_is_never_taken_as_the_players_name(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    """The model can lift "Court 1" or "Clifton Padel Club" out of "book Court 1 at Clifton Padel Club" and call it a
    name. Those are dropped (the account name is used); a real name that merely CONTAINS such a word is kept."""
    court, player = await _name_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923014200006", "+923014200007"))
    service = AIChatService(db_session, get_settings())
    start = _pkt(_future_day(5), 19).isoformat()
    for bad in ("Court 1", "court", "Clifton Padel Club", "Clifton", "padel", "Futsal", "Karachi", "1234", "", "   ", None):
        actions: list = []
        await service._execute_tool(player, "propose_booking_confirmation",
                                    {"court_id": str(court.id), "starts_at": start, "player_name": bad}, actions)
        assert "player_name" not in actions[0].data, bad
    for good in ("Clifton Khan", "Court Ali"):
        actions = []
        await service._execute_tool(player, "propose_booking_confirmation",
                                    {"court_id": str(court.id), "starts_at": start, "player_name": good}, actions)
        assert actions[0].data["player_name"] == good


async def test_whatsapp_yes_books_under_the_name_the_player_gave(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    """A WhatsApp-first guest says "mera naam Ali hai", the assistant proposes (name stored on the proposal's action), a
    typed "yes" and a later button tap both book under "Ali"; with no stored name the booking stays unnamed."""
    from tests.test_webhooks import _button_payload, _mock_whatsapp_send, _text_payload

    _mock_whatsapp_send(monkeypatch)
    court, _p = await _name_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, ("+923014200008", "+923014200009"))
    guest = await make_user("+923014200010", role=UserRole.PLAYER)
    day = _future_day(5)
    slot = lambda hh: _pkt(day, hh).isoformat()  # noqa: E731
    await _add_proposal(db_session, guest, court, slot(19), channel="whatsapp", player_name="Ali")

    typed = await client.post("/api/v1/webhooks/whatsapp", json=_text_payload("923014200010", "wamid.name-1", "yes"))
    assert typed.status_code == 200
    tapped = await client.post("/api/v1/webhooks/whatsapp", json=_button_payload("923014200010", "wamid.name-2", f"confirm:{court.id}:{slot(21)}"))
    assert tapped.status_code == 200
    rows = (await db_session.execute(select(Booking).where(Booking.player_id == guest.id).order_by(Booking.starts_at))).scalars().all()
    assert [(b.starts_at, b.player_name) for b in rows] == [(_pkt(day, 19), "Ali"), (_pkt(day, 21), None)]


def test_prompt_and_tools_tell_the_model_how_to_handle_names():
    from app.services.ai.tools import BOOKING_TOOLS
    from app.services.ai_chat_service import SYSTEM_PROMPT

    assert "ONE short question" in SYSTEM_PROMPT and "mera naam" in SYSTEM_PROMPT and "player_name" in SYSTEM_PROMPT
    for name in ("propose_booking_confirmation", "hold_slot"):
        assert "player_name" in next(t for t in BOOKING_TOOLS if t.name == name).parameters["properties"]


# --- Ask for a name once; confirm the EXACT time before booking (owner decisions 2026-10-02) ----------------------------
def _capture_anthropic(monkeypatch, responses: list[dict]) -> list[dict]:
    """Like _mock_anthropic_sequence, but records every request body (the system prompt the model was given)."""
    bodies: list[dict] = []
    calls = {"n": 0}

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        bodies.append(json)
        i = min(calls["n"], len(responses) - 1)
        calls["n"] += 1
        return httpx.Response(200, request=httpx.Request("POST", url), json=responses[i])

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    return bodies


async def _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phones, monkeypatch, *, name=None):
    monkeypatch.setattr(get_settings(), "ANTHROPIC_API_KEY", "test-key")
    court, _p = await _name_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, (phones[0], phones[1]))
    user = await make_user(phones[2], role=UserRole.PLAYER, **({"name": name} if name else {}))
    return court, user


async def test_assistant_asks_a_nameless_player_for_a_name_once_before_proposing(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    court, guest = await _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                         ("+923014300001", "+923014300002", "+923014300003"), monkeypatch)
    guest = await db_session.get(type(guest), guest.id)  # bound to the session, like the request's user
    start = _pkt(_future_day(5), 19).isoformat()
    bodies = _capture_anthropic(monkeypatch, [
        _tool_use_response("propose_booking_confirmation", {"court_id": str(court.id), "starts_at": start}),
        _text_response("What name should I put the booking under?"),
    ])
    service = AIChatService(db_session, get_settings())
    result = await service.process_message(user=guest, message="book 7pm saturday", history=[])
    assert result.actions == [] and "name" in result.reply.lower()  # no Yes/No yet: a name comes first
    assert "none on file" in bodies[0]["system"]  # the model is told the account has no name

    # next turn: the question is in the history, the player answers with their own name -> proposal carries it, account filled
    history = [{"role": "user", "content": "book 7pm saturday"}, {"role": "assistant", "content": result.reply}]
    _capture_anthropic(monkeypatch, [
        _tool_use_response("propose_booking_confirmation", {"court_id": str(court.id), "starts_at": start,
                                                            "player_name": "Ali", "name_is_players_own": True}),
        _text_response("Court 1, Sat, 7 PM. Shall I book it?"),
    ])
    result2 = await service.process_message(user=guest, message="Ali", history=history)
    confirm = next(a for a in result2.actions if a.type == "confirm_booking")
    assert confirm.data["player_name"] == "Ali"
    await db_session.refresh(guest)
    assert guest.name == "Ali"  # saved on the empty account name

    # an existing account name is NEVER overwritten, and a friend's name is never saved on the account
    sara = await make_user("+923014300004", role=UserRole.PLAYER, name="Sara Ahmed")
    sara = await db_session.get(type(sara), sara.id)
    await service._execute_tool(sara, "propose_booking_confirmation",
                                {"court_id": str(court.id), "starts_at": start, "player_name": "Ali", "name_is_players_own": True}, [])
    assert sara.name == "Sara Ahmed"
    other = await make_user("+923014300005", role=UserRole.PLAYER)
    other = await db_session.get(type(other), other.id)
    await service._execute_tool(other, "propose_booking_confirmation",
                                {"court_id": str(court.id), "starts_at": start, "player_name": "Ali Khan", "name_is_players_own": False}, [])
    await service._execute_tool(other, "propose_booking_confirmation",
                                {"court_id": str(court.id), "starts_at": start, "player_name": "Court 1", "name_is_players_own": True}, [])
    assert other.name is None


async def test_name_question_is_never_repeated_and_a_named_account_is_never_asked(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    court, guest = await _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                         ("+923014300011", "+923014300012", "+923014300013"), monkeypatch)
    start = _pkt(_future_day(5), 19).isoformat()
    service = AIChatService(db_session, get_settings())

    # the question was already asked and the player brushed it off: propose WITHOUT a name goes straight through
    history = [{"role": "user", "content": "book 7pm"}, {"role": "assistant", "content": "What name should I put the booking under?"},
               {"role": "user", "content": "koi bhi"}]
    _capture_anthropic(monkeypatch, [
        _tool_use_response("propose_booking_confirmation", {"court_id": str(court.id), "starts_at": start}),
        _text_response("Court 1, 7 PM. Shall I book it?"),
    ])
    result = await service.process_message(user=guest, message="koi bhi", history=history)
    assert any(a.type == "confirm_booking" for a in result.actions)
    assert "player_name" not in next(a for a in result.actions if a.type == "confirm_booking").data

    # an account with a name is never asked: the proposal goes straight through and the prompt says the name is on file
    sara = await make_user("+923014300014", role=UserRole.PLAYER, name="Sara Ahmed")
    bodies = _capture_anthropic(monkeypatch, [
        _tool_use_response("propose_booking_confirmation", {"court_id": str(court.id), "starts_at": start}),
        _text_response("Court 1, 7 PM. Shall I book it?"),
    ])
    result = await service.process_message(user=sara, message="book 7pm", history=[])
    assert any(a.type == "confirm_booking" for a in result.actions)
    assert 'Player account name: "Sara Ahmed"' in bodies[0]["system"]


async def test_proposal_message_always_states_the_exact_slot_court_date_time_and_price(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    court, sara = await _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                        ("+923014300021", "+923014300022", "+923014300023"), monkeypatch, name="Sara Ahmed")
    day = _future_day(5)
    start = _pkt(day, 19).isoformat()
    _capture_anthropic(monkeypatch, [
        _tool_use_response("propose_booking_confirmation", {"court_id": str(court.id), "starts_at": start}),
        _text_response("Shall I book it? Reply Yes or No"),  # the model never said WHICH slot
    ])
    result = await AIChatService(db_session, get_settings()).process_message(user=sara, message="book 7pm saturday", history=[])
    label = next(a for a in result.actions if a.type == "confirm_booking").data["label"]
    assert label.startswith("7:00 PM to 8:00 PM, ") and label in result.reply
    assert "Court 1" in result.reply and "PKR 3,500" in result.reply and result.reply.rstrip().endswith("Reply Yes or No")

    # when the model already states it, nothing is appended
    _capture_anthropic(monkeypatch, [
        _tool_use_response("propose_booking_confirmation", {"court_id": str(court.id), "starts_at": start}),
        _text_response(f"Court 1, {label}, PKR 3,500. Shall I book it? Reply Yes or No"),
    ])
    again = await AIChatService(db_session, get_settings()).process_message(user=sara, message="book 7pm saturday", history=[])
    assert again.reply.count(label) == 1


async def _hold_via_model(db_session, monkeypatch, user, court, start, message="yes", history=None, **hold_args):
    _capture_anthropic(monkeypatch, [
        _tool_use_response("hold_slot", {"court_id": str(court.id), "starts_at": start, **hold_args}),
        _text_response("ok"),
    ])
    return await AIChatService(db_session, get_settings()).process_message(user=user, message=message, history=history or [])


async def _held(db_session, user):
    return (await db_session.execute(select(Booking).where(Booking.player_id == user.id))).scalars().all()


async def test_hold_slot_only_runs_for_the_exact_slot_the_previous_message_stated(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    """The owner's rule: yes with a clear proposal books; yes after the time changed re-asks; yes with no proposal asks;
    a stale proposal (>30 min) re-confirms."""
    court, sara = await _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                        ("+923014300031", "+923014300032", "+923014300033"), monkeypatch, name="Sara Ahmed")
    day = _future_day(5)
    seven, eight = _pkt(day, 19).isoformat(), _pkt(day, 20).isoformat()

    # (1) yes with NO proposal at all -> refused (the model is told to state the slot), nothing held
    res = await _hold_via_model(db_session, monkeypatch, sara, court, seven)
    assert res.tool_calls == ["hold_slot"] and await _held(db_session, sara) == []

    # (2) a proposal whose text never said which time -> refused
    await _add_proposal(db_session, sara, court, seven, states_slot=False)
    await _hold_via_model(db_session, monkeypatch, sara, court, seven)
    assert await _held(db_session, sara) == []

    # (3) a stated proposal, but 45 minutes old -> refused (stale)
    await _add_proposal(db_session, sara, court, seven, age_minutes=45)
    await _hold_via_model(db_session, monkeypatch, sara, court, seven)
    assert await _held(db_session, sara) == []

    # (4) a live, stated proposal for 7 PM, but the model tries to hold 8 PM (the player changed the time) -> refused
    await _add_proposal(db_session, sara, court, seven)
    await _hold_via_model(db_session, monkeypatch, sara, court, eight)
    assert await _held(db_session, sara) == []

    # (5) the same live proposal, held for exactly that slot -> books
    await _hold_via_model(db_session, monkeypatch, sara, court, seven)
    held = await _held(db_session, sara)
    assert [b.starts_at for b in held] == [_pkt(day, 19)]


async def test_a_name_given_before_the_proposal_survives_the_yes_into_the_hold(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    court, guest = await _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                         ("+923014300041", "+923014300042", "+923014300043"), monkeypatch)
    seven = _pkt(_future_day(5), 19).isoformat()
    await _add_proposal(db_session, guest, court, seven, player_name="Ali")
    # the model forgets the name when it calls hold_slot; the proposal's stored name is used
    await _hold_via_model(db_session, monkeypatch, guest, court, seven)
    assert [b.player_name for b in await _held(db_session, guest)] == ["Ali"]


async def test_a_bare_yes_without_a_stated_slot_tells_the_model_to_restate_it_and_a_valid_one_to_book(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    court, sara = await _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                        ("+923014300051", "+923014300052", "+923014300053"), monkeypatch, name="Sara Ahmed")
    seven = _pkt(_future_day(5), 19).isoformat()
    service = AIChatService(db_session, get_settings())

    bodies = _capture_anthropic(monkeypatch, [_text_response("Which slot do you mean?")])
    await service.process_message(user=sara, message="Yes", history=[])
    assert "bare \"yes\"" in bodies[0]["system"] and "Do NOT call hold_slot" in bodies[0]["system"]

    await _add_proposal(db_session, sara, court, seven)
    bodies = _capture_anthropic(monkeypatch, [_text_response("ok")])
    await service.process_message(user=sara, message="haan bhai book kardo", history=[])
    assert seven in bodies[0]["system"] and "call hold_slot for exactly that slot" in bodies[0]["system"]

    # a message that says more than yes (a changed time) gets no yes-hint at all
    bodies = _capture_anthropic(monkeypatch, [_text_response("Checking 9pm.")])
    await service.process_message(user=sara, message="yes but 9pm", history=[])
    assert "The player just replied" not in bodies[0]["system"]


async def test_whatsapp_name_then_exact_time_flow_end_to_end(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    """A brand-new WhatsApp guest: asked for a name once, answers, gets the exact slot + Yes/No, a typed "yes" books it
    under that name and the name lands on the account. The model is mocked; everything else is the real path."""
    from app.models.user import User
    from tests.test_webhooks import _mock_whatsapp_send, _text_payload

    sent = _mock_whatsapp_send(monkeypatch)

    async def fake_send_buttons(self, to, body, buttons):
        sent.append({"to": to, "body": body, "buttons": buttons})
        return {"messages": [{"id": f"wamid.buttons.{len(sent)}"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_buttons", fake_send_buttons)
    court, _sara = await _nameless_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule,
                                         ("+923014300061", "+923014300062", "+923014300063"), monkeypatch)
    day = _future_day(5)
    seven = _pkt(day, 19).isoformat()
    # the test client is itself an httpx.AsyncClient: only the model call may be intercepted
    real_post, calls = httpx.AsyncClient.post, {"n": 0}
    model_replies = [
        _tool_use_response("propose_booking_confirmation", {"court_id": str(court.id), "starts_at": seven}),
        _text_response("What name should I put the booking under?"),
        _tool_use_response("propose_booking_confirmation", {"court_id": str(court.id), "starts_at": seven,
                                                            "player_name": "Ali Raza", "name_is_players_own": True}),
        _text_response("Shall I book it?"),
    ]

    async def fake_post(self, url, *args, **kwargs):
        if "anthropic" not in str(url):
            return await real_post(self, url, *args, **kwargs)
        calls["n"] += 1
        return httpx.Response(200, request=httpx.Request("POST", url), json=model_replies[calls["n"] - 1])

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    await client.post("/api/v1/webhooks/whatsapp", json=_text_payload("923014300063", "wamid.flow-1", "book court 1 at 7pm saturday"))
    assert "name" in sent[-1]["body"].lower() and "Shall I book" not in sent[-1]["body"]
    await client.post("/api/v1/webhooks/whatsapp", json=_text_payload("923014300063", "wamid.flow-2", "Ali Raza"))
    assert "7:00 PM to 8:00 PM" in sent[-1]["body"] and "PKR 3,500" in sent[-1]["body"] and sent[-1]["buttons"]  # exact slot + buttons
    guest = await db_session.scalar(select(User).where(User.phone == "+923014300063"))
    assert await _held(db_session, guest) == []  # nothing booked yet

    await client.post("/api/v1/webhooks/whatsapp", json=_text_payload("923014300063", "wamid.flow-3", "yes"))
    await db_session.refresh(guest)
    rows = await _held(db_session, guest)
    assert [(b.starts_at, b.player_name) for b in rows] == [(_pkt(day, 19), "Ali Raza")]
    assert guest.name == "Ali Raza"
