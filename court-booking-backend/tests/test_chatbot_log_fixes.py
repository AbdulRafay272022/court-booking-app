"""Fixes from the review of the production chatbot logs (2026-10-10): wrong "kal" date, booking without a duration or summary,
reply/question order in the app chat, a booking proposed for 2020, "isko book krdo" picking a slot, the bot choosing a sport,
repeating itself / assuming AM, English payment replies with emoji, and offering sports the platform does not have."""

from datetime import datetime, time, timedelta, timezone

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.models.message import Message
from app.models.user import UserRole
from app.services.ai_chat_service import (
    SYSTEM_PROMPT,
    AIChatService,
    ambiguous_hours,
    build_system_prompt,
    points_at_listed_slot,
    sanitize_reply,
)
from app.services.reply_text import looks_like_roman_urdu, payment_proof_reply
from app.utils.timezone import pkt_time_to_utc, pkt_today


def _text(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}], "stop_reason": "end_turn"}


def _tool(name: str, args: dict, call_id: str = "toolu_1") -> dict:
    return {"content": [{"type": "tool_use", "id": call_id, "name": name, "input": args}], "stop_reason": "tool_use"}


def _mock_model(monkeypatch, responses: list[dict]) -> None:
    calls = {"n": 0}

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        i = min(calls["n"], len(responses) - 1)
        calls["n"] += 1
        return httpx.Response(200, request=httpx.Request("POST", url), json=responses[i])

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)


def _utc(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=timezone.utc)


# --- 1. "kal" is looked up, not computed ------------------------------------------------------------------------------


def test_calendar_gives_the_right_kal_in_pakistan_time():
    # 7 Oct 2026, 12:13 PM PKT (the production case: the model said "kal = 9 October")
    prompt = build_system_prompt(_utc(2026, 10, 7, 7, 13))
    assert "kal / tomorrow: Thu 8 Oct 2026 = 2026-10-08" in prompt
    assert "aaj / today: Wed 7 Oct 2026 = 2026-10-07" in prompt
    assert "parson / the day after tomorrow: Fri 9 Oct 2026" in prompt


def test_calendar_uses_the_pakistan_day_not_the_utc_day():
    # 29 Sep 23:26 UTC is 4:26 AM on 30 Sep in Karachi: "kal" is 1 Oct, not 30 Sep
    prompt = build_system_prompt(_utc(2026, 9, 29, 23, 26))
    assert "aaj / today: Wed 30 Sep 2026 = 2026-09-30" in prompt
    assert "kal / tomorrow: Thu 1 Oct 2026 = 2026-10-01" in prompt


# --- 10. only real sports are offered ----------------------------------------------------------------------------------


def test_prompt_lists_only_the_sports_that_exist():
    prompt = build_system_prompt(_utc(2026, 10, 7, 7), available_sports=["Futsal", "Padel"])
    assert "Sports on this platform: Futsal, Padel." in prompt
    for invented in ("badminton", "cricket nets", "tennis"):
        assert invented not in SYSTEM_PROMPT.lower() and invented not in prompt.lower()
    assert "none are listed yet" in build_system_prompt(_utc(2026, 10, 7, 7), available_sports=[])


async def test_available_sports_come_from_the_real_venues(db_session, make_user, make_venue):
    owner = await make_user("+923091000001", role=UserRole.OWNER)
    await make_venue(owner, name="Both", sports=["futsal", "padel"])
    service = AIChatService(db_session, get_settings())
    assert await service._available_sports() == ["Futsal", "Padel"]


# --- 6/8. shorthand, AM/PM, "this" ------------------------------------------------------------------------------------


def test_shorthand_is_not_echoed_back():
    assert sanitize_reply("Kl 9:00 AM to 10:00 AM, Thu 1 Oct ka slot available hai.").startswith("Kal 9:00 AM")
    assert sanitize_reply("aj raat 9:00 PM free hai") == "aaj raat 9:00 PM free hai"
    assert "Klein" in sanitize_reply("Klein Arena")  # whole words only


