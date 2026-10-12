"""The deterministic conversation-state extractor (no database, no model): sports with typos, dates, times, durations, venue / court names,
provenance, the conversation boundary, the history window and the state-driven "what is still missing" order."""

from datetime import date, datetime, time, timedelta, timezone

import pytest

from app.services.chat_facts import CourtFact, PlatformFacts, VenueFact
from app.services.chat_state import (
    ASSUMED,
    BUTTON,
    PLAYER,
    TOOL,
    ChatState,
    Row,
    ask_fields,
    confirmable,
    extract_date,
    extract_duration,
    extract_times,
    fold_state,
    is_chit_chat,
    missing_fields,
    numbered_options,
    scan_sports,
    select_history,
)

TODAY = date(2026, 10, 13)  # a Tuesday
NOW = datetime(2026, 10, 13, 9, 0, tzinfo=timezone.utc)  # 2:00 PM in Pakistan, same calendar day


def court(cid, name, sport, minutes=60, price=3000.0):
    return CourtFact(id=cid, name=name, sport=sport, indoor=False, min_minutes=minutes, from_price=price)


def make_facts(with_tennis_elsewhere=False) -> PlatformFacts:
    arena = VenueFact(
        id="v1", name="Test Arena 1", city="Karachi", area="Clifton", address="Plot 5, Clifton",
        courts=[court("c-net", "Cricket Net", "Cricket"), court("c-a", "Court A", "Futsal"), court("c-2", "Court 2", "Padel"), court("c-3", "Court 3", "Padel")],
    )
    venues = [arena]
    if with_tennis_elsewhere:
        venues.append(VenueFact(id="v2", name="Gulshan Tennis Club", city="Karachi", area=None, address="Gulshan", courts=[court("c-t", "Court 1", "Tennis")]))
    return PlatformFacts(venues=venues)


def one_sport_facts() -> PlatformFacts:
    return PlatformFacts(venues=[VenueFact(id="v9", name="Maidan Court", city="Karachi", area=None, address="x", courts=[court("c-9", "Court 1", "Padel")])])


def at(minutes_ago: float) -> datetime:
    return NOW - timedelta(minutes=minutes_ago)


def run(messages, current, facts=None, **kw):
    """messages: [(role, text, minutes_ago)] oldest first; returns the FoldResult for `current`."""
    rows = [Row(role=r, text=t, at=at(m)) for r, t, m in messages]
    return fold_state(rows, current, facts if facts is not None else make_facts(), NOW, **kw)


# --- dates ----------------------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("aaj", date(2026, 10, 13)),
        ("Aj 9pm ki booking hai?", date(2026, 10, 13)),
        ("tonight", date(2026, 10, 13)),
        ("kal", date(2026, 10, 14)),
        ("Kl 8 hai 9 tw ni", date(2026, 10, 14)),
        ("tomorrow evening", date(2026, 10, 14)),
        ("parson", date(2026, 10, 15)),
        ("day after tomorrow", date(2026, 10, 15)),
        ("friday", date(2026, 10, 16)),
        ("Saturday please", date(2026, 10, 17)),
        ("itwar ko", date(2026, 10, 18)),
        ("tuesday", date(2026, 10, 13)),
        ("25 oct", date(2026, 10, 25)),
        ("25th of October", date(2026, 10, 25)),
        ("October 25", date(2026, 10, 25)),
        ("25/10", date(2026, 10, 25)),
        ("25/10/2026", date(2026, 10, 25)),
        ("20 tarikh", date(2026, 10, 20)),
        ("5 jan", date(2027, 1, 5)),
    ],
)
def test_dates(text, expected):
    found, _ = extract_date(text, TODAY)
    assert found is not None and found.value == expected and not found.past


def test_a_date_that_already_passed_is_flagged_not_used():
    found, _ = extract_date("11 oct", TODAY)
    assert found is not None and found.past and found.value == date(2026, 10, 11)


