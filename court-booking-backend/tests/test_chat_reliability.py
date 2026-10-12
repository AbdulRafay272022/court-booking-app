"""Khelo Phase 3, Agent E: the chat must never glitch.

Covers P5 (fixed messages in the player's language: Held, decline, hold failed, image replies, fallbacks, button titles) and P10
(reliability): duplicate deliveries, two quick messages from one player, stale replies, model timeout/exception/tool failure,
no raw error text, ordered in-app chat. No live model is ever called: `AIChatService.process_message` is replaced by a
controllable fake, or the Claude HTTP call is mocked.
"""

import asyncio
import re
from datetime import date, datetime, time, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select

from app.config import get_settings
from app.models.booking import Booking, BookingStatus
from app.models.message import Message
from app.models.user import User, UserRole
from app.services import chat_fallbacks, chat_lock, reply_text
from app.services.ai_chat_service import AIChatService, ChatAction, ChatResult
from app.services.chat_lock import ConversationBusy, ConversationLocks, conversation_locks
from tests.test_webhooks import _button_payload, _image_payload, _mock_whatsapp_send, _proposal_setup, _text_payload

WEBHOOK = "/api/v1/webhooks/whatsapp"
ROMAN_URDU_TEXTS = ["mjhy kal ka slot chahiye", "bhai 9 baje ka dekho"]
ENGLISH_TEXTS = ["I want to book a court for tomorrow", "please check 9 pm for me"]

# ---------------------------------------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------------------------------------

_EMOJI = re.compile("[\U0001f000-\U0001faff☀-➿⬀-⯿️‍✅⚠]")
_TIME_TOKEN = re.compile(r"\b\d{1,2}:\d{2}\b(?!\s*[AP]M)")  # a clock time that is NOT followed by AM/PM = 24-hour


def assert_plain(text: str) -> None:
    """No emoji, no markdown, no 24-hour clock time, no UTC, no internals."""
    assert not _EMOJI.search(text), text
    assert "**" not in text and "__" not in text and "`" not in text and "#" not in text, text
    assert not _TIME_TOKEN.search(text), text
    assert "UTC" not in text, text
    assert not chat_fallbacks.leaks_internals(text), text


