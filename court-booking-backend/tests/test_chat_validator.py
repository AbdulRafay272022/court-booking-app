"""The reply safety check (no database, no model): every rule rejects a bad draft and lets a good one through."""

from types import SimpleNamespace

import pytest

from app.services.ai_chat_service import sanitize_reply
from app.services.chat_validator import Issue, ValidationContext, corrective_instruction, style_violations, validate
from tests.test_chat_state import make_facts, run

SLOTS = '{"slots": [{"label": "9:00 PM to 10:00 PM, Wed 14 Oct", "price_text": "PKR 3,000"}, {"label": "9:30 PM to 10:30 PM, Wed 14 Oct", "price_text": "PKR 3,000"}]}'


def ctx(player_messages, current, *, previous_ai=(), tool_text="", actions=(), facts=None):
    facts = facts or make_facts()
    rows, t = [], 100
    for i, text in enumerate(player_messages):
        rows.append(("player", text, t))
        rows.append(("ai", previous_ai[i] if i < len(previous_ai) else "ok", t - 1))
        t -= 2
    fold = run(rows, current, facts)
    return ValidationContext(
        state=fold.state, facts=facts, turn=fold.turn,
        previous_ai=[r.text for r in fold.window if r.role == "ai"],
        player_texts=[r.text for r in fold.window if r.role == "player"] + [current],
        tool_text=tool_text, actions=list(actions),
    )


def codes(draft, c):
    return sorted({i.code for i in validate(draft, c)})


GOOD = "Court 2 (Padel) is free on Wed 14 Oct: 9:00 PM to 10:00 PM and 9:30 PM to 10:30 PM, PKR 3,000 each. Which time would you like?"


def test_a_good_draft_passes():
    c = ctx([], "is padel Court 2 available tomorrow?", tool_text=SLOTS)
    assert codes(GOOD, c) == []


def test_empty_draft():
    assert codes("  ", ctx([], "padel kal")) == ["empty"]


def test_a_repeat_of_the_previous_bot_message_is_rejected():
    prev = "Court 2 par kal ka 9:00 PM to 10:00 PM slot free hai. Aap kitni der khelna chahte hain? 1 ghanta ya 2 ghante"
    c = ctx(["padel Court 2 kal 9pm"], "kon kon say available hai court ?", previous_ai=[prev])
    assert "repeat" in codes(prev, c)
    assert "repeat" not in codes("Kal sirf Court 2 khali hai. Time bata dein?", c)


def test_asking_what_the_player_already_said_is_rejected():
    c = ctx([], "Padel Court 2 tomorrow 9pm for 2 hours")
    for question in ("Which sport would you like?", "Which court do you want?", "Which date would you like?", "What time would you like to start?", "How long would you like to play?"):
        assert "asked_answered" in codes(question, c), question
    # but asking what IS missing is fine
    c2 = ctx([], "Padel Court 2 tomorrow 9pm")
    assert codes("How long would you like to play?", c2) == []


def test_offering_real_alternatives_is_not_asking_again():
    c = ctx([], "Padel Court 2 kal 9pm 1 hour", tool_text=SLOTS)
    draft = "9:00 PM is taken. Court 2 is free at 9:30 PM to 10:30 PM, Wed 14 Oct, PKR 3,000. Which time would you like?"
    assert "asked_answered" not in codes(draft, c)


def test_two_questions_are_rejected():
    c = ctx([], "padel")
    assert "multi_question" in codes("Which court do you want? And which date?", c)


def test_a_price_time_court_or_sport_that_is_not_in_the_facts_is_rejected():
    c = ctx([], "padel kal available hai?", tool_text=SLOTS)
    assert "unknown_fact" in codes("Court 2 is free 9:00 PM to 10:00 PM, Wed 14 Oct for PKR 2,500. Shall we?", c)  # wrong price
    assert "unknown_fact" in codes("Court 2 is free at 11:30 PM, Wed 14 Oct. Which time would you like?", c)  # a time no tool returned
    assert "unknown_fact" in codes("Court 9 is free 9:00 PM to 10:00 PM, Wed 14 Oct. Which time would you like?", c)  # no such court
    assert "unknown_fact" in codes("We also have Squash at 9:00 PM to 10:00 PM, Wed 14 Oct. Which time?", c)  # a sport nobody offers
    assert "unknown_fact" in codes("Court 2: 9:00 PM to 10:00 PM, Sat 3 Oct 2020. Which time would you like?", c)  # the stale year of pattern P8
    assert "unknown_fact" not in codes(GOOD, c)
    # a sport the PLAYER asked about may be named (to say it is not offered)
    c = ctx([], "tennis available hai?")
    assert "unknown_fact" not in codes("Tennis is not available here. We have Cricket, Futsal and Padel.", c)


