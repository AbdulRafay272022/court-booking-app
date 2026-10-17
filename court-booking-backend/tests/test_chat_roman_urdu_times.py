"""A venue/court label that ends in a digit followed by ka/ki/ke ("Test Arena 1 ka Court 2", "Court 3 ke liye") is not a clock time.

`ka/ki/ke` is also a time suffix ("9 ka slot", "8 baje ka match"), so the rule is narrow: a number DIRECTLY after a court-like label word (court,
arena, ground, club, venue, turf, ...) or inside a known venue/court name from the facts, and DIRECTLY before ka/ki/ke, is not a time. A number with no
label word in front of it keeps working ("9 ka slot", "8 baje ka match")."""
from datetime import time, timedelta

import pytest

from app.services.chat_state import extract_times
from app.utils.timezone import pkt_today
from tests.test_chat_fallback_rate import make_chat
from tests.test_chat_replay import ScriptedModel, arena


@pytest.mark.parametrize("text", ["Arena 1 ka", "Court 2 ka", "Court 3 ke liye", "Test Arena 1 ki booking", "ground 4 ka", "Court 2 ka slot dikhao"])
def test_a_label_number_before_ka_ki_ke_is_not_a_time(text):
    found = extract_times(text)
    assert not found.any and found.start is None and found.ambiguous_hour is None


def test_kal_1_baje_is_one_oclock():
    assert extract_times("kal 1 baje").ambiguous_hour == 1  # AM/PM unknown, still read as an hour
    assert extract_times("kal raat 1 baje").start == time(1, 0)


def test_1_am_is_a_time():
    assert extract_times("1 AM").start == time(1, 0)


def test_the_real_time_after_a_label_number_wins():
    assert extract_times("Arena 1 ka 8 baje", ).ambiguous_hour == 8
    assert extract_times("Arena 1 ka raat 8 baje").start == time(20, 0)
    assert extract_times("Court 2 ka 9 pm").start == time(21, 0)


def test_the_full_message_reads_the_evening_time_not_the_court_number():
    found = extract_times("Test Arena 1 ka Court 2 kal raat 9 baje")
    assert found.start == time(21, 0)


@pytest.mark.parametrize("text,hour", [("8 baje ka match", 8), ("9 ka slot", 9), ("shaam 7 ka slot", None)])
def test_a_real_time_with_ka_still_parses(text, hour):
    found = extract_times(text)
    if hour is None:
        assert found.start == time(19, 0)
    else:
        assert found.ambiguous_hour == hour


def test_a_known_name_ending_in_a_digit_is_not_a_time():
    assert not extract_times("Hub 7 ka", names=["Hub 7"]).any
    assert extract_times("Hub 7 ka").ambiguous_hour == 7  # without the facts it cannot tell: a bare "7 ka" is a time


def test_the_fold_does_not_read_the_venue_digit_as_one_am():
    from tests.test_chat_state import make_facts, run

    state = run([], "Test Arena 1 ka Court 2 kal raat 9 baje", make_facts()).state
    assert state.start_time == "21:00"
    state = run([], "Test Arena 1 ka Court 2 kal", make_facts()).state
    assert state.start_time is None and state.ambiguous_hour is None


async def test_the_code_built_availability_answer_uses_the_real_time(
    client, make_user, make_venue, make_court, make_schedule, make_pricing_rule, make_auth_headers, monkeypatch
):
    await arena(make_user, make_venue, make_court, make_schedule, make_pricing_rule)
    chat = await make_chat("app", client, make_user, make_auth_headers, monkeypatch, "+923050000071")
    model = ScriptedModel(monkeypatch)  # no scripted responses: the answer must come from code, not the model
    r = await chat.say("Test Arena 1 ka Court 2 kal raat 9 baje 2 ghante ke liye khali hai kya?")
    tomorrow = pkt_today() + timedelta(days=1)
    assert model.bodies == []
    assert "9:00 PM" in r["reply"] and "1:00 AM" not in r["reply"] and "Court 2" in r["reply"], r
    assert f"{tomorrow.day}" in r["reply"]
