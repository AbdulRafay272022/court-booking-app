"""The fixed "I could not check that just now" fallback must (almost) never appear for a good model draft.

On 2026-10-15, 31 of 72 AI replies were that fallback: the reply checker rejected the model's draft twice (a total price not literally in the
tool results, a "Shall I book it?" question without a Yes/No proposal) and `_safe_fallback` sent the fixed text. These tests replay those
conversations in BOTH channels (app chat endpoint and WhatsApp webhook) and BOTH languages with a scripted model, and assert the fallback rate
on the replay set is zero, while a model that really fails (garbage twice, an exception) still gets the safe fallback.
"""

import itertools
import uuid
from datetime import time, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models.message import Message
from app.services import chat_templates, reply_text
from app.services.chat_validator import _amounts, check_language
from app.utils.timezone import pkt_time_to_utc, pkt_today
from tests.test_chat_replay import ScriptedModel, arena, say, text, tool
from tests.test_chat_replay import player_headers
from tests.test_webhooks import _text_payload

WEBHOOK = "/api/v1/webhooks/whatsapp"
FALLBACKS = {chat_templates.render("fallback_unavailable", lang) for lang in ("en", "ru")} | {reply_text.generic_failure(lang) for lang in ("en", "ru")}
CASES = ["first_available", "first_long", "first_unavailable", "price", "other_times", "unknown_total", "confirm_no_proposal"]
_ids = itertools.count(1)


def is_fallback(reply: str) -> bool:
    return reply in FALLBACKS


class Chat:
    """One player talking to the assistant over either channel; `say` returns {"reply", "actions"} for both."""

    def __init__(self, channel, client, monkeypatch, phone, headers=None):
        self.channel, self.client, self.phone, self.headers = channel, client, phone, headers
        self.sent: list[dict] = []
        if channel == "whatsapp":
            sent = self.sent

            async def fake_text(wa_self, to, body):
                sent.append({"body": body, "buttons": None})
                return {"messages": [{"id": f"wamid.reply.{len(sent)}"}]}

            async def fake_buttons(wa_self, to, body, buttons):
                sent.append({"body": body, "buttons": buttons})
                return {"messages": [{"id": f"wamid.reply.{len(sent)}"}]}

            monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_text", fake_text)
            monkeypatch.setattr("app.services.whatsapp_service.WhatsAppService.send_buttons", fake_buttons)

    async def say(self, message: str) -> dict:
        if self.channel == "app":
            r = await say(self.client, self.headers, message)
            return {"reply": r["reply"], "actions": [a["type"] for a in r["actions"]]}
        before = len(self.sent)
        resp = await self.client.post(WEBHOOK, json=_text_payload(self.phone.lstrip("+"), f"wamid.fr.{next(_ids)}.{uuid.uuid4().hex[:6]}", message))
        assert resp.status_code == 200
        assert len(self.sent) == before + 1, self.sent
        out = self.sent[-1]
        return {"reply": out["body"], "actions": ["confirm_booking", "decline"] if out["buttons"] else []}


async def make_chat(channel, client, make_user, make_auth_headers, monkeypatch, phone):
    if channel == "app":
        _user, headers = await player_headers(make_user, make_auth_headers, phone=phone)
        return Chat("app", client, monkeypatch, phone, headers)
    await make_user(phone, name="Sara Ahmed")
    return Chat("whatsapp", client, monkeypatch, phone)


def day_label(day) -> str:
    return f"{day:%a}, {day.day} {day:%b}"


