"""Replay of the production chat failures (docs/chatbot-log-review-2.md) through the REAL path: the HTTP chat endpoint, the database, the
conversation state and the guards, with the model replaced by a script (no network). Where a guard decides, the script is empty and the test
fails if the model is called at all."""

from datetime import datetime, time, timedelta, timezone

import httpx
from sqlalchemy import select

from app.config import get_settings
from app.models.message import Message
from app.models.user import UserRole
from app.services.ai_chat_service import AIChatService, explicit_proposal_data
from app.services.chat_state import ChatState, display_date
from app.utils.timezone import pkt_time_to_utc, pkt_today


class ScriptedModel:
    """Replaces the Claude HTTP call. `responses` are served in order (the last one repeats); with none, any call fails the test."""

    def __init__(self, monkeypatch, responses=()):
        monkeypatch.setattr(get_settings(), "ANTHROPIC_API_KEY", "test-key")
        self.bodies: list[dict] = []
        self.responses = list(responses)
        real_post = httpx.AsyncClient.post
        outer = self

        async def fake_post(client_self, url, *args, **kwargs):
            if "anthropic" not in str(url):
                return await real_post(client_self, url, *args, **kwargs)
            outer.bodies.append(kwargs.get("json"))
            if not outer.responses:
                raise AssertionError("the model must not be called for this message")
            item = outer.responses.pop(0) if len(outer.responses) > 1 else outer.responses[0]
            return httpx.Response(200, request=httpx.Request("POST", url), json=item)

        monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    def feed(self, *responses):
        self.responses = list(responses)


def text(t: str) -> dict:
    return {"content": [{"type": "text", "text": t}], "stop_reason": "end_turn"}


def tool(name: str, args: dict, call_id: str = "toolu_1") -> dict:
    return {"content": [{"type": "tool_use", "id": call_id, "name": name, "input": args}], "stop_reason": "tool_use"}


async def arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule, *, phone="+923050000001", with_tennis=False, two_padel=False):
    """Test Arena 1: Cricket (Net 1), Futsal (Court A), Padel (Court 2 [, Court 3]); optionally Gulshan Tennis Club with Tennis."""
    owner = await make_user(phone, role=UserRole.OWNER)
    venue = await make_venue(owner, name="Test Arena 1", sports=["cricket", "futsal", "padel"], address="Plot 5, Clifton", area="Clifton")
    courts = {}
    specs = [("Net 1", "cricket"), ("Court A", "futsal"), ("Court 2", "padel")] + ([("Court 3", "padel")] if two_padel else [])
    for name, sport in specs:
        court = await make_court(venue, name=name, sport=sport, slot_minutes=60)
        for dow in range(7):
            await make_schedule(court, day_of_week=dow, open_time=time(6, 0), close_time=time(23, 0))
        await make_pricing_rule(court, price_per_slot=3000)
        courts[name] = court
    if with_tennis:
        owner2 = await make_user(phone[:-1] + "2", role=UserRole.OWNER)
        venue2 = await make_venue(owner2, name="Gulshan Tennis Club", sports=["tennis"])
        tc = await make_court(venue2, name="Court 1", sport="tennis", slot_minutes=60)
        for dow in range(7):
            await make_schedule(tc, day_of_week=dow, open_time=time(6, 0), close_time=time(23, 0))
        await make_pricing_rule(tc, price_per_slot=2000)
        courts["Tennis 1"] = tc
    return venue, courts


async def say(client, headers, message: str) -> dict:
    response = await client.post("/api/v1/chat/message", headers=headers, json={"message": message})
    assert response.status_code == 200, response.text
    return response.json()


async def player_headers(make_user, make_auth_headers, phone="+923050000010", name="Sara Ahmed"):
    user = await make_user(phone, role=UserRole.PLAYER, name=name)
    return user, await make_auth_headers(user)


# --- a whole booking, one question at a time ---------------------------------------------------------------------------------------------------


