"""The reply safety check (Khelo Phase 3): every model-written final reply is validated BEFORE it is sent.

`validate(draft, ctx)` returns the list of problems with the draft. The caller (`AIChatService.process_message`) regenerates once with
`corrective_instruction(...)` and, if the second draft still fails, sends a safe localized fallback template. The checks:

    empty            nothing to send
    repeat           (a) the same text as one of the bot's last messages
    asked_answered   (b) asks for something the state already knows (sport, court, date, start time, duration)
    multi_question   asks two or more questions at once
    unknown_fact     (c) mentions a price, clock time, court or sport that is not in the real facts / tool results of this turn
    contradiction    (d) names another date, or another sport, than the one the player asked for
    wrong_language   (e) is not in the player's language (Roman Urdu or English)
    stale_intent     (g) does not answer the player's LAST message (price question answered without a price, ...)
    bad_proposal     offers a Yes/No booking while a field is not player-sourced, or for a slot that is not what they asked

Style problems (f) (markdown bold, emoji, 24-hour times, UTC) are repaired by `sanitize_reply` rather than regenerated: repairing is
deterministic and never costs a model call; `style_violations` reports them for tests and logs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from app.services.chat_facts import PlatformFacts
from app.services.chat_language import score
from app.services.chat_state import (
    ChatState,
    TurnFacts,
    ask_fields,
    canonical_sport,
    confirmable,
    display_time,
    extract_times,
    scan_sports,
)
from app.utils.timezone import contains_24h_time

_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF←-⇿⌀-⏿■-◿☀-➿⤀-⥿⬀-⯿️‍⃣]+"
)
_MD_BOLD_RE = re.compile(r"(\*\*|__)(.+?)\1", re.DOTALL)
_UTC_RE = re.compile(r"(?i)\bUTC\b|\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")
_PKR_RE = re.compile(r"PKR\s?([\d,]+(?:\.\d+)?)")
_CLOCK_RE = re.compile(r"\b(\d{1,2}):(\d{2}) ?(AM|PM)\b")
_DATE_LABEL_RE = re.compile(r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b")
_COURT_MENTION_RE = re.compile(r"\bCourt ([A-Z0-9]{1,2})\b")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

MAX_QUESTIONS = 1


def strip_emoji(text: str) -> str:
    return re.sub(r"[ \t]{2,}", " ", _EMOJI_RE.sub("", text or "")).strip()


def style_violations(text: str) -> list[str]:
    out = []
    if _MD_BOLD_RE.search(text or ""):
        out.append("markdown")
    if _EMOJI_RE.search(text or ""):
        out.append("emoji")
    if contains_24h_time(text or ""):
        out.append("24h_time")
    if _UTC_RE.search(text or ""):
        out.append("utc")
    return out


@dataclass
class Issue:
    code: str
    detail: str = ""


@dataclass
class ValidationContext:
    state: ChatState
    facts: PlatformFacts
    turn: TurnFacts
    previous_ai: list[str] = field(default_factory=list)  # the bot's earlier replies in this conversation, oldest first
    player_texts: list[str] = field(default_factory=list)  # the player's messages in this conversation incl. the current one
    tool_text: str = ""  # everything the tools returned this turn
    actions: list = field(default_factory=list)  # ChatAction-like: .type, .data

    @property
    def lang(self) -> str:
        return self.state.language


def _norm(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (text or "").lower()))


def _normalize_clock(h: str, m: str, ap: str) -> str:
    return f"{int(h)}:{m} {ap.upper()}"


def _clock_set(text: str) -> set[str]:
    return {_normalize_clock(*m) for m in _CLOCK_RE.findall(text or "")}


def _amounts(text: str) -> set[str]:
    return {m.replace(",", "") for m in _PKR_RE.findall(text or "")}


def _allowed_times(ctx: ValidationContext) -> set[str]:
    allowed = _clock_set(ctx.tool_text)
    for prev in ctx.previous_ai[-4:]:
        allowed |= _clock_set(prev)
    for venue in ctx.facts.venues:
        allowed |= _clock_set(venue.hours or "")
    for value in (ctx.state.start_time, ctx.state.end_time):
        shown = display_time(value)
        if shown:
            allowed.add(shown)
    for text in ctx.player_texts[-8:]:
        clock = extract_times(text)
        for t in (clock.start, clock.end):
            if t is not None:
                allowed.add(display_time(f"{t.hour:02d}:{t.minute:02d}"))
        for h in (clock.ambiguous_hour, clock.ambiguous_end_hour):
            if h:
                allowed |= {f"{h}:00 AM", f"{h}:00 PM"}
        allowed |= _clock_set(text)
    if ctx.state.ambiguous_hour:
        allowed |= {f"{ctx.state.ambiguous_hour}:00 AM", f"{ctx.state.ambiguous_hour}:00 PM"}
    return allowed


def _allowed_amounts(ctx: ValidationContext) -> set[str]:
    allowed = _amounts(ctx.tool_text)
    for prev in ctx.previous_ai[-4:]:
        allowed |= _amounts(prev)
    for venue in ctx.facts.venues:
        for court in venue.courts:
            if court.from_price is not None:
                allowed |= _amounts(court.price_line or "")
    for action in ctx.actions:
        price = (getattr(action, "data", None) or {}).get("total_price_text")
        if price:
            allowed |= _amounts(price)
    return allowed


def _questions(text: str) -> int:
    return len(re.findall(r"\?", text or ""))


def _real_canons(facts: PlatformFacts) -> set[str]:
    return {canonical_sport(s.lower()) or s.lower() for s in facts.sports()}


def _court_names(facts: PlatformFacts) -> dict[str, str]:
    """lower court suffix ("a", "2") -> sport of that court, for every real "Court X" (ambiguity keeps the first)."""
    out: dict[str, str] = {}
    for venue in facts.venues:
        for court in venue.courts:
            name = court.name.strip()
            if name.lower().startswith("court "):
                out.setdefault(name[6:].strip().lower(), court.sport.lower())
    return out


def check_language(draft: str, lang: str) -> bool:
    """True when the draft is NOT in the player's language."""
    ru, en = score(draft)
    if lang == "ru":
        return ru == 0 and en >= 3
    return ru >= 2 and ru > en