def build_case(case: str, lang: str, courts, tomorrow):
    """[(player message, scripted model responses for that message)]. The scripts imitate what the real model did on 2026-10-15."""
    c2, ca = str(courts["Court 2"].id), str(courts["Court A"].id)
    iso = tomorrow.isoformat()
    nine = pkt_time_to_utc(tomorrow, time(21, 0)).isoformat()
    dl = day_label(tomorrow)
    ru = lang == "ru"
    confirm_q = "Kya main book kar dun? Haan ya Na likh dein" if ru else "Shall I book it? Reply Yes or No."

    def avail_q(hours: int, clock: str = "9:00 PM", spoken: str = "raat 9 baje") -> str:
        if ru:
            return f"Court 2 Test Arena 1 mein kal {spoken} {hours} ghante ke liye khali hai kya?"
        return f"Is Court 2 at Test Arena 1 available on {dl} at {clock} for {hours} hour{'s' if hours != 1 else ''}?"

    chat = ["Futsal chayie", "kal", "9 baje", "pm", "2 ghante"] if ru else ["Futsal", "tomorrow", "9 pm", "2 hours"]
    lead = [(m, []) for m in chat[:-1]]

    if case == "first_available":
        draft = (
            "Ji haan, Court 2 kal raat 9:00 PM to 10:00 PM khali hai, PKR 3000. " + confirm_q
            if ru
            else f"Yes, Court 2 at Test Arena 1 is available on {dl} at 9:00 PM to 10:00 PM for PKR 3000. " + confirm_q
        )
        q = avail_q(1).replace("2 ghante", "1 ghanta") if ru else avail_q(1)
        return [(q, [tool("check_availability", {"court_id": c2, "date": iso, "start_time": "21:00"}), text(draft)])]
    if case == "first_long":
        six = "18:00"
        draft = (
            "Ji haan, Court 2 kal shaam 6:00 PM to 9:00 PM khali hai. 3 ghante ka total PKR 9000 hai. " + confirm_q
            if ru
            else f"Yes, Court 2 is available on {dl} from 6:00 PM to 9:00 PM. For 3 hours the total is PKR 9000. " + confirm_q
        )
        return [(avail_q(3, "6:00 PM", "shaam 6 baje"), [tool("check_availability", {"court_id": c2, "date": iso, "start_time": six}), text(draft)])]
    if case == "first_unavailable":
        if ru:
            q = "Court 2 Test Arena 1 mein kal subah 4 baje 1 ghante ke liye khali hai kya?"
            draft = "Maaf kijiye, 4:00 AM available nahi hai. Khali hain: 6:00 AM to 7:00 AM, 7:00 AM to 8:00 AM. Kaun sa time chahiye?"
        else:
            q = f"Is Court 2 at Test Arena 1 available on {dl} at 4:00 AM for 1 hour?"
            draft = "Sorry, Court 2 is not available at 4:00 AM. These are free: 6:00 AM to 7:00 AM, 7:00 AM to 8:00 AM. Which time would you like?"
        return [(q, [tool("check_availability", {"court_id": c2, "date": iso, "start_time": "04:00", "end_time": "05:00"}), text(draft)])]
    if case == "price":
        if ru:
            q = "Court 2 Test Arena 1 mein kal raat 9 baje 2 ghante ki price kya hai?"
            draft = "Court 2 ka kal raat 9:00 PM se 2 ghante ka total PKR 6000 hai. " + confirm_q
        else:
            q = f"How much is Court 2 at Test Arena 1 on {dl} at 9:00 PM for 2 hours?"
            draft = "Court 2 costs PKR 6000 for 2 hours tomorrow at 9:00 PM. " + confirm_q
        return [(q, [tool("quote_booking", {"court_id": c2, "starts_at": nine, "duration_minutes": 120}), text(draft)])]
    if case == "other_times":
        if ru:
            follow = "koi aur time khali hai kya?"
            draft = "Court 2 kal in times par khali hai: 6:00 AM to 7:00 AM, 7:00 AM to 8:00 AM, 8:00 AM to 9:00 AM. Kaun sa time chahiye?"
        else:
            follow = "Any other time free tomorrow?"
            draft = "Court 2 is free tomorrow at 6:00 AM to 7:00 AM, 7:00 AM to 8:00 AM and 8:00 AM to 9:00 AM. Which time would you like?"
        first = avail_q(2)
        first_draft = "Ji haan, Court 2 khali hai. " + confirm_q if ru else "Yes, it is free. " + confirm_q
        return [
            (first, [tool("check_availability", {"court_id": c2, "date": iso, "start_time": "21:00", "end_time": "23:00"}), tool("propose_booking_confirmation", {"court_id": c2, "starts_at": nine, "duration_minutes": 120}, "toolu_2"), text(first_draft)]),
            (follow, [tool("check_availability", {"court_id": c2, "date": iso}), text(draft)]),
        ]
    if case == "unknown_total":
        draft = (
            "Court A kal raat 9:00 PM se 11:00 PM tak khali hai. 2 ghante ka total PKR 6000 hai. " + confirm_q
            if ru
            else "Court A is free tomorrow from 9:00 PM to 11:00 PM. For 2 hours the total is PKR 6000. " + confirm_q
        )
        return lead + [(chat[-1], [tool("check_availability", {"court_id": ca, "date": iso, "start_time": "21:00"}), text(draft)])]
    if case == "confirm_no_proposal":
        draft = "Ji haan, Court A khali hai. " + confirm_q if ru else "Yes, Court A is free then. " + confirm_q
        return lead + [(chat[-1], [tool("check_availability", {"court_id": ca, "date": iso, "start_time": "21:00", "end_time": "23:00"}), text(draft)])]
    raise AssertionError(case)