@pytest.mark.parametrize("text", ["padel", "9 baje", "2 hours", "Court 2", "mjhy booking chayie", "3000 phr hour mai chayie"])
def test_no_date_where_there_is_none(text):
    assert extract_date(text, TODAY)[0] is None


# --- times ------------------------------------------------------------------------------------------------------------------------------


def hhmm(t):
    return None if t is None else f"{t.hour:02d}:{t.minute:02d}"


@pytest.mark.parametrize(
    "text, start, end",
    [
        ("9pm", "21:00", None),
        ("9 pm", "21:00", None),
        ("9:30 pm", "21:30", None),
        ("9:30pm", "21:30", None),
        ("21:00", "21:00", None),
        ("aaj raat 9", "21:00", None),
        ("raat 9 baje", "21:00", None),
        ("subah 6 baje", "06:00", None),
        ("subah 9", "09:00", None),
        ("shaam 5 baje", "17:00", None),
        ("9 baje shaam", "21:00", None),
        ("9 pm to 12 am", "21:00", "00:00"),
        ("5 to 7 pm", "17:00", "19:00"),
        ("9am to 12", "09:00", "12:00"),
        ("9 pm to 12", "21:00", "00:00"),
        ("12 baje raat", "00:00", None),
        ("midnight", "00:00", None),
        ("raat 9 se 12", "21:00", "00:00"),
        ("4 se 6 shaam", "16:00", "18:00"),
    ],
)
def test_clear_times(text, start, end):
    found = extract_times(text)
    assert hhmm(found.start) == start and hhmm(found.end) == end and found.ambiguous_hour is None


@pytest.mark.parametrize(
    "text, hour, end_hour",
    [("9 baje", 9, None), ("at 9", 9, None), ("Kl ki chayie 9 ki", 9, None), ("9 se 12 ka court chayie or 3000 phr hour mai chayie", 9, 12), ("9:00", 9, None)],
)
def test_an_hour_without_am_or_pm_stays_ambiguous(text, hour, end_hour):
    found = extract_times(text)
    assert found.start is None and found.ambiguous_hour == hour and found.ambiguous_end_hour == end_hour


@pytest.mark.parametrize("text", ["padel", "kal", "3000", "I want 2 hours", "mjhy booking chayie", "Court 2", "meine upper tw btaya hai"])
def test_no_time_where_there_is_none(text):
    found = extract_times(text)
    assert found.start is None and found.ambiguous_hour is None


# --- durations --------------------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text, minutes",
    [
        ("2 hours", 120), ("2 ghante", 120), ("do ghante", 120), ("ek ghanta", 60), ("1 hour", 60), ("1.5 hours", 90), ("dedh ghanta", 90),
        ("90 minutes", 90), ("half hour", 30), ("3 hrs", 180), ("dhai ghante", 150), ("teen ghante", 180),
    ],
)
def test_durations(text, minutes):
    assert extract_duration(text)[0] == minutes


@pytest.mark.parametrize("text", ["45 minutes", "padel", "3000 phr hour mai", "9 baje", "per hour"])
def test_no_duration(text):
    assert extract_duration(text)[0] is None


# --- sports: typos against the real list --------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text, canon",
    [
        ("Circket?", "cricket"), ("cricket nets", "cricket"), ("Furtsal!", "futsal"), ("futsal", "futsal"), ("football indoor", "futsal"),
        ("paddle", "padel"), ("padle", "padel"), ("Padel ka court", "padel"), ("tenis", "tennis"), ("badmintan", "badminton"), ("soccer", "football"),
    ],
)
def test_sport_words_and_typos(text, canon):
    assert scan_sports(text) == [canon]


@pytest.mark.parametrize(
    "text",
    ["mjhy booking chayie", "Is the 5pm slot available tomorrow?", "ticket", "ground floor", "tomorrow", "available", "hours", "court", "price", "I need a booking please", "meine upper tw btaya hai"],
)
def test_ordinary_words_are_not_sports(text):
    assert scan_sports(text) == []


def test_two_sports_in_one_message():
    assert scan_sports("futsal ya padel?") == ["futsal", "padel"]