def validate(draft: str, ctx: ValidationContext) -> list[Issue]:
    issues: list[Issue] = []
    text = (draft or "").strip()
    state, turn = ctx.state, ctx.turn
    if not text:
        return [Issue("empty")]

    # (a) repeats a recent bot message
    if len(text) >= 30:
        norm = _norm(text)
        for prev in ctx.previous_ai[-2:]:
            if SequenceMatcher(None, norm, _norm(prev)).ratio() >= 0.92:
                issues.append(Issue("repeat", "the same text as your previous message"))
                break

    # (b) asks something the state already knows / (c) too many questions
    asked = ask_fields(text)
    answered = {
        "sport": state.known("sport"),
        "venue": state.known("venue"),
        "court": state.known("court"),
        "date": state.known("date"),
        "time": state.start_time is not None and state.prov.get("start_time") != "assumed" and state.ambiguous_hour is None,
        "ampm": state.start_time is not None and state.ambiguous_hour is None,
        "duration": state.known("duration"),
    }
    for kind in asked:
        if answered.get(kind):
            issues.append(Issue("asked_answered", kind))
    if _questions(text) > MAX_QUESTIONS:
        issues.append(Issue("multi_question", f"{_questions(text)} questions"))

    # (c) facts that do not exist
    unknown: list[str] = []
    allowed_amounts = _allowed_amounts(ctx)
    for amount in _amounts(text):
        if amount not in allowed_amounts:
            unknown.append(f"PKR {amount}")
    allowed_times = _allowed_times(ctx)
    for clock in _clock_set(text):
        if clock not in allowed_times:
            unknown.append(clock)
    real = _real_canons(ctx.facts)
    said_by_player = {c for t in ctx.player_texts for c in scan_sports(t, ctx.facts.sports())}
    if real:
        for canon in scan_sports(text, ctx.facts.sports()):
            if canon not in real and canon not in said_by_player:
                unknown.append(canon)
    courts = _court_names(ctx.facts)
    if ctx.facts.venues:
        for suffix in _COURT_MENTION_RE.findall(text):
            if suffix.lower() not in courts:
                unknown.append(f"Court {suffix}")
    if unknown:
        issues.append(Issue("unknown_fact", ", ".join(sorted(set(unknown)))))

    # (d) contradicts the state
    contradictions: list[str] = []
    if state.player_sourced("date") and state.date:
        want_day, want_month = int(state.date[8:10]), _MONTHS[int(state.date[5:7]) - 1]
        tool_dates = {(int(d), mo) for d, mo in _DATE_LABEL_RE.findall(ctx.tool_text)}
        for d, mo in _DATE_LABEL_RE.findall(text):
            if (int(d), mo) != (want_day, want_month) and (int(d), mo) not in tool_dates:
                contradictions.append(f"date {d} {mo}")
    if state.sport and state.known("sport"):
        want = canonical_sport(state.sport.lower()) or state.sport.lower()
        mentioned = set(scan_sports(text, ctx.facts.sports()))
        if mentioned and want not in mentioned and not (mentioned & said_by_player):
            contradictions.append(f"sport {', '.join(sorted(mentioned))}")
        mention_sports = {courts.get(s.lower()) for s in _COURT_MENTION_RE.findall(text)} - {None}
        if mention_sports and state.sport.lower() not in mention_sports and want not in mentioned:
            contradictions.append("court of another sport")
    if contradictions:
        issues.append(Issue("contradiction", "; ".join(contradictions)))

    # (e) language
    if check_language(text, ctx.lang):
        issues.append(Issue("wrong_language", ctx.lang))

    # (g) answers the player's LAST message
    lowered = text.lower()
    has_slot = bool(re.search(r"\d{1,2}:\d{2} (?:AM|PM) to ", text))
    if turn.intent in ("greeting", "thanks") and (has_slot or _PKR_RE.search(text)):
        issues.append(Issue("stale_intent", f"the player only said {turn.intent}"))
    elif turn.intent == "price_question" and not _PKR_RE.search(text) and not re.search(r"(?i)price|rate|qeemat|cost|charges|fee", lowered):
        issues.append(Issue("stale_intent", "the player asked about the price"))
    elif turn.intent == "sport_question" and not scan_sports(text, ctx.facts.sports()):
        issues.append(Issue("stale_intent", "the player asked which sports are available"))

    # Yes / No proposals
    confirm_action = next((a for a in ctx.actions if getattr(a, "type", "") == "confirm_booking"), None)
    asks_confirm = "confirm" in asked
    if (confirm_action is not None or asks_confirm) and not confirmable(state):
        issues.append(Issue("bad_proposal", "the player has not given every detail themselves"))
    elif asks_confirm and confirm_action is None:
        issues.append(Issue("bad_proposal", "there is no valid proposal to confirm"))
    return issues