def test_a_draft_that_contradicts_the_state_is_rejected():
    c = ctx([], "Futsal kal 9pm 1 hour")
    assert "contradiction" in codes("Court 2 (Padel) is free on Wed 14 Oct at 9:00 PM. Shall I book it?", c)  # another sport than asked
    c = ctx([], "Futsal kal 9pm 1 hour", tool_text=SLOTS)
    assert "contradiction" in codes("Court A is free on Fri 16 Oct: 9:00 PM to 10:00 PM. Which time would you like?", c)  # another date than asked, not from a tool
    assert "contradiction" not in codes("Court A is free on Wed 14 Oct: 9:00 PM to 10:00 PM, PKR 3,000. Which time would you like?", c)


def test_the_wrong_language_is_rejected():
    ru = ctx([], "mjhy padel ka court chayie kal")
    assert ru.lang == "ru"
    assert "wrong_language" in codes("Yes, Court 2 is available on Wednesday. Do you want me to book it for you?", ru)
    assert "wrong_language" not in codes("Court 2 kal available hai. Kitne baje se khelna chahte hain?", ru)
    en = ctx([], "I need a padel court tomorrow")
    assert "wrong_language" in codes("Court 2 kal available hai aur aap ki booking ho sakti hai. Kya aap time bata sakte hain?", en)
    assert "wrong_language" not in codes("Court 2 is available. What start time would you like?", en)


def test_style_problems_are_found_and_repaired_by_the_sanitizer():
    bad = "**Court 2** is free at 21:00 UTC \U0001F600 2026-10-14T16:00:00+00:00"
    assert set(style_violations(bad)) == {"markdown", "emoji", "24h_time", "utc"}
    fixed = sanitize_reply(bad)
    assert style_violations(fixed) == [] and "**" not in fixed and "21:00" not in fixed


def test_the_reply_must_answer_the_last_message_not_an_older_one():
    c = ctx(["padel Court 2 kal 9pm 1 hour"], "price kya hai?", tool_text=SLOTS)
    assert c.turn.intent == "price_question"
    assert "stale_intent" in codes("Court 2 par kal 9:00 PM to 10:00 PM, Wed 14 Oct free hai. Kya main book kar dun?", c)
    assert "stale_intent" not in codes("Court 2 ka price PKR 3,000 hai. Kya aap book karna chahte hain?", c)
    c = ctx([], "thanks")
    assert "stale_intent" in codes("Court 2 is free 9:00 PM to 10:00 PM, Wed 14 Oct.", c)
    c = ctx([], "which sports do you have?")
    assert "stale_intent" in codes("Court 2 is free at 9:00 PM.", c)
    assert "stale_intent" not in codes("We have Cricket, Futsal and Padel. Which one would you like?", c)


def test_yes_no_proposals_need_every_field_from_the_player():
    confirm = SimpleNamespace(type="confirm_booking", data={"court_id": "c-2", "starts_at": "2026-10-14T16:00:00+00:00", "slot_count": 2})
    draft = "Court 2, 9:00 PM to 10:00 PM, Wed 14 Oct, PKR 3,000. Shall I book it? Reply Yes or No"
    partial = ctx([], "padel Court 2 kal 9pm", tool_text=SLOTS, actions=[confirm])
    assert "bad_proposal" in codes(draft, partial)  # the length was never said
    full = ctx([], "padel Court 2 kal 9pm 1 hour", tool_text=SLOTS, actions=[confirm])
    assert "bad_proposal" not in codes(draft, full)
    # the confirmation question with no proposal behind it is rejected too
    no_action = ctx([], "padel Court 2 kal 9pm 1 hour", tool_text=SLOTS)
    assert "bad_proposal" in codes(draft, no_action)


def test_corrective_instruction_names_every_problem():
    c = ctx([], "Padel Court 2 tomorrow 9pm")
    issues = [Issue("asked_answered", "date"), Issue("wrong_language", "en"), Issue("repeat")]
    text = corrective_instruction(issues, c)
    assert text.startswith("Your previous draft was rejected") and "date" in text and "English" in text and "repeats" in text