# --- whole sentences, the way players actually write them -------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text, sport, day, start, minutes",
    [
        ("kal raat 9 baje se 11 baje tak futsal", "Futsal", "2026-10-14", "21:00", 120),
        ("aaj shaam 6 se 8 padel Court 2", "Padel", "2026-10-13", "18:00", 120),
        ("kal subah 10 baje se 12 baje tak padel Court 3", "Padel", "2026-10-14", "10:00", 120),
        ("parson 7pm padel Court 2 2 ghantay", "Padel", "2026-10-15", "19:00", 120),
        ("5 pm tomorrow futsal 1 hr", "Futsal", "2026-10-14", "17:00", 60),
        ("Futsal friday 8-10 pm", "Futsal", "2026-10-16", "20:00", 120),
        ("26/10 ko 9 pm padel Court 2", "Padel", "2026-10-26", "21:00", None),
        ("Can I book Court A on 20 October from 6pm to 8pm?", "Futsal", "2026-10-20", "18:00", 120),
        ("book padel Court 2 for 2 hours tonight", "Padel", "2026-10-13", None, 120),
        ("Tomorrow morning 7 am futsal", "Futsal", "2026-10-14", "07:00", None),
        ("7 shaam futsal kal", "Futsal", "2026-10-14", "19:00", None),
        ("futsal kal raat ke 10 baje", "Futsal", "2026-10-14", "22:00", None),
        ("padel Court 2 19:00 se 21:00 kal", "Padel", "2026-10-14", "19:00", 120),
        ("kal 9:30 pm futsal", "Futsal", "2026-10-14", "21:30", None),
        ("dopahar 2 baje futsal kal 1 ghanta", "Futsal", "2026-10-14", "14:00", 60),
        ("sunday ko 4 se 6 baje shaam padel Court 3", "Padel", "2026-10-18", "16:00", 120),
        ("1 AM to 3 AM futsal kal", "Futsal", "2026-10-14", "01:00", 120),
        ("kal ke liye 2 ghante ka padel court chahiye subah 7 baje Court 2", "Padel", "2026-10-14", "07:00", 120),
        ("futsal 12 baje raat kal", "Futsal", "2026-10-14", "00:00", None),
        ("Court 2 ka slot kal", "Padel", "2026-10-14", None, None),
        ("9 se 12 ka futsal kal raat", "Futsal", "2026-10-14", "21:00", 180),
    ],
)
def test_real_sentences(text, sport, day, start, minutes):
    s = run([], text).state
    assert (s.sport, s.date, s.start_time, s.duration_minutes) == (sport, day, start, minutes), (text, s)


# --- the fold: state from messages ------------------------------------------------------------------------------------------------------------


def test_everything_in_one_message_is_player_sourced():
    fold = run([], "Padel Court 2 kal 9pm 2 ghante")
    s = fold.state
    assert (s.sport, s.court_name, s.date, s.start_time, s.duration_minutes) == ("Padel", "Court 2", "2026-10-14", "21:00", 120)
    assert all(s.prov[f] == PLAYER for f in ("sport", "court", "date", "start_time", "duration"))
    assert s.end_time == "23:00" and confirmable(s) and missing_fields(s, make_facts()) == []


def test_a_one_sport_venue_settles_venue_sport_and_court_by_itself_but_not_the_times():
    s = run([], "kal 9pm", one_sport_facts()).state
    assert (s.venue_name, s.sport, s.court_name) == ("Maidan Court", "Padel", "Court 1")
    assert s.prov["venue"] == s.prov["sport"] == s.prov["court"] == TOOL
    assert s.prov["start_time"] == PLAYER and missing_fields(s, one_sport_facts()) == ["duration"]
    assert not confirmable(s)  # duration was never said


def test_a_multi_sport_venue_never_gets_a_sport_chosen_for_the_player():
    s = run([], "mjhy booking chayie").state
    assert s.sport is None and s.venue_name == "Test Arena 1"  # the only venue is a database fact, the sport is the player's choice
    assert missing_fields(s, make_facts())[0] == "sport"