async def wait_until(condition, timeout: float = 10.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        if await condition():
            return
        assert asyncio.get_running_loop().time() < deadline, "condition not reached in time"
        await asyncio.sleep(0.02)


async def seed_player_texts(db_session_factory, user: User, texts: list[str], channel: str = "whatsapp") -> None:
    base = datetime.now(timezone.utc) - timedelta(minutes=10)
    async with db_session_factory() as session:
        for i, text in enumerate(texts):
            session.add(
                Message(
                    sender_id=user.id,
                    sender_type="player",
                    channel=channel,
                    content=text,
                    message_type="text",
                    created_at=base + timedelta(seconds=i),
                )
            )
        await session.commit()


async def messages_of(db_session, phone: str, sender_type: str | None = None) -> list[Message]:
    user = await db_session.scalar(select(User).where(User.phone == phone))
    query = select(Message).where(Message.sender_id == user.id).order_by(Message.created_at, Message.sender_type.desc())
    if sender_type:
        query = query.where(Message.sender_type == sender_type)
    return list((await db_session.execute(query)).scalars().all())


class FakeModel:
    """Replaces AIChatService.process_message. Records every call, can hold a call open until released, add a delay, or fail."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.entered: dict[str, asyncio.Event] = {}
        self.gates: dict[str, asyncio.Event] = {}
        self.tool_calls: dict[str, list[str]] = {}
        self.delay = 0.0
        self.raises: Exception | None = None
        self.reply_for: dict[str, str] = {}
        self.sleep_forever = False

    def event(self, message: str) -> asyncio.Event:
        return self.entered.setdefault(message, asyncio.Event())

    def gate(self, message: str) -> None:
        self.gates[message] = asyncio.Event()

    def release(self, message: str) -> None:
        self.gates[message].set()

    async def process(self, svc, *, user, message, history=None, channel="app"):
        self.calls.append({"message": message, "history": list(history or []), "channel": channel})
        self.event(message).set()
        if self.delay:
            await asyncio.sleep(self.delay)
        if message in self.gates:
            await self.gates[message].wait()
        if self.sleep_forever:
            await asyncio.sleep(3600)
        if self.raises is not None:
            raise self.raises
        return ChatResult(reply=self.reply_for.get(message, f"reply to {message}"), model="routine", tool_calls=self.tool_calls.get(message, []))


@pytest.fixture
def fake_model(monkeypatch) -> FakeModel:
    fake = FakeModel()

    async def process_message(self, *, user, message, history=None, channel="app"):
        return await fake.process(self, user=user, message=message, history=history, channel=channel)

    monkeypatch.setattr("app.services.ai_chat_service.AIChatService.process_message", process_message)
    return fake


@pytest.fixture(autouse=True)
def _registry_is_clean_afterwards():
    yield
    assert len(conversation_locks) == 0, "a conversation lock leaked"


# ---------------------------------------------------------------------------------------------------------------------------
# P5: every template, both languages
# ---------------------------------------------------------------------------------------------------------------------------


def _every_template(lang: str) -> dict[str, str]:
    t = reply_text
    return {
        "held": t.held_message(
            lang,
            where=t.held_where(lang, "Court 1", "Maidan Court"),
            slot_label="9:00 PM to 10:30 PM, Tue 22 Sep",
            total=3500,
            duration_minutes=90,
            advance=1000,
            hold_minutes=15,
            bank_lines=[("Bank", "HBL"), ("Account title", "Maidan Court"), ("Account number", "1234567890")],
        ),
        "declined": t.declined_message(lang),
        "hold_failed_default": t.hold_failed_message(lang),
        "hold_failed_taken": t.hold_failed_message(lang, "SLOT_ALREADY_TAKEN"),
        "hold_failed_chat_off": t.hold_failed_message(lang, "PREMIUM_FEATURE_REQUIRED"),
        "generic_failure": t.generic_failure(lang),
        "busy": t.busy_message(lang),
        "handoff": t.handoff_message(lang),
        "trouble": t.trouble_message(lang),
        "no_pending": t.no_pending_booking_message(lang),
        "image_failed": t.image_download_failed_message(lang),
        **{f"proof_{v}_{b}": t.payment_proof_reply(v, booked=b, roman_urdu=lang == "ru") for v in ("match", "mismatch", "unreadable", None) for b in (True, False)},
    }


@pytest.mark.parametrize("lang", ["ru", "en"])
def test_every_template_is_plain_text_in_both_languages(lang):
    for name, text in _every_template(lang).items():
        assert text.strip(), name
        assert_plain(text)


def test_templates_differ_between_languages_and_titles_fit_whatsapp():
    ru, en = _every_template("ru"), _every_template("en")
    for name in ru:
        assert ru[name] != en[name], name
    for lang in ("ru", "en"):
        assert len(reply_text.confirm_button_title(lang)) <= 20 and len(reply_text.decline_button_title(lang)) <= 20
    assert reply_text.confirm_button_title("en") == "Yes, book it" and reply_text.decline_button_title("en") == "No, thanks"


def test_held_message_keeps_every_fact_in_both_languages():
    for lang in ("ru", "en"):
        text = _every_template(lang)["held"]
        for fact in ("Court 1", "Maidan Court", "9:00 PM to 10:30 PM, Tue 22 Sep", "PKR 3,500", "PKR 1,000", "15", "HBL", "Account title: Maidan Court", "Account number: 1234567890"):
            assert fact in text, (lang, fact)
    assert _every_template("ru")["held"].startswith("Slot hold ho gaya!")
    assert _every_template("en")["held"].startswith("Held!")
    assert "1.5 ghante" in _every_template("ru")["held"] and "1.5 hours" in _every_template("en")["held"]


def test_known_english_fallbacks_are_localized_and_other_text_is_left_alone():
    assert reply_text.localize_known_reply(reply_text.handoff_message("en"), "ru") == reply_text.handoff_message("ru")
    assert reply_text.localize_known_reply(reply_text.trouble_message("en"), "ru") == reply_text.trouble_message("ru")
    assert reply_text.localize_known_reply("Court A is free at 9:00 PM.", "ru") == "Court A is free at 9:00 PM."
    assert reply_text.localize_button_title("Yes, book it", "ru") == "Haan, book karein"
    assert reply_text.localize_button_title("Something else", "ru") == "Something else"


async def _held_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone):
    player, court, starts_at = await _proposal_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone)
    return player, f"confirm:{court.id}:{starts_at}"


@pytest.mark.parametrize(
    "texts,first_words,advance_words",
    [(ROMAN_URDU_TEXTS, "Slot hold ho gaya!", "minute ke andar"), (ENGLISH_TEXTS, "Held!", "within 15 minutes")],
)
async def test_held_reply_follows_the_players_language(
    client, db_session, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch, texts, first_words, advance_words
):
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "+923020000401" if texts is ROMAN_URDU_TEXTS else "+923020000402"
    player, button_id = await _held_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone)
    await seed_player_texts(db_session_factory, player, texts)

    assert (await client.post(WEBHOOK, json=_button_payload(phone.lstrip("+"), f"wamid.held.{phone}", button_id))).status_code == 200

    body = sent[-1]["body"]
    assert body.startswith(first_words) and advance_words in body
    assert "9:00 PM to 10:30 PM" in body and "Maidan Court" in body and "PKR 3,500" in body
    assert "HBL" in body and "1234567890" in body
    assert_plain(body)
    booking = await db_session.scalar(select(Booking).where(Booking.player_id == player.id))
    assert booking is not None and booking.status == BookingStatus.HELD


@pytest.mark.parametrize("texts,expected", [(ROMAN_URDU_TEXTS, "koi masla nahi"), (ENGLISH_TEXTS, "no problem")])
async def test_decline_follows_the_players_language(client, db_session_factory, make_user, monkeypatch, texts, expected):
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "+923020000403" if texts is ROMAN_URDU_TEXTS else "+923020000404"
    player = await make_user(phone)
    await seed_player_texts(db_session_factory, player, texts)
    await client.post(WEBHOOK, json=_button_payload(phone.lstrip("+"), f"wamid.dec.{phone}", "decline"))
    assert expected in sent[-1]["body"].lower()
    assert_plain(sent[-1]["body"])


async def test_hold_failure_is_localized_and_never_shows_the_raw_reason(
    client, db_session_factory, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "+923020000405"
    player, court, _starts_at = await _proposal_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone)
    await seed_player_texts(db_session_factory, player, ROMAN_URDU_TEXTS)
    # a slot in the past: the booking service refuses it with an English technical message
    past = f"confirm:{court.id}:2020-01-01T10:00:00+00:00"
    await client.post(WEBHOOK, json=_button_payload(phone.lstrip("+"), "wamid.fail.1", past))
    body = sent[-1]["body"]
    assert body == reply_text.hold_failed_message("ru")
    assert "must be" not in body and "Court not found" not in body and "(" not in body
    # a garbage id also never leaks ValueError text
    await client.post(WEBHOOK, json=_button_payload(phone.lstrip("+"), "wamid.fail.2", "confirm:not-a-uuid:garbage"))
    assert sent[-1]["body"] == reply_text.hold_failed_message("ru")


async def test_unknown_button_gets_an_answer_not_silence(client, db_session_factory, make_user, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    await make_user("+923020000406")
    await client.post(WEBHOOK, json=_button_payload("923020000406", "wamid.unk.1", "something-old"))
    assert len(sent) == 1 and sent[0]["body"] == reply_text.generic_failure("en")


@pytest.mark.parametrize("texts,expected", [(ROMAN_URDU_TEXTS, "Mujhe payment"), (ENGLISH_TEXTS, "I don't see a pending booking")])
async def test_image_without_booking_follows_the_players_language(client, db_session_factory, make_user, monkeypatch, texts, expected):
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "+923020000407" if texts is ROMAN_URDU_TEXTS else "+923020000408"
    player = await make_user(phone)
    await seed_player_texts(db_session_factory, player, texts)
    await client.post(WEBHOOK, json=_image_payload(phone.lstrip("+"), f"wamid.img.{phone}", "media-x"))
    assert sent[-1]["body"].startswith(expected)
    assert_plain(sent[-1]["body"])


async def test_kill_switch_or_no_provider_fallback_is_localized(client, db_session_factory, make_user, monkeypatch):
    """The chat service writes its own English 'Our team will get back to you' line; the webhook puts it in the player's language."""
    sent = _mock_whatsapp_send(monkeypatch)
    monkeypatch.setattr(get_settings(), "ANTHROPIC_API_KEY", "")
    phone = "+923020000409"
    player = await make_user(phone)
    await seed_player_texts(db_session_factory, player, ROMAN_URDU_TEXTS)
    await client.post(WEBHOOK, json=_text_payload(phone.lstrip("+"), "wamid.kill.1", "mjhy booking chahiye"))
    assert sent[-1]["body"] == reply_text.handoff_message("ru")
    await client.post(WEBHOOK, json=_text_payload("923020000410", "wamid.kill.2", "I want to book a court please"))
    assert sent[-1]["body"] == reply_text.handoff_message("en")


async def test_confirm_buttons_use_the_players_language(client, db_session_factory, make_user, monkeypatch):
    payloads = []

    async def fake_send(self, payload):
        payloads.append(payload)
        return {"messages": [{"id": f"wamid.out.{len(payloads)}"}]}

    monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService._send", fake_send)

    async def fake_process(self, *, user, message, history=None, channel="app"):
        return ChatResult(
            reply="Court 1, 9:00 PM to 10:30 PM, Tue 22 Sep, PKR 3,500. Confirm?",
            actions=[
                ChatAction(type="confirm_booking", label="Yes, book it", data={"court_id": "0b7a5b0c-1111-4222-8333-444455556666", "starts_at": "2026-09-22T16:00:00+00:00"}),
                ChatAction(type="decline", label="No, thanks", data={}),
            ],
        )

    monkeypatch.setattr("app.services.ai_chat_service.AIChatService.process_message", fake_process)
    await client.post(WEBHOOK, json=_text_payload("923020000411", "wamid.lang.1", "I want to book a court please"))
    await client.post(WEBHOOK, json=_text_payload("923020000412", "wamid.lang.2", "mjhy court chahiye bhai"))
    titles = [[b["reply"]["title"] for b in p["interactive"]["action"]["buttons"]] for p in payloads]
    assert titles == [["Yes, book it", "No, thanks"], ["Haan, book karein", "Nahi, shukriya"]]


# ---------------------------------------------------------------------------------------------------------------------------
# P10 (c): exactly-once processing of a delivery
# ---------------------------------------------------------------------------------------------------------------------------


async def test_same_delivery_twice_in_a_row_is_answered_once(client, db_session, fake_model, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    payload = _text_payload("923020000421", "wamid.same.1", "hello there")
    assert (await client.post(WEBHOOK, json=payload)).status_code == 200
    assert (await client.post(WEBHOOK, json=payload)).status_code == 200
    assert len(fake_model.calls) == 1 and len(sent) == 1
    assert len(await messages_of(db_session, "+923020000421", "player")) == 1


async def test_same_delivery_fired_concurrently_is_answered_once_even_for_a_new_number(client, db_session, fake_model, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    fake_model.delay = 0.3  # the first delivery is still being processed when the retry arrives
    payload = _text_payload("923020000422", "wamid.same.2", "hello there")
    responses = await asyncio.gather(*[client.post(WEBHOOK, json=payload) for _ in range(5)])
    assert [r.status_code for r in responses] == [200] * 5
    assert len(fake_model.calls) == 1, "the AI turn must run once"
    assert len(sent) == 1, "exactly one bot message"
    assert len(await messages_of(db_session, "+923020000422", "player")) == 1
    assert await db_session.scalar(select(func.count()).select_from(User).where(User.phone == "+923020000422")) == 1


async def test_two_different_first_messages_from_a_new_number_do_not_break(client, db_session, fake_model, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "923020000423"
    a, b = await asyncio.gather(
        client.post(WEBHOOK, json=_text_payload(phone, "wamid.new.a", "hi")), client.post(WEBHOOK, json=_text_payload(phone, "wamid.new.b", "hello"))
    )
    assert a.status_code == b.status_code == 200
    assert await db_session.scalar(select(func.count()).select_from(User).where(User.phone == "+" + phone)) == 1
    assert len(sent) >= 1


# ---------------------------------------------------------------------------------------------------------------------------
# P10 (b)(d)(f): ordering, one reply per message, stale replies
# ---------------------------------------------------------------------------------------------------------------------------


async def _recorded_players(db_session, phone: str) -> int:
    user = await db_session.scalar(select(User).where(User.phone == phone))
    if user is None:
        return 0
    return await db_session.scalar(select(func.count()).select_from(Message).where(Message.sender_id == user.id, Message.sender_type == "player"))


async def test_second_message_waits_and_only_the_newest_is_answered(client, db_session, fake_model, monkeypatch):
    """A is being answered when B arrives: B waits for A (never parallel), A's reply is about stale text so it is dropped,
    and B is answered once, with A in its history."""
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "923020000431"
    fake_model.gate("padel court chahiye")
    first = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.ord.1", "padel court chahiye")))
    await asyncio.wait_for(fake_model.event("padel court chahiye").wait(), 10)

    second = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.ord.2", "nahi futsal dekho")))

    async def second_recorded():
        return await _recorded_players(db_session, "+" + phone) == 2

    await wait_until(second_recorded)
    await asyncio.sleep(0.2)
    assert [c["message"] for c in fake_model.calls] == ["padel court chahiye"], "the second message must wait for the first"

    fake_model.release("padel court chahiye")
    assert (await first).status_code == 200 and (await second).status_code == 200

    assert [c["message"] for c in fake_model.calls] == ["padel court chahiye", "nahi futsal dekho"]
    assert [m["body"] for m in sent] == ["reply to nahi futsal dekho"], "exactly one bot message, for the newest text"
    assert {"role": "user", "content": "padel court chahiye"} in fake_model.calls[1]["history"]
    assert fake_model.calls[1]["history"].count({"role": "user", "content": "nahi futsal dekho"}) == 0, "the current message is not repeated in history"
    ai = await messages_of(db_session, "+" + phone, "ai")
    assert [m.content for m in ai] == ["reply to nahi futsal dekho"]


async def test_three_quick_messages_get_one_coherent_answer(client, db_session, fake_model, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "923020000432"
    fake_model.gate("one")
    t1 = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.q.1", "one")))
    await asyncio.wait_for(fake_model.event("one").wait(), 10)
    t2 = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.q.2", "two")))
    await wait_until(lambda: _count_is(db_session, phone, 2))
    t3 = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.q.3", "three")))
    await wait_until(lambda: _count_is(db_session, phone, 3))
    fake_model.release("one")
    await asyncio.gather(t1, t2, t3)
    assert [c["message"] for c in fake_model.calls] == ["one", "three"], "the overtaken middle message is not run on its own"
    assert [m["body"] for m in sent] == ["reply to three"]
    history = fake_model.calls[1]["history"]
    assert {"role": "user", "content": "one"} in history and {"role": "user", "content": "two"} in history


async def _count_is(db_session, phone: str, n: int) -> bool:
    return await _recorded_players(db_session, "+" + phone) == n


async def test_greetings_sent_back_to_back_do_not_make_two_welcomes(client, db_session, fake_model, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "923020000433"
    fake_model.gate("hi")
    t1 = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.g.1", "hi")))
    await asyncio.wait_for(fake_model.event("hi").wait(), 10)
    t2 = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.g.2", "hello")))
    await wait_until(lambda: _count_is(db_session, phone, 2))
    fake_model.release("hi")
    await asyncio.gather(t1, t2)
    assert len(sent) == 1


async def test_a_reply_that_changed_something_is_never_dropped(client, db_session, fake_model, monkeypatch):
    """If the older turn held a slot, its reply must still be sent even though a newer text arrived; both go out, in order."""
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "923020000434"
    fake_model.gate("book it")
    fake_model.tool_calls["book it"] = ["hold_slot"]
    t1 = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.m.1", "book it")))
    await asyncio.wait_for(fake_model.event("book it").wait(), 10)
    t2 = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.m.2", "and the price?")))
    await wait_until(lambda: _count_is(db_session, phone, 2))
    fake_model.release("book it")
    await asyncio.gather(t1, t2)
    assert [m["body"] for m in sent] == ["reply to book it", "reply to and the price?"]


async def test_sequential_messages_each_get_exactly_one_reply_in_order(client, db_session, fake_model, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    for i, text in enumerate(["first one", "second one", "third one"]):
        assert (await client.post(WEBHOOK, json=_text_payload("923020000435", f"wamid.s.{i}", text))).status_code == 200
    assert [m["body"] for m in sent] == ["reply to first one", "reply to second one", "reply to third one"]
    ai = await messages_of(db_session, "+923020000435", "ai")
    assert len(ai) == 3


async def test_a_button_tap_is_never_skipped_while_a_text_is_in_flight(client, db_session, fake_model, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "923020000436"
    fake_model.gate("hello")
    t1 = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.b.1", "hello")))
    await asyncio.wait_for(fake_model.event("hello").wait(), 10)
    t2 = asyncio.create_task(client.post(WEBHOOK, json=_button_payload(phone, "wamid.b.2", "decline")))
    await wait_until(lambda: _count_is(db_session, phone, 2))
    fake_model.release("hello")
    await asyncio.gather(t1, t2)
    assert [m["body"] for m in sent] == ["reply to hello", reply_text.declined_message("en")]


async def test_waiting_longer_than_the_limit_gets_a_busy_message(client, db_session, fake_model, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    monkeypatch.setattr(chat_lock, "LOCK_WAIT_SECONDS", 0.2)
    phone = "923020000437"
    fake_model.gate("slow one")
    t1 = asyncio.create_task(client.post(WEBHOOK, json=_text_payload(phone, "wamid.w.1", "slow one")))
    await asyncio.wait_for(fake_model.event("slow one").wait(), 10)
    second = await client.post(WEBHOOK, json=_button_payload(phone, "wamid.w.2", "decline"))
    assert second.status_code == 200
    assert sent[-1]["body"] == reply_text.busy_message("en")
    fake_model.release("slow one")
    await t1


# ---------------------------------------------------------------------------------------------------------------------------
# P10 (a)(e): model and tool failures
# ---------------------------------------------------------------------------------------------------------------------------

RAW = "Client error '429 Too Many Requests' for url 'https://generativelanguage.googleapis.com/v1beta/models/x' Traceback (most recent call last) KeyError: 'slots'"


@pytest.mark.parametrize("texts,lang", [(ROMAN_URDU_TEXTS, "ru"), (ENGLISH_TEXTS, "en")])
async def test_model_exception_gives_the_localized_fallback_and_no_raw_text(client, db_session, db_session_factory, make_user, fake_model, monkeypatch, texts, lang):
    sent = _mock_whatsapp_send(monkeypatch)
    phone = "+923020000441" if lang == "ru" else "+923020000442"
    player = await make_user(phone)
    await seed_player_texts(db_session_factory, player, texts)
    fake_model.raises = httpx.HTTPStatusError(RAW, request=httpx.Request("POST", "https://x"), response=httpx.Response(429))
    resp = await client.post(WEBHOOK, json=_text_payload(phone.lstrip("+"), f"wamid.exc.{lang}", "ok try again"))
    assert resp.status_code == 200
    assert [m["body"] for m in sent] == [reply_text.generic_failure(lang)]
    for fragment in ("429", "Traceback", "KeyError", "googleapis", "HTTPStatusError", "Client error"):
        assert fragment not in sent[0]["body"]
    stored = await messages_of(db_session, phone, "ai")
    assert stored[-1].content == reply_text.generic_failure(lang) and stored[-1].meta.get("fallback") is True


async def test_model_timeout_gives_the_localized_fallback(client, db_session, fake_model, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    monkeypatch.setattr(chat_fallbacks, "TURN_TIMEOUT_SECONDS", 0.1)
    fake_model.sleep_forever = True
    resp = await client.post(WEBHOOK, json=_text_payload("923020000443", "wamid.to.1", "mjhy kal ka slot chahiye bhai"))
    assert resp.status_code == 200
    assert [m["body"] for m in sent] == [reply_text.generic_failure("ru")]
    # the conversation is usable afterwards (the lock was released, the session is fine)
    fake_model.sleep_forever = False
    await client.post(WEBHOOK, json=_text_payload("923020000443", "wamid.to.2", "mjhy kal ka slot chahiye bhai"))
    assert sent[-1]["body"] == "reply to mjhy kal ka slot chahiye bhai"


async def test_tool_failure_inside_a_real_turn_gives_the_fallback(client, db_session, monkeypatch):
    """Real process_message with a mocked Claude HTTP call: the model asks for a tool, the tool blows up with an internal error."""
    sent = _mock_whatsapp_send(monkeypatch)
    monkeypatch.setattr(get_settings(), "ANTHROPIC_API_KEY", "test-key")

    real_post = httpx.AsyncClient.post

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        if "anthropic" not in str(url):  # the test client itself is an httpx.AsyncClient
            return await real_post(self, url, headers=headers, json=json, **kwargs)
        body = {"content": [{"type": "tool_use", "id": "toolu_1", "name": "check_availability", "input": {"court_id": "x", "date": "2030-01-01"}}], "stop_reason": "tool_use"}
        return httpx.Response(200, request=httpx.Request("POST", url), json=body)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    async def exploding_tool(self, user, name, args, actions):
        raise RuntimeError("asyncpg.exceptions.UndefinedTableError: relation slot_stats does not exist")

    monkeypatch.setattr(AIChatService, "_execute_tool", exploding_tool)

    async def no_gate(self, user, channel, name, args, messages):
        return None

    monkeypatch.setattr(AIChatService, "_gate_tool", no_gate)
    await client.post(WEBHOOK, json=_text_payload("923020000444", "wamid.tool.1", "I want to book a court for tomorrow"))
    assert [m["body"] for m in sent] == [reply_text.generic_failure("en")]
    assert "asyncpg" not in sent[0]["body"]


async def test_a_reply_that_looks_like_internals_is_replaced(client, db_session, fake_model, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)
    for i, leaky in enumerate(['{"name": "check_availability", "input": {}}', "I will call hold_slot now", "Traceback (most recent call last):", ""]):
        fake_model.reply_for["go"] = leaky
        await client.post(WEBHOOK, json=_text_payload("923020000445", f"wamid.leak.{i}", "go"))
        assert sent[-1]["body"] == reply_text.generic_failure("en"), leaky


async def test_failure_after_a_hold_still_tells_the_player_about_the_hold(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, monkeypatch
):
    """The hold tool succeeded, then the next model call crashed: the player gets the Held message, not 'try again'."""
    from app.services.booking_service import BookingService

    sent = _mock_whatsapp_send(monkeypatch)
    phone = "+923020000446"
    player, court, starts_at = await _proposal_setup(make_user, make_venue, make_court, make_schedule, make_pricing_rule, phone)

    async def hold_then_crash(self, *, user, message, history=None, channel="app"):
        await BookingService(self.db, self.settings).create_hold(user, court.id, datetime.fromisoformat(starts_at), None)
        raise RuntimeError("model went away")

    monkeypatch.setattr("app.services.ai_chat_service.AIChatService.process_message", hold_then_crash)
    await client.post(WEBHOOK, json=_text_payload(phone.lstrip("+"), "wamid.rescue.1", "book the 9 pm one"))
    assert sent[-1]["body"].startswith("Held!") and "9:00 PM to 10:30 PM" in sent[-1]["body"]
    assert "went away" not in sent[-1]["body"]


async def test_an_unexpected_error_after_recording_still_returns_200_and_tells_the_player(client, db_session, monkeypatch):
    sent = _mock_whatsapp_send(monkeypatch)

    async def broken(*args, **kwargs):
        raise RuntimeError("history query exploded")

    monkeypatch.setattr("app.services.ai_chat_service.AIChatService.load_history", broken)
    resp = await client.post(WEBHOOK, json=_text_payload("923020000447", "wamid.unexp.1", "hello"))
    assert resp.status_code == 200
    assert [m["body"] for m in sent] == [reply_text.generic_failure("en")]


# ---------------------------------------------------------------------------------------------------------------------------
# The in-app chat: ordered, one reply per message, safe on failure
# ---------------------------------------------------------------------------------------------------------------------------


async def test_in_app_messages_are_processed_one_at_a_time_and_in_order(client, db_session, fake_model, make_user, make_auth_headers):
    player = await make_user("+923020000451")
    headers = await make_auth_headers(player)
    fake_model.gate("first question")
    t1 = asyncio.create_task(client.post("/api/v1/chat/message", json={"message": "first question"}, headers=headers))
    await asyncio.wait_for(fake_model.event("first question").wait(), 10)
    t2 = asyncio.create_task(client.post("/api/v1/chat/message", json={"message": "second question"}, headers=headers))
    await asyncio.sleep(0.3)
    assert [c["message"] for c in fake_model.calls] == ["first question"], "the second message waits for the first"
    fake_model.release("first question")
    r1, r2 = await asyncio.gather(t1, t2)
    assert r1.json()["reply"] == "reply to first question" and r2.json()["reply"] == "reply to second question"
    assert fake_model.calls[1]["history"] == [
        {"role": "user", "content": "first question"},
        {"role": "assistant", "content": "reply to first question"},
    ], "the second turn sees the first exchange"
    rows = (await db_session.execute(select(Message).where(Message.sender_id == player.id, Message.channel == "app").order_by(Message.created_at))).scalars().all()
    assert [(m.sender_type, m.content) for m in rows] == [
        ("player", "first question"),
        ("ai", "reply to first question"),
        ("player", "second question"),
        ("ai", "reply to second question"),
    ]


async def test_in_app_failure_and_timeout_give_a_localized_fallback(client, db_session, fake_model, make_user, make_auth_headers, monkeypatch):
    player = await make_user("+923020000452")
    headers = await make_auth_headers(player)
    fake_model.raises = RuntimeError(RAW)
    resp = await client.post("/api/v1/chat/message", json={"message": "mjhy kal ka slot chahiye"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["reply"] == reply_text.generic_failure("ru") and resp.json()["actions"] == []
    assert "Traceback" not in resp.text and "KeyError" not in resp.text

    fake_model.raises = None
    fake_model.sleep_forever = True
    monkeypatch.setattr(chat_fallbacks, "TURN_TIMEOUT_SECONDS", 0.1)
    resp = await client.post("/api/v1/chat/message", json={"message": "I want a court please"}, headers=headers)
    assert resp.json()["reply"] == reply_text.generic_failure("en")


async def test_in_app_kill_switch_text_and_buttons_are_localized(client, db_session, make_user, make_auth_headers, monkeypatch):
    player = await make_user("+923020000453")
    headers = await make_auth_headers(player)
    monkeypatch.setattr(get_settings(), "ANTHROPIC_API_KEY", "")
    resp = await client.post("/api/v1/chat/message", json={"message": "mjhy court chahiye bhai"}, headers=headers)
    assert resp.json()["reply"] == reply_text.handoff_message("ru")


# ---------------------------------------------------------------------------------------------------------------------------
# the lock itself
# ---------------------------------------------------------------------------------------------------------------------------


async def test_lock_is_fifo_per_key_independent_across_keys_and_cleaned_up():
    locks = ConversationLocks()
    order: list[str] = []
    release = asyncio.Event()

    async def worker(key, name, wait_for=None):
        async with locks.hold(key):
            order.append(f"{name}:in")
            if wait_for is not None:
                await wait_for.wait()
            order.append(f"{name}:out")

    a = asyncio.create_task(worker("u1", "a", release))
    await asyncio.sleep(0.05)
    b = asyncio.create_task(worker("u1", "b"))
    c = asyncio.create_task(worker("u1", "c"))
    other = asyncio.create_task(worker("u2", "other"))
    await asyncio.sleep(0.05)
    assert order == ["a:in", "other:in", "other:out"], "u2 is not blocked by u1; b and c wait"
    release.set()
    await asyncio.gather(a, b, c, other)
    assert order[3:] == ["a:out", "b:in", "b:out", "c:in", "c:out"]
    assert len(locks) == 0


async def test_lock_wait_times_out_with_conversation_busy_and_still_cleans_up():
    locks = ConversationLocks()
    async with locks.hold("k"):
        with pytest.raises(ConversationBusy):
            async with locks.hold("k", timeout=0.05):
                pass
    assert len(locks) == 0


async def test_lock_is_released_when_the_body_raises():
    locks = ConversationLocks()
    with pytest.raises(RuntimeError):
        async with locks.hold("k"):
            raise RuntimeError("x")
    async with locks.hold("k", timeout=0.1):
        pass
    assert len(locks) == 0