_INSTRUCTIONS = {
    "empty": "Your last draft was empty. Write one short reply.",
    "repeat": "Your draft repeats your previous message. Say something different that moves the booking forward, in fewer words.",
    "asked_answered": "Do not ask about {detail}: the player already told you (see the conversation state). Ask only for what is still missing.",
    "multi_question": "Ask exactly ONE question. Remove the others.",
    "unknown_fact": "Your draft mentions {detail}, which is not in the real facts or tool results. Mention only what the facts or tool results contain.",
    "contradiction": "Your draft contradicts what the player asked for ({detail}). Stay with the sport, court, date and time in the conversation state.",
    "wrong_language": "Write the reply in the player's language: {lang}. Plain text only.",
    "stale_intent": "Answer the player's LAST message directly ({detail}); do not answer an older message.",
    "bad_proposal": "Do not offer a Yes/No booking yet ({detail}). Ask the ONE next question instead.",
}


def corrective_instruction(issues: list[Issue], ctx: ValidationContext) -> str:
    lang_name = "Roman Urdu" if ctx.lang == "ru" else "English"
    lines = [_INSTRUCTIONS[i.code].format(detail=i.detail, lang=lang_name) for i in issues if i.code in _INSTRUCTIONS]
    return "Your previous draft was rejected by the safety check. Fix it and reply again: " + " ".join(lines)