def test_missing_fields_follow_the_required_order():
    facts = make_facts()
    s = run([], "Padel").state
    assert missing_fields(s, facts) == ["court", "date", "time", "duration"]  # two padel courts: ask which
    s = run([], "Futsal").state  # one futsal court: derived
    assert s.court_name == "Court A" and missing_fields(s, facts) == ["date", "time", "duration"]
    s = run([], "Futsal kal").state
    assert missing_fields(s, facts) == ["time", "duration"]
    s = run([], "Futsal kal 9 baje").state
    assert s.ambiguous_hour == 9 and s.start_time is None and missing_fields(s, facts) == ["time", "duration"]


def test_listing_questions_only_need_sport_and_date():
    facts = make_facts()
    s = run([], "kon kon say available hai court?").state
    assert s.mode == "listing" and missing_fields(s, facts) == ["sport", "date"]
    s = run([("player", "kon kon say available hai court?", 5), ("ai", "Aap kaun sa sport khelna chahte hain: Cricket, Futsal aur Padel?", 4)], "padel").state
    assert s.mode == "listing" and missing_fields(s, facts) == ["date"]


def test_a_value_the_player_states_overrides_an_older_one():
    msgs = [("player", "Padel Court 2 kal 9pm", 10), ("ai", "ok", 9)]
    s = run(msgs, "nahi parson 8pm Futsal").state
    assert (s.date, s.start_time, s.sport, s.court_name) == ("2026-10-15", "20:00", "Futsal", "Court A")


def test_facts_said_twenty_messages_earlier_are_still_known():
    msgs = [("player", "Padel Court 2 kal 9pm 2 ghante", 100), ("ai", "Court 2 par kal 9:00 PM ka slot hai. Shall I book it?", 99)]
    for i in range(20):  # chit-chat afterwards (all inside the 3 hour window)
        msgs.append(("player", "ok" if i % 2 else "thanks", 90 - i * 3))
        msgs.append(("ai", "Theek hai.", 89 - i * 3))
    fold = run(msgs, "haan")
    s = fold.state
    assert (s.sport, s.court_name, s.date, s.start_time, s.duration_minutes) == ("Padel", "Court 2", "2026-10-14", "21:00", 120)


def test_the_history_window_keeps_the_defining_turn_and_drops_old_chit_chat():
    msgs = [("player", "Padel Court 2 kal 9pm 2 ghante", 150), ("ai", "Shall I book it?", 149)]
    for i in range(12):
        msgs.append(("player", "ok" if i % 2 else "thanks", 120 - i * 3))
        msgs.append(("ai", f"Theek hai {i}.", 119 - i * 3))
    fold = run(msgs, "haan")
    history = select_history(fold.window, fold.sources)
    texts = [h["content"] for h in history]
    assert "Padel Court 2 kal 9pm 2 ghante" in texts  # 20+ messages earlier, but it DEFINES the state
    assert history[0]["role"] == "user"
    assert len(history) < len(msgs)
    # the old chit-chat was dropped; the last turns are kept
    assert texts.count("ok") + texts.count("thanks") <= 8 and "Theek hai 11." in texts


def test_numbered_choice_picks_that_line_with_button_provenance():
    ask = "I am having trouble understanding. Please reply with the number of one option:\n1. Cricket\n2. Futsal\n3. Padel"
    assert numbered_options(ask) == ["Cricket", "Futsal", "Padel"]
    s = run([("player", "asdf", 3), ("ai", ask, 2)], "2").state
    assert s.sport == "Futsal" and s.prov["sport"] == BUTTON


def test_conversation_boundary_after_three_hours_of_silence():
    old = [("player", "Padel Court 2 kal 9pm 2 ghante", 60 * 5), ("ai", "Held!", 60 * 5 - 1)]
    fold = run(old, "Mjhy booking chayie")
    s = fold.state
    assert s.sport is None and s.date is None and s.start_time is None and fold.window == []  # nothing from yesterday's chat is "known"
    # but within three hours it is
    recent = [("player", "Padel Court 2 kal 9pm 2 ghante", 60), ("ai", "ok", 59)]
    assert run(recent, "Mjhy booking chayie").state.sport == "Padel"


