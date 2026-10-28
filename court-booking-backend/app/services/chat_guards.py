"""Server-side guards for the booking assistant (Khelo Phase 3): decide, in plain code, what to do with the player's message BEFORE any model call.

`decide(fold, facts)` returns a fixed, localized reply (`chat_templates`) when the message is a greeting / thanks / "ok", asks for a sport the
venue does not offer, asks about price / location / hours / the sports list, or when a required booking field is still missing (the ONE next
question, in the order sport, venue, court, date, start time, duration). It returns None when the model should take over (everything needed
is known, or the message is something the guards do not own, such as a cancellation). Also here: the tool-argument guards (`check_*`) that
make sure a slot search, quote or proposal only uses values the PLAYER gave, and the Yes/No action policy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from app.services import chat_templates as T
from app.services.chat_facts import CourtFact, PlatformFacts, VenueFact, sport_display
from app.services.chat_state import (
    ASSUMED,
    PLAYER_SOURCED,
    ChatState,
    FoldResult,
    TurnFacts,
    canonical_sport,
    confirmable,
    display_date,
    display_duration,
    display_time,
    match_real_sport,
    missing_fields,
)
from app.utils.timezone import pkt_date_of, utc_to_pkt_naive

# fields a bot message can ask for, i.e. a short player reply is an ANSWER to one of them
ASKABLE = ("sport", "venue", "court", "date", "time", "ampm", "duration", "choice")


@dataclass
class Decision:
    reply: str
    kind: str
    pending: str | None = None  # what this reply asks for (stored with the state)
    options: list[str] = field(default_factory=list)


# --- helpers over the facts ---------------------------------------------------------------------------------------------------------


def venue_in_play(state: ChatState, facts: PlatformFacts) -> VenueFact | None:
    return facts.venue(state.venue_id)


def sports_in_play(state: ChatState, facts: PlatformFacts) -> list[str]:
    venue = venue_in_play(state, facts)
    return venue.sports if venue else facts.sports()


def other_venues_with(canon: str, facts: PlatformFacts, exclude_id: str | None) -> list[str]:
    return [v.name for v in facts.venues if v.id != exclude_id and match_real_sport(canon, v.sports)]


def in_progress(state: ChatState) -> bool:
    """The player has told us something about the booking already (so a side question must not lose it)."""
    return any(state.player_sourced(f) for f in ("sport", "date", "start_time", "duration", "court", "venue")) or state.ambiguous_hour is not None


def summary_of(state: ChatState) -> str:
    parts = [state.sport, state.venue_name if state.player_sourced("venue") else None, state.court_name if state.player_sourced("court") else None]
    parts += [display_date(state.date), display_time(state.start_time), T.duration_words(state.duration_minutes, state.language) if state.duration_minutes else None]
    if state.ambiguous_hour and not state.start_time:
        parts.append(f"{state.ambiguous_hour} o'clock")
    return ", ".join(p for p in parts if p)


def _min_minutes(state: ChatState, facts: PlatformFacts) -> int:
    venue = venue_in_play(state, facts)
    courts = []
    if venue:
        courts = venue.courts_for(state.sport) or venue.courts
    elif state.sport:
        courts = [c for v in facts.venues for c in v.courts_for(state.sport)]
    return min((c.min_minutes for c in courts), default=60)


# --- the next question ---------------------------------------------------------------------------------------------------------------


def next_question(state: ChatState, facts: PlatformFacts, turn: TurnFacts | None, *, missing: list[str] | None = None) -> Decision | None:
    """The ONE most important missing question (sport, venue, court, date, start time with AM/PM, duration), or None when nothing is missing.
    Asked again in a shorter way when it was just asked and not answered; after two failures the numbered choices; after three the handoff."""
    lang = state.language
    missing = missing if missing is not None else missing_fields(state, facts)
    if not missing:
        return None
    wanted = missing[0]
    same_again = turn is not None and turn.pending_before is not None and (turn.pending_before == wanted or (wanted == "time" and turn.pending_before == "ampm"))
    short = same_again or state.unclear == 1
    venue = venue_in_play(state, facts)
    pending_name = "time" if wanted == "time" else wanted

    if wanted == "sport":
        sports = sports_in_play(state, facts)
        if turn is not None and turn.multi_sport:
            real = [s for s in turn.multi_sport if match_real_sport(canonical_sport(s.lower()) or s.lower(), sports)]
            return Decision(T.render("sport_multi", lang, sports=real or sports), "sport_multi", "sport")
        if turn is not None and turn.sport_word_unknown:
            return Decision(T.render("sport_unclear", lang, sports=sports), "sport_unclear", "sport")
        return Decision(T.render("ask_sport", lang, sports=sports, venue=venue.name if venue and state.player_sourced("venue") else None, short=short), "ask_sport", "sport")
    if wanted == "venue":
        venues = [v.name for v in facts.venues_with_sport(state.sport)]
        return Decision(T.render("ask_venue", lang, venues=venues, sport=state.sport, short=short), "ask_venue", "venue")
    if wanted == "court":
        courts = [c.name for c in venue.courts_for(state.sport)] if venue else []
        return Decision(T.render("ask_court", lang, courts=courts, sport=state.sport or "", venue=venue.name if venue else None, short=short), "ask_court", "court")
    if wanted == "date":
        return Decision(T.render("ask_date", lang, short=short), "ask_date", "date")
    if wanted == "time":
        if state.ambiguous_hour:
            return Decision(T.render("ask_ampm", lang, hour=state.ambiguous_hour), "ask_ampm", "ampm")
        return Decision(T.render("ask_time", lang, short=short), "ask_time", pending_name)
    return Decision(T.render("ask_duration", lang, min_minutes=_min_minutes(state, facts), short=short), "ask_duration", "duration")


def _choices_for(state: ChatState, facts: PlatformFacts, pending: str) -> tuple[str, list[str]] | None:
    """(template key, options) for the numbered-choice step."""
    venue = venue_in_play(state, facts)
    if pending == "sport":
        return "choices", sports_in_play(state, facts)
    if pending == "venue":
        return "choices", [v.name for v in facts.venues_with_sport(state.sport)]
    if pending == "court" and venue:
        return "choices", [c.name for c in venue.courts_for(state.sport)]
    if pending == "duration":
        mins = _min_minutes(state, facts)
        return "choices", [T.duration_words(mins + 30 * i, state.language) for i in range(3)]
    if pending == "ampm":
        return "choices", ["AM (morning)", "PM (evening/night)"]
    return None


def unclear_reply(state: ChatState, facts: PlatformFacts, turn: TurnFacts, support: str | None) -> Decision | None:
    """The player's message did not answer the question we asked. Re-ask once, shorter (done by `next_question`); then offer numbered choices;
    after that, offer a human."""
    lang = state.language
    pending = turn.pending_before
    if pending not in ASKABLE:
        return None
    if pending == "choice":
        pending = (missing_fields(state, facts) or ["sport"])[0]
    if state.unclear >= 3:
        return Decision(T.render("handoff", lang, support=support), "handoff", None)
    if state.unclear == 2:
        picked = _choices_for(state, facts, pending)
        if picked:
            key, options = picked
            return Decision(T.render(key, lang, options=options), "choices", "choice", options)
        example = "7 PM" if pending == "time" else "kal"
        return Decision(T.render("choices_free", lang, example=example), "choices_free", "choice")
    return next_question(state, facts, turn)


# --- the decision before any model call -----------------------------------------------------------------------------------------------


def _info_then_question(info: str, state: ChatState, facts: PlatformFacts, turn: TurnFacts, kind: str) -> Decision:
    """An answer taken from facts, followed (when a booking is in progress) by the ONE next question, so the booking state is not lost."""
    q = next_question(state, facts, None) if in_progress(state) else None
    if q is None:
        return Decision(info, kind, None)
    return Decision(info + "\n" + q.reply, kind, q.pending, q.options)


def _price_lines(state: ChatState, facts: PlatformFacts) -> tuple[list[str], VenueFact | None]:
    venue = venue_in_play(state, facts)
    venues = [venue] if venue else (facts.venues_with_sport(state.sport) if state.sport else facts.venues)
    lines: list[str] = []
    for v in venues[:4]:
        for court in v.courts_for(state.sport):
            if court.price_line:
                lines.append(f"{court.sport}, {court.name}{'' if venue else ' (' + v.name + ')'}: {court.price_line}")
    return lines[:6], venue


def decide(fold: FoldResult, facts: PlatformFacts, *, support: str | None = None) -> Decision | None:
    state, turn = fold.state, fold.turn
    lang = state.language
    if facts.empty:
        return None
    live = fold.live_proposal
    progress = bool(turn.got) or turn.adopted_slot or turn.picked_option
    pending = turn.pending_before

    # a bare yes / no while a proposal is live is the model's (and the confirmation path's) business
    if live is not None and turn.intent in ("affirmative", "negative"):
        return None
    if pending == "confirm" and turn.intent in ("affirmative", "negative", "other"):
        return None
    if pending == "name" and turn.intent in ("affirmative", "negative", "other") and not turn.got:
        return None  # "Ali Raza" answers the name question: the model carries on with the proposal

    # 0. a name that fits two venues equally ("legends arena" with "Legends Arena North" and "South"): ask which one, nothing else
    if turn.venue_choices and not state.has("venue"):
        return Decision(T.render("ask_venue", lang, venues=turn.venue_choices, short=True), "ask_venue", "venue", list(turn.venue_choices))

    # 1. a date that has already passed
    if turn.past_date and "date" not in turn.got:
        return Decision(T.render("past_date", lang), "past_date", "date")

    # 2. a sport this venue / platform does not offer: fixed, safe, localized answer built by code
    if turn.unsupported:
        shown = turn.unsupported[0]
        canon = canonical_sport(shown.lower()) or shown.lower()
        venue = venue_in_play(state, facts)
        offered = sports_in_play(state, facts)
        others = other_venues_with(canon, facts, venue.id if venue else None) if venue else []
        if len(offered) == 1 and not others:
            # one sport only: nothing to choose, so say so and carry on with the next real question (if any)
            info = T.render("sport_unsupported_single", lang, sport=shown, only=offered[0], venue=venue.name if venue else None)
            q = next_question(state, facts, None)
            if q is None:
                return Decision(info, "sport_unsupported", None)
            return Decision(info + " " + q.reply, "sport_unsupported", q.pending, q.options)
        text = T.render("sport_unsupported", lang, sport=shown, offered=offered, venue=venue.name if venue else None, others=others)
        asks = "show_venues" if others else "sport"
        return Decision(text, "sport_unsupported", asks)

    # 3. the player says "I already told you": use what was said
    if turn.complaint and in_progress(state) and not progress:
        q = next_question(state, facts, None)
        text = T.render("already_said", lang, summary=summary_of(state))
        if q is None:
            return None
        return Decision(text + " " + q.reply, "already_said", q.pending, q.options)

    # 4. questions the facts answer
    if turn.intent == "sport_question":
        sports = sports_in_play(state, facts)
        venue = venue_in_play(state, facts)
        if state.player_sourced("sport") or state.known("sport"):
            return _info_then_question(T.render("sports_list", lang, sports=sports, venue=venue.name if venue else None), state, facts, turn, "sports_list")
        return Decision(T.render("ask_sport", lang, sports=sports, venue=venue.name if venue and state.player_sourced("venue") else None), "ask_sport", "sport")
    if turn.intent == "price_question":
        lines, venue = _price_lines(state, facts)
        complete = not missing_fields(state, facts) and in_progress(state)
        if complete and not turn.bargain:
            return None  # everything is known: the model quotes the exact total with quote_booking
        if turn.bargain:
            info = T.render("price_bargain", lang, lines=lines)
            kind = "price_bargain"
        elif lines:
            info = T.render("price_info", lang, lines=lines, venue=venue.name if venue else None)
            kind = "price_info"
        else:
            info = T.render("price_unknown", lang)
            kind = "price_unknown"
        return _info_then_question(info, state, facts, turn, kind)
    if turn.intent == "location_question":
        venue = venue_in_play(state, facts)
        if venue is None and len(facts.venues) > 1:
            return Decision(T.render("ask_which_venue_info", lang, venues=[v.name for v in facts.venues]), "ask_which_venue_info", "venue")
        venue = venue or (facts.venues[0] if facts.venues else None)
        if venue is None:
            return None
        where = ", ".join(p for p in (venue.address, venue.area, venue.city) if p)
        info = T.render("location", lang, venue=venue.name, address=where) if where else T.render("location_unknown", lang)
        return _info_then_question(info, state, facts, turn, "location")
    if turn.intent == "hours_question":
        venue = venue_in_play(state, facts)
        if venue is None and len(facts.venues) > 1:
            return Decision(T.render("ask_which_venue_info", lang, venues=[v.name for v in facts.venues]), "ask_which_venue_info", "venue")
        venue = venue or (facts.venues[0] if facts.venues else None)
        if venue is None:
            return None
        info = T.render("hours", lang, venue=venue.name, hours=venue.hours) if venue.hours else T.render("hours_unknown", lang)
        return _info_then_question(info, state, facts, turn, "hours")

    # 5. chit-chat never reaches a tool
    if turn.intent == "greeting" and not progress:
        if in_progress(state):  # a hello in the middle of a booking carries on with the booking, it does not start over
            q = next_question(state, facts, None)
            return Decision(q.reply, "greeting_resume", q.pending, q.options) if q is not None else None
        sports = sports_in_play(state, facts)
        q = next_question(state, facts, None)
        if state.known("sport") and q is not None and q.pending != "sport":  # one sport only: nothing to choose, go to the next question
            return Decision(T.render("greeting_plain", lang, sport=state.sport) + " " + q.reply, "greeting", q.pending, q.options)
        return Decision(T.render("greeting", lang, sports=sports), "greeting", "sport")
    if turn.intent == "thanks" and not progress:
        return Decision(T.render("thanks", lang), "thanks", None)
    if turn.intent in ("affirmative", "negative") and not progress:
        if pending in ASKABLE:
            return unclear_reply(state, facts, turn, support)
        if "?" in (fold.prev_ai_text or ""):
            return None  # a "yes" / "no" to a question this guard layer does not own ("2 ghante khelna chahte hain?"): the model answers it
        return Decision(T.render("ack_no" if turn.intent == "negative" else "ack_idle", lang), "ack", None)

    # 6. "any other option?" is a real availability search (the model, with the state)
    if turn.more_options and state.known("sport") and state.known("date"):
        return None

    # 7. a booking request with something still missing: ask the ONE next question
    booking_turn = turn.intent == "slot_request" or progress or turn.picked_option
    if booking_turn:
        q = next_question(state, facts, turn)
        if q is not None:
            if not progress and turn.pending_before in ASKABLE and state.unclear >= 1 and turn.short and not turn.complaint:
                return unclear_reply(state, facts, turn, support)
            return q
        return None

    # 8. a short reply that answers nothing we asked
    if pending in ASKABLE and turn.short and not progress:
        return unclear_reply(state, facts, turn, support)
    return None


# --- tool-argument guards (the player must have said it) ------------------------------------------------------------------------------


def _court_hit(facts: PlatformFacts, court_id: object) -> tuple[VenueFact, CourtFact] | None:
    return facts.court(str(court_id)) if court_id else None


def _sport_error(state: ChatState, court: CourtFact, venue: VenueFact) -> str | None:
    if state.sport and state.known("sport") and court.sport.lower() != state.sport.lower():
        names = ", ".join(c.name for c in venue.courts_for(state.sport)) or "none"
        return (
            f"The player asked for {state.sport}, but this court is {court.sport}. Use a {state.sport} court of {venue.name} "
            f"({names}); never switch the player to another sport."
        )
    return None


def check_availability(state: ChatState, facts: PlatformFacts, args: dict) -> str | None:
    """An error for the model when a slot search would use something the player did not say, else None. May drop a `start_time` the player
    never gave (the search then simply lists the day's slots)."""
    hit = _court_hit(facts, args.get("court_id"))
    if hit is not None:
        venue, court = hit
        if not state.known("sport") and len(venue.sports) > 1:
            return (
                "The player has not said which sport they want. Do NOT look up slots or suggest a court yet: reply with ONE short question "
                "asking which sport (name only the sports listed in your instructions)."
            )
        err = _sport_error(state, court, venue)
        if err:
            return err
    if not state.known("date"):
        return "The player has not said which date they want. Do NOT look up slots yet: ask ONE short question for the date."
    if not state.start_time or state.prov.get("start_time") == ASSUMED:
        args.pop("start_time", None)
        args.pop("end_time", None)
    return None


def _pkt(dt_iso: object) -> datetime | None:
    try:
        dt = datetime.fromisoformat(str(dt_iso))
    except ValueError:
        return None
    return utc_to_pkt_naive(dt) if dt.tzinfo is not None else None


def check_quote_or_proposal(state: ChatState, facts: PlatformFacts, args: dict, *, proposal: bool) -> str | None:
    """A quote or a proposal must be exactly what the player asked for: their sport, date, start time and duration."""
    hit = _court_hit(facts, args.get("court_id"))
    if hit is not None:
        venue, court = hit
        err = _sport_error(state, court, venue)
        if err:
            return err
    missing = missing_fields(state, facts, mode="booking")
    missing = [m for m in missing if m not in ("court", "venue")]
    if state.ambiguous_hour is not None and "time" not in missing:
        missing.append("time")
    if missing:
        return (
            f"The player has not given the {missing[0].replace('time', 'start time')} yet. Do NOT quote or propose a slot: ask ONE short question "
            f"for the {missing[0].replace('time', 'start time')} and wait for the answer."
        )
    if proposal and not confirmable(state):
        return "The booking details are not all confirmed by the player. Do NOT propose; ask the player for what is missing."
    local = _pkt(args.get("starts_at"))
    if local is not None and state.date and state.start_time:
        if local.date().isoformat() != state.date or f"{local.hour:02d}:{local.minute:02d}" != state.start_time:
            return (
                f"The player asked for {display_date(state.date)} at {display_time(state.start_time)}. A quote or proposal must be for exactly that "
                "time. If it is not available, list the nearest available slots and ask which one they want; propose only after they choose."
            )
    duration = args.get("duration_minutes")
    if state.duration_minutes and duration not in (None, "") and str(duration) != str(state.duration_minutes):
        return f"The player asked for {display_duration(state.duration_minutes)}: pass duration_minutes={state.duration_minutes}."
    if state.duration_minutes and duration in (None, ""):
        args["duration_minutes"] = state.duration_minutes
    return None


# --- Yes / No actions ----------------------------------------------------------------------------------------------------------------------


def proposal_matches_state(state: ChatState, data: dict) -> bool:
    """The `confirm_booking` action is for exactly the date, start time and length the player gave."""
    local = _pkt(data.get("starts_at"))
    if local is None or not state.date or not state.start_time:
        return False
    if local.date().isoformat() != state.date or f"{local.hour:02d}:{local.minute:02d}" != state.start_time:
        return False
    if state.duration_minutes and int(data.get("slot_count") or 0) * 30 != state.duration_minutes:
        return False
    return True


def actions_allowed(state: ChatState, facts: PlatformFacts, data: dict) -> bool:
    """A Yes / No proposal may only be sent when every field is player-sourced and the slot is the one they asked for (pattern P3)."""
    if not confirmable(state):
        return False
    if not proposal_matches_state(state, data):
        return False
    hit = _court_hit(facts, data.get("court_id"))
    if hit is not None and state.sport and hit[1].sport.lower() != state.sport.lower():
        return False
    return True


def pkt_date_iso(dt: datetime) -> str:
    return pkt_date_of(dt).isoformat()