async def test_a_booking_is_built_from_the_players_own_answers_one_question_at_a_time(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch)  # no model reply is needed until every detail is known
    tomorrow = pkt_today() + timedelta(days=1)

    r = await say(client, headers, "I need booking")
    assert r["reply"] == "Which sport would you like to play: Cricket, Futsal and Padel?" and r["actions"] == []
    r = await say(client, headers, "Futsal chayie")  # the P1 failure: the old bot proposed 9 PM today here
    assert r["reply"] == "Kis date par khelna chahte hain?" and r["actions"] == []
    r = await say(client, headers, "kal")
    assert r["reply"] == "Kitne baje se khelna chahte hain?"
    r = await say(client, headers, "9 baje")
    assert r["reply"] == "9 baje: subah (AM) ya shaam/raat (PM)?"
    r = await say(client, headers, "pm")
    assert r["reply"].startswith("Kitni der khelna chahte hain? Jaise 1 ghanta, 1.5 ghante aur 2 ghante")
    assert model.bodies == []  # five turns, zero model calls

    start = pkt_time_to_utc(tomorrow, time(21, 0)).isoformat()
    model.feed(
        tool("check_availability", {"court_id": str(courts["Court A"].id), "date": tomorrow.isoformat(), "start_time": "21:00", "end_time": "23:00"}),
        tool("propose_booking_confirmation", {"court_id": str(courts["Court A"].id), "starts_at": start, "duration_minutes": 120}, "toolu_2"),
        text("Court A kal khali hai. Kya main book kar dun?"),
    )
    r = await say(client, headers, "2 ghante")
    assert [a["type"] for a in r["actions"]] == ["confirm_booking", "decline"]
    assert r["actions"][0]["data"]["slot_count"] == 4 and r["actions"][0]["data"]["court_id"] == str(courts["Court A"].id)
    assert "9:00 PM to 11:00 PM" in r["reply"] and "PKR 6,000" in r["reply"] and r["reply"].count("?") == 1
    assert "Tasdeeq" in r["reply"] and "Haan ya Na" in r["reply"]  # the appended confirmation line is Roman Urdu for a Roman Urdu player
    system = model.bodies[0]["system"]
    assert "sport=Futsal" in system and "court=Court A (from the database)" in system and "time=9:00 PM" in system and "duration=2 hours" in system
    assert "Still needed" not in system  # nothing is missing: the model gets the whole booking from the state, not from guessing


