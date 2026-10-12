"""Property checks over thousands of generated conversations (no database, no model): whatever the player writes, the guard layer never crashes,
never sends an unsafe or multi-question reply, never names a sport / court that does not exist, and never gets stuck asking the same thing forever."""

import random
import re

from app.services import chat_guards as G
from app.services.chat_state import ChatState, ask_fields, select_history
from app.services.chat_validator import style_violations
from tests.test_chat_state import make_facts, one_sport_facts, run

POOL = [
    # greetings, thanks, acknowledgements
    "hi", "hello", "Assalam o alaikum", "salam", "thanks", "shukriya", "ok", "okay", "haan", "yes", "no", "nahi", "theek hai", "ji",
    # booking talk, English and Roman Urdu, typos
    "I need booking", "Mjhy booking chayie", "booking chahiye", "I want to book a court", "court book krna hai", "Kon kon say available hai court ?",
    "padel", "Padel Court 2", "Court 3", "futsal", "Furtsal!", "Circket?", "paddle", "cricket nets", "tennis", "badminton", "squash chahiye", "football indoor",
    "futsal ya padel?", "mjhy padel ka court chayie", "Test Arena 1", "Gulshan Tennis Club",
    "kal", "aaj", "parson", "tomorrow", "friday", "sunday", "25 oct", "26/10", "11 oct", "next week", "kal subah", "aaj raat",
    "9pm", "9 baje", "9", "pm", "am", "raat", "subah", "shaam 6 baje", "7:30 pm", "21:00", "9 se 12", "9 pm to 12 am", "5 to 7 pm", "at 9",
    "2 hours", "1 hour", "do ghante", "ek ghanta", "1.5 hours", "90 minutes", "45 minutes", "3", "2",
    "padel kal 9pm 2 hours", "Futsal tomorrow 8pm for 1 hour", "kal raat 9 se 11 padel Court 2", "aaj shaam 6 baje futsal 1 ghanta",
    # price / location / hours / sports questions, bargaining
    "kitne ka hai?", "how much is padel?", "3000 phr hour mai chayie", "price kam karo", "can you do 2000 per hour?", "Test Arena 1 kahan hai?", "where is it?",
    "timings kya hain?", "what are the timings?", "kon kon se sports hain?", "which sports do you have?",
    # complaints, more options, off-topic, junk, questions for the model
    "meine upper tw btaya hai", "I already told you", "koi aur option?", "or koi option hai?", "any other time?", "mujhe pizza chahiye", "asdf", "hmm", "???", "kuch bhi",
    "parking hai kya?", "cancel my booking", "meri booking kahan hai", "payment kar di", "ek aur booking", "start over", "1", "2", "3", "",
    "Kl 8 hai 9 tw ni", "do you also have a cafe and washrooms for the players?", "اردو میں بات", "ok 9pm", "yes but 9pm",
]


def conversation(seed: int, facts_factory):
    rng = random.Random(seed)
    facts = facts_factory()
    facts.venues[0].hours = "6:00 AM to 11:00 PM every day"
    rows, minutes = [], 170
    replies = []
    for turn in range(rng.randint(2, 9)):
        message = rng.choice(POOL)
        fold = run(rows, message, facts)
        decision = G.decide(fold, facts)
        yield facts, rows, message, fold, decision, replies
        reply = decision.reply if decision else "Sure."  # the model's turn: a harmless stand-in
        rows = rows + [("player", message, minutes), ("ai", reply, minutes - 1)]
        minutes -= 2
        replies.append(decision.reply if decision else None)


def check(facts, rows, message, fold, decision):
    # the state is a pure function of the history (same answer twice) and survives being stored in meta
    again = run(rows, message, facts)
    assert again.state.to_dict() == fold.state.to_dict()
    assert ChatState.from_dict(fold.state.to_dict()).to_dict() == fold.state.to_dict()
    # the history the model gets starts with the player, and a window never contains anything the state forgot
    history = select_history(fold.window, fold.sources)
    assert not history or history[0]["role"] == "user"
    real_sports = {s.lower() for s in facts.sports()}
    real_courts = {c.name.lower() for v in facts.venues for c in v.courts}
    if decision is None:
        return
    text = decision.reply
    assert text.strip() and text.isascii(), (message, text)
    assert style_violations(text) == [], (message, text)
    assert text.count("?") <= 1, (message, text)
    assert not re.search(r"\bnone\b|\bNone\b|\{|\}", text), (message, text)
    for court in re.findall(r"\bCourt [A-Z0-9]{1,2}\b", text):
        assert court.lower() in real_courts, (message, text)
    assert decision.pending in (None, *G.ASKABLE, "confirm", "show_venues", "name", "choice"), decision
    # what the reply says it asks is what the next turn will treat as the pending question (so a reply is matched to ITS question)
    if decision.pending in ("sport", "venue", "court", "date", "time", "ampm", "duration", "show_venues"):
        assert ask_fields(text)[:1] == [decision.pending], (message, text, decision.pending)
    if decision.pending is None:
        assert "?" not in text, (message, text)
    # it never asks for something the state already has (the state is the one place that knows)
    s = fold.state
    known = {
        "sport": s.known("sport"), "venue": s.known("venue"), "court": s.known("court"), "date": s.known("date"),
        "time": s.start_time is not None and s.ambiguous_hour is None, "ampm": s.start_time is not None, "duration": s.known("duration"),
    }
    if decision.kind not in ("choices", "handoff"):
        assert not known.get(decision.pending or "", False), (message, text, decision.pending, s)
    # nothing in the state is a bare guess, and a multi-sport venue's sport is never filled in for the player
    assert "assumed" not in s.prov.values(), s
    if s.prov.get("sport") == "tool_result":
        venue = facts.venue(s.venue_id)
        assert venue is not None and len(venue.sports) == 1, (message, s)
    # a bare yes / ok / thanks / greeting never gets a booking step
    if message.strip().lower() in {"ok", "okay", "thanks", "shukriya", "hi", "hello", "salam"} and not rows:
        assert decision.kind in ("ack", "thanks", "greeting"), (message, decision)


def test_guards_survive_thousands_of_generated_conversations():
    checked = 0
    for seed in range(700):
        for facts, rows, message, fold, decision, _ in conversation(seed, lambda: make_facts(with_tennis_elsewhere=bool(seed % 2))):
            check(facts, rows, message, fold, decision)
            checked += 1
    assert checked > 2500


def test_a_one_sport_venue_survives_too():
    for seed in range(200):
        for facts, rows, message, fold, decision, _ in conversation(seed, one_sport_facts):
            check(facts, rows, message, fold, decision)


def test_the_same_junk_never_loops_forever_it_ends_in_a_handoff():
    facts = make_facts()
    first = G.decide(run([], "hello", facts), facts)
    rows, kinds = [("player", "hello", 120), ("ai", first.reply, 119)], []  # the greeting asked which sport
    for i in range(8):
        fold = run(rows, "asdf", facts)
        d = G.decide(fold, facts)
        kinds.append(d.kind if d else "model")
        rows = rows + [("player", "asdf", 100 - 2 * i), ("ai", d.reply if d else "x", 99 - 2 * i)]
    assert "handoff" in kinds and kinds.index("handoff") <= 4
