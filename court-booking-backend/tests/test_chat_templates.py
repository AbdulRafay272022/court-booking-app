"""The fixed guard replies: every key renders in Roman Urdu and in English, in the right language, in plain text (no markdown, no emoji,
no 24-hour time, no UTC) and asks at most one question."""

import re

import pytest

from app.services.chat_language import detect_language
from app.services.chat_templates import TEMPLATE_KEYS, duration_options, join_list, render
from app.services.chat_validator import style_violations

SAMPLE = {
    "greeting": dict(sports=["Cricket", "Futsal", "Padel"]),
    "thanks": {},
    "ack_idle": {},
    "ack_no": {},
    "ask_sport": dict(sports=["Cricket", "Futsal", "Padel"], venue="Test Arena 1"),
    "sport_unclear": dict(sports=["Cricket", "Futsal", "Padel"]),
    "sport_multi": dict(sports=["Futsal", "Padel"]),
    "sport_unsupported": dict(sport="Tennis", offered=["Cricket", "Futsal", "Padel"], venue="Test Arena 1", others=["Gulshan Tennis Club"]),
    "ask_venue": dict(venues=["Test Arena 1", "Clifton Padel Club"], sport="Padel"),
    "ask_court": dict(courts=["Court 2", "Court 3"], sport="Padel", venue="Test Arena 1"),
    "ask_date": {},
    "ask_time": {},
    "ask_ampm": dict(hour=9),
    "ask_duration": dict(min_minutes=60),
    "past_date": {},
    "choices": dict(options=["Cricket", "Futsal", "Padel"]),
    "choices_free": dict(example="7 PM"),
    "handoff": dict(support="+92 300 0000000"),
    "already_said": dict(summary="Padel, Wed 14 Oct 2026, 9:00 PM"),
    "sports_list": dict(sports=["Cricket", "Futsal", "Padel"], venue="Test Arena 1"),
    "price_info": dict(lines=["Padel, Court 2: PKR 3,000 for 1 hour"], venue="Test Arena 1"),
    "price_unknown": {},
    "price_bargain": dict(lines=["Padel, Court 2: PKR 3,000 for 1 hour"]),
    "location": dict(venue="Test Arena 1", address="Plot 5, Clifton, Karachi"),
    "location_unknown": {},
    "hours": dict(venue="Test Arena 1", hours="6:00 AM to 11:00 PM every day"),
    "hours_unknown": {},
    "ask_which_venue_info": dict(venues=["Test Arena 1", "Clifton Padel Club"]),
    "fallback_ask": {},
    "fallback_unavailable": {},
    "held": dict(label="9:00 PM to 10:00 PM, Wed 14 Oct", total="PKR 3,000", advance="PKR 1,000", until="9:15 PM"),
    "steer_back": dict(sports=["Cricket", "Futsal", "Padel"]),
}


def test_every_template_has_a_sample():
    assert set(SAMPLE) == set(TEMPLATE_KEYS)


@pytest.mark.parametrize("key", TEMPLATE_KEYS)
@pytest.mark.parametrize("lang", ["ru", "en"])
def test_template_is_plain_safe_and_asks_at_most_one_question(key, lang):
    text = render(key, lang, **SAMPLE[key])
    assert text.strip() and text.isascii(), text  # no emoji, no fancy symbols
    assert style_violations(text) == [], text
    assert text.count("?") <= 1, text
    assert not re.search(r"\d{1,2}:\d{2}(?!\s?[AP]M)", text), text  # no 24-hour time


@pytest.mark.parametrize("key", [k for k in TEMPLATE_KEYS if k not in ("held",)])
def test_roman_urdu_in_roman_urdu_out_and_english_in_english_out(key):
    ru = render(key, "ru", **SAMPLE[key])
    en = render(key, "en", **SAMPLE[key])
    assert ru != en
    assert detect_language(en) in ("en", None), en  # English never reads as Roman Urdu
    assert detect_language(ru) in ("ru", None), ru  # Roman Urdu never reads as English


def test_the_substantial_templates_are_unambiguously_in_their_language():
    for key in ("greeting", "ask_sport", "sport_unsupported", "ask_court", "ask_duration", "handoff", "price_bargain", "hours", "thanks", "ack_idle"):
        assert detect_language(render(key, "ru", **SAMPLE[key])) == "ru", key
        assert detect_language(render(key, "en", **SAMPLE[key])) == "en", key


def test_unsupported_sport_lists_the_real_sports_and_other_venues():
    en = render("sport_unsupported", "en", **SAMPLE["sport_unsupported"])
    assert en == "Test Arena 1 does not offer Tennis. It offers Cricket, Futsal and Padel. Tennis is available at Gulshan Tennis Club. Would you like to see them?"
    ru = render("sport_unsupported", "ru", **SAMPLE["sport_unsupported"])
    assert ru == "Test Arena 1 mein Tennis nahi hai. Yahan Cricket, Futsal aur Padel hain. Tennis Gulshan Tennis Club mein hai. Kya main wo dikhaoon?"
    # nobody has it: no offer to show venues
    none_elsewhere = render("sport_unsupported", "en", sport="Tennis", offered=["Futsal"], venue="Test Arena 1", others=[])
    assert "Would you like to see them" not in none_elsewhere and "Futsal" in none_elsewhere
    platform = render("sport_unsupported", "ru", sport="Tennis", offered=["Futsal", "Padel"])
    assert "nahi hai" in platform and "Futsal aur Padel" in platform


def test_helpers():
    assert join_list(["a", "b", "c"], "en") == "a, b and c" and join_list(["a", "b"], "ru") == "a aur b" and join_list([], "en") == ""
    assert duration_options(60, "en") == "1 hour, 1.5 hours and 2 hours"
    assert duration_options(60, "ru") == "1 ghanta, 1.5 ghante aur 2 ghante"
    assert render("handoff", "en") == "Sorry, I could not understand this. The venue owner or our support team can help you directly."  # no number invented