@pytest.mark.parametrize("case", CASES)
@pytest.mark.parametrize("lang", ["en", "ru"])
@pytest.mark.parametrize("channel", ["app", "whatsapp"])
async def test_replay_set_has_no_fallback(
    channel, lang, case, client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    chat = await make_chat(channel, client, make_user, make_auth_headers, monkeypatch, "+923050000010")
    model = ScriptedModel(monkeypatch)
    tomorrow = pkt_today() + timedelta(days=1)
    steps = build_case(case, lang, courts, tomorrow)
    last = None
    for message, responses in steps:
        model.feed(*responses)
        before = len(model.bodies)
        last = await chat.say(message)
        calls = len(model.bodies) - before
        if message == steps[-1][0]:
            print(f"FR_RESULT {channel} {lang} {case} fallback={is_fallback(last['reply'])}")
        assert not is_fallback(last["reply"]), (message, last["reply"])
        if case.startswith("first_") or case == "price":
            assert calls == 0, "the available / unavailable / price answer is built from code, the model is not needed"
    assert not check_language(last["reply"], lang), last["reply"]
    reply = last["reply"]
    if case in ("first_available", "first_long", "price", "unknown_total", "confirm_no_proposal"):
        assert last["actions"] == ["confirm_booking", "decline"], last
        assert reply.count("?") == 1
    if case == "first_available":
        assert "PKR 3,000" in reply and "9:00 PM to 10:00 PM" in reply
    if case == "first_long":
        assert "PKR 9,000" in reply and "6:00 PM to 9:00 PM" in reply
    if case in ("price", "unknown_total", "confirm_no_proposal"):
        assert "PKR 6,000" in reply or case == "confirm_no_proposal"
    if case == "first_unavailable":
        assert last["actions"] == [] and "6:00 AM" in reply and "?" in reply
    stored = (await db_session.scalars(select(Message).where(Message.sender_type == "ai").order_by(Message.created_at.desc()))).first()
    assert not (stored.meta or {}).get("fallback")


# --- the fallback is still the last resort when the model really fails ----------------------------------------------------------


@pytest.mark.parametrize("lang", ["en", "ru"])
@pytest.mark.parametrize("channel", ["app", "whatsapp"])
async def test_garbage_twice_still_gets_the_safe_fallback_and_the_reason_is_stored(
    channel, lang, client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    chat = await make_chat(channel, client, make_user, make_auth_headers, monkeypatch, "+923050000011")
    model = ScriptedModel(monkeypatch)
    tomorrow = pkt_today() + timedelta(days=1)
    steps = build_case("confirm_no_proposal", lang, courts, tomorrow)
    for message, _responses in steps[:-1]:
        await chat.say(message)
    model.feed(text(""), text(""))  # an empty draft, twice
    last = await chat.say(steps[-1][0])
    assert last["reply"] == chat_templates.render("fallback_unavailable", lang)
    assert last["actions"] == []
    assert len(model.bodies) == 2  # one corrective retry, then the template
    stored = (await db_session.scalars(select(Message).where(Message.sender_type == "ai").order_by(Message.created_at.desc()))).first()
    validator = stored.meta["validator"]
    assert validator["outcome"] == "fallback"
    assert [i["code"] for i in validator["issues"]] == ["empty"]
    assert validator["draft"] == "" and len(validator["attempts"]) == 2


@pytest.mark.parametrize("channel", ["app", "whatsapp"])
async def test_a_model_that_raises_gets_the_generic_failure_message(
    channel, client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    chat = await make_chat(channel, client, make_user, make_auth_headers, monkeypatch, "+923050000012")
    monkeypatch.setattr(get_settings(), "ANTHROPIC_API_KEY", "test-key")
    real_post = httpx.AsyncClient.post

    async def boom(client_self, url, *args, **kwargs):
        if "anthropic" in str(url):
            raise httpx.ConnectError("down")
        return await real_post(client_self, url, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "post", boom)
    last = await chat.say("parking hai kya?")
    assert last["reply"] == reply_text.generic_failure("ru")
    stored = (await db_session.scalars(select(Message).where(Message.sender_type == "ai").order_by(Message.created_at.desc()))).first()
    assert stored.meta.get("fallback") is True


# --- the validator rules themselves ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "draft",
    ["PKR 6,000", "PKR 6000", "Rs 6,000", "Rs. 6000", "rs6,000", "6000/-", "6,000/-", "PKR 6,000.00", "6000 rupees", "PKR 6000.0"],
)
def test_every_spelling_of_a_price_normalizes_to_the_same_amount(draft):
    assert _amounts(draft) == {"6000"}


def test_unrelated_numbers_are_not_prices():
    assert _amounts("Court 2, 9:00 PM to 11:00 PM, 2 hours, Sat 17 Oct 2026") == set()


def test_phone_numbers_are_masked_in_stored_and_logged_drafts():
    from app.services.chat_validator import mask_phones_in_text

    masked = mask_phones_in_text("Call the venue on +92 300 1234567 or 03001234567. Court 2, 9:00 PM to 11:00 PM, PKR 6,000, 2 hours.")
    assert "1234567" not in masked and "***4567" in masked
    assert "9:00 PM to 11:00 PM" in masked and "PKR 6,000" in masked


async def test_a_repaired_draft_leaves_its_reason_in_the_stored_meta(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    chat = await make_chat("app", client, make_user, make_auth_headers, monkeypatch, "+923050000013")
    model = ScriptedModel(monkeypatch)
    steps = build_case("confirm_no_proposal", "en", courts, pkt_today() + timedelta(days=1))
    for message, responses in steps:
        model.feed(*responses)
        last = await chat.say(message)
    assert last["actions"] == ["confirm_booking", "decline"] and len(model.bodies) == 2  # the tool round + the text round: repaired, no corrective retry
    stored = (await db_session.scalars(select(Message).where(Message.sender_type == "ai").order_by(Message.created_at.desc()))).first()
    validator = stored.meta["validator"]
    assert validator["outcome"] == "repaired"
    assert validator["issues"][0]["code"] == "bad_proposal" and "Shall I book it?" in validator["draft"]


async def test_no_name_on_the_account_asks_for_the_name_instead_of_a_yes_no(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    _user, headers = await player_headers(make_user, make_auth_headers, phone="+923050000014", name=None)
    model = ScriptedModel(monkeypatch)
    r = await say(client, headers, build_case("first_available", "en", courts, pkt_today() + timedelta(days=1))[0][0])
    assert r["actions"] == [] and "What name should I put the booking under?" in r["reply"] and "PKR 3,000" in r["reply"]
    assert model.bodies == []


async def test_an_unavailable_answer_gives_no_reason_and_no_proposal(
    client, db_session, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    _venue, courts = await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    _user, headers = await player_headers(make_user, make_auth_headers, phone="+923050000015")
    ScriptedModel(monkeypatch)
    r = await say(client, headers, build_case("first_unavailable", "en", courts, pkt_today() + timedelta(days=1))[0][0])
    assert r["actions"] == [] and r["reply"].startswith("Sorry, Court 2 at Test Arena 1 is not available on ")
    assert not any(w in r["reply"].lower() for w in ("booked", "closed", "taken"))