def test_bare_hours_are_ambiguous_but_clear_ones_are_not():
    assert ambiguous_hours("Kl ki chayie 9 ki") == {9}
    assert ambiguous_hours("book at 9") == {9}
    assert ambiguous_hours("Aj 9pm ki booking hai?") == set()
    assert ambiguous_hours("aaj raat 9 baje") == set()
    assert ambiguous_hours("subah 9 baje") == set()
    assert ambiguous_hours("Kl 8 hai 9 tw ni") == set()  # a correction about the date, no clock hour
    assert ambiguous_hours("at 21:00") == set()
    assert ambiguous_hours("2 hours at 9 pm") == set()


def test_pointing_at_a_slot_is_detected():
    assert points_at_listed_slot("isko bhook krdo")
    assert points_at_listed_slot("book this")
    assert not points_at_listed_slot("book the 6 pm one")
    assert not points_at_listed_slot("yes")
    assert not points_at_listed_slot("isko pehla wala")


async def _two_sport_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone):
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner, name="Test Arena 1", sports=["padel", "futsal"])
    padel = await make_court(venue, name="Court 2", sport="padel", slot_minutes=60)
    await make_court(venue, name="Court A", sport="futsal", slot_minutes=60)
    day = pkt_today() + timedelta(days=1)
    for d in range(7):
        await make_schedule(padel, day_of_week=d, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(padel, price_per_slot=3000)
    return venue, padel, day


async def test_the_bot_may_not_pick_a_sport_for_the_player(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    venue, padel, day = await _two_sport_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923091000010")
    player = await make_user("+923091000011", role=UserRole.PLAYER)
    service = AIChatService(db_session, get_settings())
    args = {"court_id": str(padel.id), "date": day.isoformat()}

    blocked = await service._gate_tool(player, "whatsapp", "check_availability", args, [{"role": "user", "content": "Mjhy booking chayie"}])
    assert blocked and "which sport" in blocked["error"]

    # once the player names a sport (even misspelled), or the court, the lookup goes through
    assert await service._gate_tool(player, "whatsapp", "check_availability", args, [{"role": "user", "content": "Padel"}]) is None
    assert await service._gate_tool(player, "whatsapp", "check_availability", args, [{"role": "user", "content": "Furtsal!"}]) is None
    assert await service._gate_tool(player, "app", "check_availability", args, [{"role": "user", "content": "Is Court 2 free tomorrow?"}]) is None


async def test_a_one_sport_venue_does_not_need_the_question(db_session, make_user, make_venue, make_court):
    owner = await make_user("+923091000012", role=UserRole.OWNER)
    court = await make_court(await make_venue(owner, sports=["padel"]), sport="padel")
    player = await make_user("+923091000013", role=UserRole.PLAYER)
    service = AIChatService(db_session, get_settings())
    args = {"court_id": str(court.id), "date": (pkt_today() + timedelta(days=1)).isoformat()}
    assert await service._gate_tool(player, "app", "check_availability", args, [{"role": "user", "content": "hi"}]) is None


async def test_an_hour_without_am_or_pm_makes_the_bot_ask(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    venue, padel, day = await _two_sport_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923091000014")
    player = await make_user("+923091000015", role=UserRole.PLAYER)
    service = AIChatService(db_session, get_settings())
    args = {"court_id": str(padel.id), "date": day.isoformat(), "start_time": "09:00"}
    msgs = [{"role": "user", "content": "Padel kl ki chayie 9 ki"}]
    blocked = await service._gate_tool(player, "whatsapp", "check_availability", args, msgs)
    assert blocked and "morning or evening" in blocked["error"]
    # "9pm" or "aaj raat 9 baje" is clear
    assert await service._gate_tool(player, "whatsapp", "check_availability", {**args, "start_time": "21:00"}, [{"role": "user", "content": "Padel kl 9pm"}]) is None
    # and the proposal for a 9 o'clock slot is held back the same way
    starts = pkt_time_to_utc(day, time(9, 0)).isoformat()
    held_back = await service._gate_tool(player, "whatsapp", "propose_booking_confirmation", {"court_id": str(padel.id), "starts_at": starts, "player_name": "Ali"}, msgs)
    assert held_back and "morning or evening" in held_back["error"]


async def test_isko_book_krdo_does_not_pick_one_of_several_listed_slots(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    venue, padel, day = await _two_sport_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923091000016")
    player = await make_user("+923091000017", role=UserRole.PLAYER, name="Ali")
    service = AIChatService(db_session, get_settings())
    args = {"court_id": str(padel.id), "starts_at": pkt_time_to_utc(day, time(18, 0)).isoformat()}
    listed = {"role": "assistant", "content": "Available: 5:00 PM to 6:00 PM, Sat 10 Oct and 6:00 PM to 7:00 PM, Sat 10 Oct."}
    blocked = await service._gate_tool(player, "app", "propose_booking_confirmation", args, [listed, {"role": "user", "content": "isko book krdo"}])
    assert blocked and "Ask which" in blocked["error"]
    # one listed slot: "book this" is unambiguous
    one = {"role": "assistant", "content": "Available: 6:00 PM to 7:00 PM, Sat 10 Oct."}
    assert await service._gate_tool(player, "app", "propose_booking_confirmation", args, [one, {"role": "user", "content": "isko book krdo"}]) is None
    # naming the slot is fine too
    assert await service._gate_tool(player, "app", "propose_booking_confirmation", args, [listed, {"role": "user", "content": "6 pm wala"}]) is None


# --- 2. no booking proposal while the duration is still being asked -------------------------------------------------------


async def _one_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone):
    owner = await make_user(phone, role=UserRole.OWNER)
    court = await make_court(await make_venue(owner, sports=["padel"]), slot_minutes=60)
    day = pkt_today() + timedelta(days=1)
    for d in range(7):
        await make_schedule(court, day_of_week=d, open_time=time(6, 0), close_time=time(23, 0))
    await make_pricing_rule(court, price_per_slot=3000)
    return court, day


async def test_asking_how_long_does_not_attach_a_yes_button(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    """The production case: 'Kal 9:00 AM to 10:00 AM ... Aap kitni der khelna chahtay hain?' got a Yes/No proposal, so the
    player's 'Yes, book it' held one hour with no duration answered and no summary."""
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    court, day = await _one_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923091000020")
    player = await make_user("+923091000021", role=UserRole.PLAYER, name="Ali")
    _mock_model(monkeypatch, [
        _tool("check_availability", {"court_id": str(court.id), "date": day.isoformat()}),
        _text("Kal 6:00 AM to 7:00 AM ka slot available hai. Aap kitni der khelna chahtay hain? 1 hour, 2 hours?"),
    ])
    result = await AIChatService(db_session, settings).process_message(user=player, message="kal subah 6 baje", history=[])
    assert [a for a in result.actions if a.type == "confirm_booking"] == []


async def test_once_the_duration_is_quoted_the_proposal_carries_it(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    settings = get_settings()
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    court, day = await _one_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923091000022")
    player = await make_user("+923091000023", role=UserRole.PLAYER, name="Ali")
    service = AIChatService(db_session, settings)
    slots = await service._tool_check_availability({"court_id": str(court.id), "date": day.isoformat()})
    first = slots["slots"][0]
    _mock_model(monkeypatch, [
        _tool("check_availability", {"court_id": str(court.id), "date": day.isoformat()}, "t1"),
        _tool("quote_booking", {"court_id": str(court.id), "starts_at": first["starts_at"], "duration_minutes": 120}, "t2"),
        _text(f"{first['label'].split(', ')[0]} for 2 hours is PKR 6,000. Shall I book it? Reply Yes or No"),
    ])
    result = await service.process_message(user=player, message="2 ghante", history=[])
    confirm = next(a for a in result.actions if a.type == "confirm_booking")
    assert confirm.data["slot_count"] == 4  # 2 hours = four 30-minute slots, not the court's one-hour minimum


# --- 3. a past date is never a booking date --------------------------------------------------------------------------------


async def test_a_date_in_the_past_is_refused_by_the_availability_tool(db_session, make_user, make_venue, make_court):
    owner = await make_user("+923091000030", role=UserRole.OWNER)
    court = await make_court(await make_venue(owner, sports=["padel"]))
    service = AIChatService(db_session, get_settings())
    result = await service._execute_tool(owner, "check_availability", {"court_id": str(court.id), "date": "2020-10-03"}, [])
    assert "in the past" in result["error"] and "slots" not in result


async def test_a_start_time_in_the_past_cannot_be_quoted_or_proposed(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule
):
    court, _day = await _one_court(make_user, make_venue, make_court, make_schedule, make_pricing_rule, "+923091000031")
    player = await make_user("+923091000032", role=UserRole.PLAYER, name="Ali")
    service = AIChatService(db_session, get_settings())
    actions: list = []
    past = pkt_time_to_utc(datetime(2020, 10, 3).date(), time(18, 0)).isoformat()
    for tool in ("quote_booking", "propose_booking_confirmation"):
        out = await service._execute_tool(player, tool, {"court_id": str(court.id), "starts_at": past}, actions)
        assert "already passed" in out["error"]
    assert actions == []


# --- 8. reply never sorts before its question ----------------------------------------------------------------------------


async def test_app_chat_history_lists_the_question_before_its_reply(client, make_user, make_auth_headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "ANTHROPIC_API_KEY", "")
    player = await make_user("+923091000040", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    for text in ("first question", "second question"):
        await client.post("/api/v1/chat/message", headers=headers, json={"message": text})
    items = (await client.get("/api/v1/chat/history", headers=headers)).json()
    assert [(i["sender_type"], i["content"] == "first question" or i["content"] == "second question") for i in items] == [
        ("player", True), ("ai", False), ("player", True), ("ai", False),
    ]
    stamps = [i["created_at"] for i in items]
    assert stamps == sorted(stamps) and len(set(stamps)) == 4  # strictly increasing: no two rows share an instant


async def test_rows_that_already_share_a_timestamp_still_list_the_player_first(
    client, db_session_factory, make_user, make_auth_headers
):
    """Rows written before the explicit stamps: question and reply have the same created_at."""
    player = await make_user("+923091000041", role=UserRole.PLAYER)
    headers = await make_auth_headers(player)
    same = datetime.now(timezone.utc) - timedelta(days=3)
    async with db_session_factory() as session:
        # inserted reply-first on purpose
        session.add(Message(sender_id=player.id, sender_type="ai", channel="app", content="the answer", created_at=same))
        session.add(Message(sender_id=player.id, sender_type="player", channel="app", content="the question", created_at=same))
        await session.commit()
    items = (await client.get("/api/v1/chat/history", headers=headers)).json()
    assert [i["content"] for i in items] == ["the question", "the answer"]


async def test_model_history_puts_the_question_before_its_reply(db_session, db_session_factory, make_user):
    player = await make_user("+923091000042", role=UserRole.PLAYER)
    same = datetime.now(timezone.utc) - timedelta(days=1)
    async with db_session_factory() as session:
        session.add(Message(sender_id=player.id, sender_type="ai", channel="app", content="a", created_at=same))
        session.add(Message(sender_id=player.id, sender_type="player", channel="app", content="q", created_at=same))
        await session.commit()
    history = await AIChatService(db_session, get_settings()).load_history(player, "app")
    assert [h["role"] for h in history] == ["user", "assistant"]


# --- 7. the payment-screenshot reply -----------------------------------------------------------------------------------------


def test_payment_replies_have_no_emoji_and_do_not_repeat_themselves():
    for roman in (True, False):
        for verdict in ("match", "mismatch", "unreadable", None):
            for booked in (True, False):
                text = payment_proof_reply(verdict, booked=booked, roman_urdu=roman)
                assert text.isascii(), text  # no emoji, no symbols
                sentences = [s.strip().lower() for s in text.replace("!", ".").split(".") if s.strip()]
                assert len(sentences) == len(set(sentences))
    assert "match nahi" in payment_proof_reply("mismatch", booked=False, roman_urdu=True)
    assert "does not match" in payment_proof_reply("mismatch", booked=False, roman_urdu=False)


def test_roman_urdu_is_recognised_from_the_players_own_messages():
    # the production chat that got an English reply
    assert looks_like_roman_urdu(["Bhai mjhy booking chyaie", "Padel", "Kl ki chayie 9 ki", "Yes, book it"])
    assert not looks_like_roman_urdu(["Is Court A at Test Arena 1 available on Sat, 10 Oct at 6:00 AM for 1 hour?", "Yes"])