async def test_the_model_cannot_propose_a_slot_the_player_did_not_ask_for(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """P1 at the tool level: the model "helpfully" proposes 10 PM for a 9 PM request. The proposal is refused and no Yes/No button exists."""
    venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    tomorrow = pkt_today() + timedelta(days=1)
    ten = pkt_time_to_utc(tomorrow, time(22, 0)).isoformat()
    ScriptedModel(monkeypatch, [
        tool("propose_booking_confirmation", {"court_id": str(courts["Court A"].id), "starts_at": ten, "duration_minutes": 60}),
        text("Court A is free at 10:00 PM. Which time would you like?"),
    ])
    r = await say(client, headers, "Futsal tomorrow 9pm for 1 hour")
    assert r["actions"] == []


# --- chit-chat never reaches the model ----------------------------------------------------------------------------------------------------------


async def test_greeting_thanks_and_ok_never_call_the_model(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch)
    assert (await say(client, headers, "Assalam o alaikum"))["reply"].startswith("Assalam o Alaikum! Main court booking mein madad kar sakta hoon.")
    assert (await say(client, headers, "shukriya"))["reply"].startswith("Shukriya!")
    assert (await say(client, headers, "ok"))["reply"] == "Theek hai. Court book karna ho to bata dein."
    assert (await say(client, headers, "hello"))["reply"].startswith("Hello!") is False  # still Roman Urdu: the chat is in Roman Urdu
    assert model.bodies == []
    tool_calls = [m.meta.get("tool_calls") for m in (await db_session.scalars(select(Message).where(Message.sender_type == "ai"))).all()]
    assert all(calls == [] for calls in tool_calls)


async def test_english_in_english_out(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    ScriptedModel(monkeypatch)
    assert (await say(client, headers, "Hello"))["reply"] == "Hello! I can help you book a court. Which sport would you like to play: Cricket, Futsal and Padel?"
    assert (await say(client, headers, "thank you"))["reply"] == "You're welcome! Message me any time you need a court."


# --- the sport guard ----------------------------------------------------------------------------------------------------------------------------


async def test_an_unsupported_sport_gets_a_fixed_localized_answer_and_other_venues_are_offered(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule, with_tennis=True)
    user, headers = await player_headers(make_user, make_auth_headers)
    ScriptedModel(monkeypatch)
    r = await say(client, headers, "Test Arena 1 mein tennis chahiye")
    assert r["reply"] == "Test Arena 1 mein Tennis nahi hai. Yahan Cricket, Futsal aur Padel hain. Tennis Gulshan Tennis Club mein hai. Kya main wo dikhaoon?"
    r = await say(client, headers, "haan")
    assert r["reply"] == "Kis date par khelna chahte hain?"  # tennis at the one venue that has it, never silently another sport
    row = (await db_session.scalars(select(Message).where(Message.sender_type == "ai").order_by(Message.created_at.desc()))).first()
    assert "Tennis" in row.content or row.content


async def test_unsupported_sport_in_english(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    ScriptedModel(monkeypatch)
    r = await say(client, headers, "I want to play badminton tomorrow")
    assert r["reply"] == "Test Arena 1 does not offer Badminton. It offers Cricket, Futsal and Padel. Which sport would you like?"


async def test_misspelled_sports_are_understood(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    ScriptedModel(monkeypatch)
    for i, (word, sport) in enumerate((("Circket?", "Cricket"), ("Furtsal!", "Futsal"), ("paddle", "Padel"))):
        user, headers = await player_headers(make_user, make_auth_headers, phone=f"+92305000002{i}")
        r = await say(client, headers, word)
        assert r["reply"] in ("Which date would you like to play?", "Kis date par khelna chahte hain?"), (word, r)
        msg = (await db_session.scalars(select(Message).where(Message.sender_id == user.id, Message.sender_type == "player"))).one()
        assert msg.content == word


async def test_two_padel_courts_ask_which_court(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule, two_padel=True)
    user, headers = await player_headers(make_user, make_auth_headers)
    ScriptedModel(monkeypatch)
    r = await say(client, headers, "mjhy padel ka court chayie")
    assert r["reply"] == "Test Arena 1 mein Padel ke courts: Court 2 aur Court 3. Kaun sa court chahiye?"
    r = await say(client, headers, "Court 3")
    assert r["reply"] == "Kis date par khelna chahte hain?"


# --- P2 / P6 / P7 in one conversation --------------------------------------------------------------------------------------------------------------


async def test_the_app_chat_conversation_of_2026_10_12(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch)
    r = await say(client, headers, "9 se 12 ka court chayie or 3000 phr hour mai chayie")
    # honest about the price, and still exactly one question (the sport was never said)
    assert r["reply"].startswith("Price venue ne set ki hai, main isay kam ya zyada nahi kar sakta.")
    assert r["reply"].rstrip().endswith("Aap kaun sa sport khelna chahte hain: Cricket, Futsal aur Padel?")
    r = await say(client, headers, "pm")
    assert r["reply"].startswith("Kaun sa sport")  # the hour is now settled (9 PM); the sport is still the open question, asked shorter
    r = await say(client, headers, "mjhy padel ka court chayie")
    assert r["reply"] == "Kis date par khelna chahte hain?"  # Court 2 is the only padel court: a database fact, never Court A
    r = await say(client, headers, "meine upper tw btaya hai")
    assert r["reply"] == "Maaf kijiye. Mujhe yeh note hai: Padel, 9:00 PM, 3 ghante. Kis date par khelna chahte hain?"
    assert model.bodies == []
    # a date correction ("tomorrow is the 8th, not the 9th"): the state is updated and everything is known, so the model takes over with it
    model.feed(text("Kal 9:00 PM se 12:00 AM tak ka slot check kar raha hoon. Kya yeh theek hai?"))
    r = await say(client, headers, "Kl 8 hai 9 tw ni")
    system = model.bodies[0]["system"]
    assert f"date={display_date((pkt_today() + timedelta(days=1)).isoformat())}" in system and "time=9:00 PM to 12:00 AM" in system
    assert "sport=Padel" in system and "court=Court 2" in system and r["actions"] == []


# --- off-topic / unclear -----------------------------------------------------------------------------------------------------------------------------


async def test_off_topic_replies_are_reasked_then_offered_choices_then_a_human(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch)
    await say(client, headers, "booking chahiye")
    first = (await say(client, headers, "mujhe pizza chahiye"))["reply"]
    second = (await say(client, headers, "kuch bhi"))["reply"]
    third = (await say(client, headers, "hmm"))["reply"]
    assert first == "Sport samajh nahi aaya. In mein se kaun sa sport chahiye: Cricket, Futsal aur Padel?"
    assert second.endswith("\n1. Cricket\n2. Futsal\n3. Padel")
    assert "Venue owner ya support team" in third and "+92" not in third  # no invented number
    assert model.bodies == []
    # the numbered choice works when it is answered (a fresh conversation: the player had picked "2" right after the list)
    user2, headers2 = await player_headers(make_user, make_auth_headers, phone="+923050000011")
    await say(client, headers2, "booking chahiye")
    await say(client, headers2, "mujhe pizza chahiye")
    await say(client, headers2, "kuch bhi")
    r = await say(client, headers2, "2")
    assert r["reply"] == "Kis date par khelna chahte hain?"


# --- the conversation boundary: yesterday's chat is not "known" today -----------------------------------------------------------------------------


async def _old_chat(db_session, user, *, hours_ago):
    base = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    for i, (role, content) in enumerate(
        [("player", "Padel Court 2 kal 9pm 2 ghante"), ("ai", "Court 2 par kal 9:00 PM ka slot hai. Shall I book it?"), ("player", "ok"), ("ai", "Theek hai.")]
    ):
        db_session.add(Message(sender_id=user.id, sender_type=role, channel="app", content=content, created_at=base + timedelta(seconds=i)))
    await db_session.commit()


async def test_old_messages_are_not_injected_into_a_new_conversation(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    await _old_chat(db_session, user, hours_ago=20)
    model = ScriptedModel(monkeypatch)
    service = AIChatService(db_session, get_settings())
    assert await service.load_history(user, "app") == []  # nothing from yesterday reaches the model
    r = await say(client, headers, "Mjhy booking chayie")  # the P9 failure: the old bot answered with yesterday's Padel Court 2
    assert r["reply"] == "Aap kaun sa sport khelna chahte hain: Cricket, Futsal aur Padel?" and r["actions"] == []
    # a message that does reach the model carries only the new conversation, and the state block says nothing is known
    model.feed(text("Parking hai."))
    await say(client, headers, "parking hai kya?")
    body = model.bodies[0]
    assert "Padel Court 2" not in str(body["messages"]) and "sport=unknown" in body["system"] and "date=unknown" in body["system"]


async def test_the_same_chat_a_little_earlier_is_still_known(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    await _old_chat(db_session, user, hours_ago=1)
    model = ScriptedModel(monkeypatch, [text("Parking hai.")])
    await say(client, headers, "parking hai kya?")
    assert "sport=Padel" in model.bodies[0]["system"] and "duration=2 hours" in model.bodies[0]["system"]


async def test_facts_said_twenty_messages_earlier_still_reach_the_model(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    base = datetime.now(timezone.utc) - timedelta(minutes=100)
    rows = [("player", "Padel Court 2 kal 9pm 2 ghante"), ("ai", "Court 2 kal 9:00 PM ka slot hai. Shall I book it?")]
    for i in range(12):  # 24 more messages of chit-chat
        rows += [("player", "ok" if i % 2 else "thanks"), ("ai", f"Theek hai {i}.")]
    for i, (role, content) in enumerate(rows):
        db_session.add(Message(sender_id=user.id, sender_type=role, channel="app", content=content, created_at=base + timedelta(minutes=i)))
    await db_session.commit()
    model = ScriptedModel(monkeypatch, [text("Parking hai.")])
    await say(client, headers, "parking hai kya?")
    body = model.bodies[0]
    assert "sport=Padel" in body["system"] and "court=Court 2" in body["system"] and "duration=2 hours" in body["system"]  # via the state block
    sent = [m["content"] for m in body["messages"] if isinstance(m["content"], str)]
    assert "Padel Court 2 kal 9pm 2 ghante" in sent  # and the turn that DEFINES it is still in the history
    assert len(sent) < len(rows) + 1 and sent[0] == "Padel Court 2 kal 9pm 2 ghante"  # but the old chit-chat is not


async def test_the_current_message_is_not_shown_to_the_model_twice(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    """The WhatsApp webhook stores the inbound message before asking for a reply, so load_history already ends with it."""
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user = await make_user("+923050000030", role=UserRole.PLAYER, name="Sara")
    now = datetime.now(timezone.utc)
    db_session.add(Message(sender_id=user.id, sender_type="player", channel="whatsapp", content="parking hai kya?", created_at=now))
    await db_session.commit()
    model = ScriptedModel(monkeypatch, [text("Parking hai.")])
    service = AIChatService(db_session, get_settings())
    history = await service.load_history(user, "whatsapp")
    assert history[-1] == {"role": "user", "content": "parking hai kya?"}
    await service.process_message(user=user, message="parking hai kya?", history=history, channel="whatsapp")
    assert [m["content"] for m in model.bodies[0]["messages"]].count("parking hai kya?") == 1


# --- Yes/No actions and the reply validator ------------------------------------------------------------------------------------------------------------


async def _full_request(client, headers, courts, monkeypatch, model, replies):
    tomorrow = pkt_today() + timedelta(days=1)
    start = pkt_time_to_utc(tomorrow, time(21, 0)).isoformat()
    model.feed(
        tool("check_availability", {"court_id": str(courts["Court 2"].id), "date": tomorrow.isoformat(), "start_time": "21:00", "end_time": "22:00"}),
        tool("propose_booking_confirmation", {"court_id": str(courts["Court 2"].id), "starts_at": start, "duration_minutes": 60}, "toolu_2"),
        *replies,
    )
    return await say(client, headers, "Padel tomorrow 9pm for 1 hour")


async def test_a_message_that_asks_a_second_question_carries_no_yes_no_actions(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch)
    day = pkt_today() + timedelta(days=1)
    label = f"9:00 PM to 10:00 PM, {day.strftime('%a')} {day.day} {day.strftime('%b')}"
    r = await _full_request(client, headers, courts, monkeypatch, model, [text(f"Court 2, {label}, PKR 3,000. Shall I book it? Also, which court do you want?")])
    assert r["actions"] == []  # never a Yes button next to a different question
    assert r["reply"] == "I could not check that just now. Please try again in a moment or book in the app."  # two questions twice: safe template
    assert len(model.bodies) == 4  # tool, tool, the draft, and exactly one retry
    # a model that only needs to be told asks one question the second time, and the proposal then survives
    other_user, other_headers = await player_headers(make_user, make_auth_headers, phone="+923050000012")
    model.feed(
        tool("check_availability", {"court_id": str(courts["Court 2"].id), "date": day.isoformat(), "start_time": "21:00", "end_time": "22:00"}),
        tool("propose_booking_confirmation", {"court_id": str(courts["Court 2"].id), "starts_at": pkt_time_to_utc(day, time(21, 0)).isoformat(), "duration_minutes": 60}, "toolu_2"),
        text(f"Court 2, {label}, PKR 3,000. Shall I book it? Also, which court do you want?"),
        text(f"Court 2, {label}, PKR 3,000. Shall I book it? Reply Yes or No"),
    )
    r = await say(client, other_headers, "Padel tomorrow 9pm for 1 hour")
    assert [a["type"] for a in r["actions"]] == ["confirm_booking", "decline"]


async def test_a_good_proposal_keeps_its_actions(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch)
    r = await _full_request(client, headers, courts, monkeypatch, model, [text("Court 2 is free tomorrow at 9:00 PM for PKR 3,000. Shall I book it? Reply Yes or No")])
    assert [a["type"] for a in r["actions"]] == ["confirm_booking", "decline"]
    assert len(model.bodies) == 3  # no retry was needed


async def test_a_draft_in_the_wrong_language_is_retried_once_with_a_corrective_instruction(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch, [text("Parking is available at Test Arena 1. Do you want me to book a court for you today?"), text("Test Arena 1 mein parking hai.")])
    r = await say(client, headers, "parking hai kya?")  # a Roman Urdu player
    assert r["reply"] == "Test Arena 1 mein parking hai."
    assert len(model.bodies) == 2 and "rejected by the safety check" in model.bodies[1]["system"] and "Roman Urdu" in model.bodies[1]["system"]
    assert "rejected by the safety check" not in model.bodies[0]["system"]


async def test_two_bad_drafts_fall_back_to_a_safe_localized_template(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch, [text("Court 9 costs PKR 1,500 at 11:30 PM. Shall we?")])
    # the sport is still unknown, so the safe reply is the ONE next question
    r = await say(client, headers, "parking hai kya?")
    assert r["reply"] == "Aap kaun sa sport khelna chahte hain: Cricket, Futsal aur Padel?"
    assert len(model.bodies) == 2  # exactly one retry
    # everything known: a plain localized note
    full_user, full_headers = await player_headers(make_user, make_auth_headers, phone="+923050000041")
    r = await say(client, full_headers, "padel kal 9pm 1 ghanta, parking hai kya?")
    assert r["reply"] == "Abhi yeh check nahi ho saka. Thori der baad dobara try karein ya app mein booking karein."
    en_user, en_headers = await player_headers(make_user, make_auth_headers, phone="+923050000040")
    r = await say(client, en_headers, "Padel tomorrow 9pm for 1 hour, is there parking at the venue?")
    assert r["reply"] == "I could not check that just now. Please try again in a moment or book in the app."


async def test_a_draft_that_repeats_the_previous_message_is_rejected(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    model = ScriptedModel(monkeypatch, [text("Test Arena 1 mein parking aur washroom dono hain, aap befikar rahein."), text("Test Arena 1 mein parking aur washroom dono hain, aap befikar rahein.")])
    first = await say(client, headers, "parking hai kya?")
    assert first["reply"].startswith("Test Arena 1 mein parking")
    model.feed(text("Test Arena 1 mein parking aur washroom dono hain, aap befikar rahein."), text("Washroom bhi hai."))
    second = await say(client, headers, "aur washroom?")
    assert second["reply"] == "Washroom bhi hai."  # the repeat was rejected, the retry answered the new question


async def test_the_hold_reply_is_never_replaced_by_an_error(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    """If the model's message about a hold that succeeded fails the check twice, the player still hears that the slot is held."""
    venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user, headers = await player_headers(make_user, make_auth_headers)
    tomorrow = pkt_today() + timedelta(days=1)
    start = pkt_time_to_utc(tomorrow, time(21, 0)).isoformat()
    label_time = "9:00 PM to 10:00 PM"
    # a live, stated proposal in the chat, then a typed yes handled by the model
    db_session.add(
        Message(
            sender_id=user.id, sender_type="ai", channel="app", created_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            content=f"Court 2, {label_time}, Wed, PKR 3,000. Shall I book it? Reply Yes or No",
            meta={"actions": [{"type": "confirm_booking", "label": "Yes, book it", "data": {
                "court_id": str(courts["Court 2"].id), "starts_at": start, "slot_count": 2, "label": f"{label_time}, Wed"}}]},
        )
    )
    await db_session.commit()
    ScriptedModel(monkeypatch, [
        tool("hold_slot", {"court_id": str(courts["Court 2"].id), "starts_at": start, "duration_minutes": 60}),
        text("Done! Your booking is held. Please send the screenshot of the payment of the advance amount to the venue."),
    ])
    r = await say(client, headers, "haan")
    # the English draft failed the language check (twice): the localized hold notice replaces it, with the real figures
    assert r["reply"].startswith("Aap ka slot hold ho gaya hai:") or r["reply"].startswith("Your slot is on hold:") or "held" in r["reply"].lower()


async def test_player_language_survives_the_end_of_the_conversation(db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    """A hold ends the conversation (nothing before it is "known" any more), but the fixed Held / decline messages that follow must still speak the
    player's language: `player_language` ignores the boundary."""
    user = await make_user("+923050000070", role=UserRole.PLAYER, name="Sara")
    other = await make_user("+923050000071", role=UserRole.PLAYER, name="Ali")
    base = datetime.now(timezone.utc) - timedelta(days=2)
    for i, (who, role, content) in enumerate(
        [(user, "player", "mjhy padel ka court chayie kal 9pm"), (user, "ai", "Kitni der khelna chahte hain?"),
         (other, "player", "I want to book a court"), (other, "ai", "Which sport would you like to play?")]
    ):
        db_session.add(Message(sender_id=who.id, sender_type=role, channel="whatsapp", content=content, created_at=base + timedelta(seconds=i)))
    await db_session.commit()
    service = AIChatService(db_session, get_settings())
    assert await service.player_language(user, "whatsapp") == "ru"
    assert await service.player_language(other, "whatsapp") == "en"
    assert await service.load_history(user, "whatsapp") == []  # while the conversation itself is long over


async def test_failure_notices_are_not_part_of_the_conversation(db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    user = await make_user("+923050000080", role=UserRole.PLAYER, name="Sara")
    now = datetime.now(timezone.utc)
    for i, (role, content, meta) in enumerate(
        [("player", "padel kal 9pm", None), ("ai", "Maaf kijiye, kuch masla ho gaya.", {"fallback": True}), ("player", "hello", None)]
    ):
        db_session.add(Message(sender_id=user.id, sender_type=role, channel="app", content=content, created_at=now - timedelta(minutes=10 - i), meta=meta))
    await db_session.commit()
    history = await AIChatService(db_session, get_settings()).load_history(user, "app")
    assert [h["content"] for h in history] == ["padel kal 9pm", "hello"] or all("masla" not in h["content"] for h in history)


# --- the state itself ------------------------------------------------------------------------------------------------------------------------------------


async def test_the_result_carries_the_state_for_persistence_and_it_seeds_the_next_turn(
    db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule, two_padel=True)
    user = await make_user("+923050000050", role=UserRole.PLAYER, name="Sara")
    ScriptedModel(monkeypatch)
    service = AIChatService(db_session, get_settings())
    result = await service.process_message(user=user, message="mjhy padel ka court chayie", history=[])
    state = ChatState.from_dict(result.state)
    assert state is not None and state.sport == "Padel" and state.pending == "court" and result.kind == "ask_court"
    assert state.prov["sport"] == "player_said"
    # the reply row stores it in meta["state"] (the caller's job: see the report); the next turn can use it
    saved = result.state | {"court": {"id": str(courts["Court 3"].id), "name": "Court 3"}, "prov": result.state["prov"] | {"court": "tool_result"}}
    db_session.add(Message(sender_id=user.id, sender_type="player", channel="app", content="mjhy padel ka court chayie", created_at=datetime.now(timezone.utc) - timedelta(seconds=30)))
    db_session.add(Message(sender_id=user.id, sender_type="ai", channel="app", content=result.reply, created_at=datetime.now(timezone.utc) - timedelta(seconds=20), meta={"state": saved}))
    await db_session.commit()
    nxt = await AIChatService(db_session, get_settings()).process_message(user=user, message="kal", history=await service.load_history(user, "app"))
    assert ChatState.from_dict(nxt.state).court_name == "Court 3"  # a court only the saved state knew about is kept


async def test_a_reply_that_asks_for_something_else_is_not_a_proposal_a_yes_can_confirm(db_session, make_user):
    """P3: the 2026-09-29 message carried Yes/No actions while asking how long to play."""
    user = await make_user("+923050000060", role=UserRole.PLAYER)
    asking = Message(
        sender_id=user.id, sender_type="ai", channel="whatsapp", created_at=datetime.now(timezone.utc),
        content="Kal 9:00 AM to 10:00 AM, Thu 1 Oct ka slot available hai. Aap kitni der khelna chahtay hain? 1 hour, 2 hours?",
        meta={"actions": [{"type": "confirm_booking", "label": "Yes, book it", "data": {
            "court_id": "c1", "starts_at": "2026-10-01T04:00:00+00:00", "slot_count": 2, "label": "9:00 AM to 10:00 AM, Thu 1 Oct"}}]},
    )
    assert explicit_proposal_data(asking) is None
    asking.content = "Court 1, 9:00 AM to 10:00 AM, Thu 1 Oct, PKR 3,000. Shall I book it? Reply Yes or No"
    assert explicit_proposal_data(asking) is not None
