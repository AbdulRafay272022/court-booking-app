"""A duration the player gives as a time RANGE ("9 pm to 12 am", "9 se 12 baje tak", "9pm-12am", "from 9 to 12") is something the player said:
the range sets start AND duration with player provenance, so a Yes/No proposal is allowed. A bare start time still asks the duration question."""


import pytest

from app.services.chat_state import PLAYER, confirmable, fold_state, missing_fields
from tests.test_chat_state import NOW, make_facts, one_sport_facts, run


def fold(text, facts=None):
    return run([], text, facts or one_sport_facts()).state


@pytest.mark.parametrize(
    "text,start,minutes",
    [
        ("padel kal 9 pm to 12 am", "21:00", 180),
        ("padel kal 9pm-12am", "21:00", 180),
        ("padel kal from 9 pm to 11 pm", "21:00", 120),
        ("padel kal 7 pm to 9 pm", "19:00", 120),
        ("padel kal 10 pm to 1 am", "22:00", 180),  # overnight: end <= start means the next day
        ("padel kal 9 baje se 12 baje tak", None, None),  # no AM/PM: asks which, below
    ],
)
def test_a_time_range_gives_start_and_duration_from_the_player(text, start, minutes):
    state = fold(text)
    if start is None:
        assert state.ambiguous_hour == 9
        return
    assert state.start_time == start and state.duration_minutes == minutes
    assert state.prov["start_time"] == PLAYER and state.prov["duration"] == PLAYER
    assert state.player_sourced("duration")
    assert "duration" not in missing_fields(state, one_sport_facts()) and "time" not in missing_fields(state, one_sport_facts())
    assert confirmable(state)


def test_roman_urdu_range_with_am_pm_word_is_player_said():
    state = fold("kal padel 9 pm se 12 am tak")
    assert (state.start_time, state.duration_minutes) == ("21:00", 180)
    assert confirmable(state)


def test_roman_urdu_range_without_am_pm_resolves_after_the_pm_answer_and_is_overnight():
    first = run([], "kal padel 9 se 12 baje tak", one_sport_facts())
    assert first.state.ambiguous_hour == 9 and not confirmable(first.state)
    history = [("player", "kal padel 9 se 12 baje tak", 5), ("ai", "9 baje: subah (AM) ya shaam/raat (PM)?", 4)]
    second = run(history, "pm", one_sport_facts())
    st = second.state
    assert (st.start_time, st.duration_minutes) == ("21:00", 180)  # 9 PM to midnight
    assert st.prov["duration"] == PLAYER and confirmable(st)


def test_a_bare_start_time_still_asks_the_duration():
    state = fold("padel kal 9 pm")
    assert state.start_time == "21:00" and not state.has("duration")
    assert "duration" in missing_fields(state, one_sport_facts())
    assert not confirmable(state)


def test_an_end_equal_to_the_start_is_not_turned_into_a_free_proposal():
    # 9 pm to 9 pm is 24 hours, beyond the 6-hour booking grid: no duration is invented
    state = fold("padel kal 9 pm to 9 pm")
    assert not state.has("duration") or state.duration_minutes <= 360