def test_a_gap_inside_the_history_starts_a_new_conversation():
    msgs = [("player", "Padel Court 2 kal 9pm", 60 * 8), ("ai", "ok", 60 * 8 - 1), ("player", "hello", 10), ("ai", "Hello!", 9)]
    s = run(msgs, "futsal").state
    assert s.sport == "Futsal" and s.date is None and s.start_time is None


def test_a_booking_since_ends_the_conversation():
    msgs = [("player", "Padel Court 2 kal 9pm 2 ghante", 30), ("ai", "Held!", 29)]
    floor = at(20)
    fold = run(msgs, "Mjhy booking chayie", booking_floor=floor, booking_stage="awaiting_payment")
    assert fold.state.sport is None and fold.state.date is None and fold.state.stage == "browsing"  # a new booking request
    fold = run(msgs, "ok", booking_floor=floor, booking_stage="awaiting_payment")
    assert fold.state.sport is None and fold.state.stage == "awaiting_payment"  # nothing new said: still waiting for the payment
    fold = run(msgs, "kal futsal 9pm", booking_floor=floor, booking_stage="awaiting_payment")
    assert fold.state.stage != "awaiting_payment" and fold.state.sport == "Futsal"


def test_an_explicit_new_booking_resets():
    msgs = [("player", "Padel Court 2 kal 9pm 2 ghante", 30), ("ai", "ok", 29), ("player", "ek aur booking", 5), ("ai", "ok", 4)]
    s = run(msgs, "futsal").state
    assert s.sport == "Futsal" and s.date is None


def test_am_pm_question_is_answered_by_pm():
    msgs = [("player", "Padel Court 2 kal 9 baje", 5), ("ai", "9 baje: subah (AM) ya shaam/raat (PM)?", 4)]
    assert ask_fields(msgs[1][1]) == ["ampm"]
    s = run(msgs, "pm").state
    assert s.start_time == "21:00" and s.ambiguous_hour is None


def test_range_with_both_hours_ambiguous_gets_both_from_the_answer():
    msgs = [("player", "9 se 12 ka court chayie", 5), ("ai", "9 baje: subah (AM) ya shaam/raat (PM)?", 4)]
    s = run(msgs, "raat").state
    assert s.start_time == "21:00" and s.duration_minutes == 180 and s.end_time == "00:00"


def test_accepting_one_exact_stated_slot_adopts_its_date_and_time():
    msgs = [("player", "Futsal kal 9pm", 5), ("ai", "9:00 PM nahi hai. Kya 10:00 PM to 11:00 PM, Wed 14 Oct chalega?", 4)]
    s = run(msgs, "haan").state
    assert s.start_time == "22:00" and s.date == "2026-10-14" and s.prov["start_time"] == PLAYER


def test_player_text_only_is_in_player_provenance_never_assumed():
    s = run([], "Padel").state
    assert ASSUMED not in s.prov.values()


def test_state_round_trips_through_meta():
    s = run([], "Padel Court 2 kal 9pm 2 ghante").state
    again = ChatState.from_dict(s.to_dict())
    assert again is not None and again.to_dict() == s.to_dict()
    assert ChatState.from_dict({"v": 99}) is None and ChatState.from_dict(None) is None


def test_language_follows_the_player():
    assert run([], "mjhy padel ka court chayie").state.language == "ru"
    assert run([], "I need a padel court tomorrow").state.language == "en"


def test_chit_chat_detection():
    for text in ("ok", "thanks", "hello", "Assalam o alaikum", "nahi", "shukriya", "haan"):
        assert is_chit_chat(text), text
    for text in ("ok 9pm", "kal 9 baje", "padel"):
        assert not is_chit_chat(text), text
