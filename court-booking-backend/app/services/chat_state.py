"""Server-side conversation state for the booking assistant (Khelo Phase 3).

The state of a booking chat (venue, court, SPORT, date, start time, duration, language, stage) is computed by plain code on EVERY turn from the
player's own words, never left to the model's memory. Each slot-filling field carries a PROVENANCE:

    player_said  the player wrote it (or accepted an exact slot the bot stated)
    button       the player picked it from a numbered / tappable choice we offered
    tool_result  a database fact (the only venue with that sport, the only court of that sport ...) or a slot the system proposed
    assumed      a guess; it never overrides a player-stated value and never counts as "the player chose it"

Extraction is deterministic (no model call): sport by alias + typo tolerance matched against the REAL sports in the database (the alias table is
only a hint for recognising a sport word, never the source of which sports exist), dates (aaj/kal/parson, weekdays, "11 oct", "11/10"), times
("9pm", "9 baje", "9 se 12"), durations ("2 hours", "do ghante", "1.5 hours") and venue / court names.

Persistence needs no schema change: the reply row's `Message.meta["state"]` carries `ChatState.to_dict()` (see `AIChatService.process_message`'s
`ChatResult.state`), and the state is ALSO re-derived from the message history every turn (`fold_state`) so it works even where nothing was saved.
A CONVERSATION BOUNDARY (3 hours of silence, a booking created since, or an explicit "new booking") resets it, so yesterday's chat is never
"known" today.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable

from app.services.chat_facts import PlatformFacts, VenueFact, sport_display
from app.services.chat_language import conversation_language, score
from app.utils.timezone import pkt_date_of, pkt_today

PLAYER = "player_said"
BUTTON = "button"
TOOL = "tool_result"
ASSUMED = "assumed"
PLAYER_SOURCED = (PLAYER, BUTTON)

STAGES = ("browsing", "choosing_slot", "confirming", "awaiting_payment", "done")
CONVERSATION_GAP = timedelta(hours=3)
STATE_VERSION = 1
MIN_DURATION, MAX_DURATION = 30, 360

FIELDS = ("venue", "court", "sport", "date", "start_time", "duration")


# --- the state ---------------------------------------------------------------------------------------------------------------------


@dataclass
class ChatState:
    venue_id: str | None = None
    venue_name: str | None = None
    court_id: str | None = None
    court_name: str | None = None
    sport: str | None = None
    date: str | None = None  # ISO date, Pakistan calendar
    start_time: str | None = None  # "HH:MM", Pakistan wall clock
    duration_minutes: int | None = None
    language: str = "en"
    stage: str = "browsing"
    prov: dict[str, str] = field(default_factory=dict)  # field name -> provenance
    ambiguous_hour: int | None = None  # a start hour (1-12) said without AM/PM, waiting for the answer
    ambiguous_end_hour: int | None = None
    pending: str | None = None  # the field the bot's last message asked for
    options: list[str] = field(default_factory=list)  # numbered choices in the bot's last message
    unclear: int = 0  # consecutive player messages that did not answer the pending question
    mode: str = "booking"  # "listing" (what is available?) or "booking"
    wanted_sport: str | None = None  # a sport the player asked for that the venue does not offer (so "show me those venues" works)
    v: int = STATE_VERSION

    # --- derived -----------------------------------------------------------------------------------------------------------------

    @property
    def end_time(self) -> str | None:
        if not self.start_time or not self.duration_minutes:
            return None
        h, m = (int(x) for x in self.start_time.split(":"))
        total = (h * 60 + m + self.duration_minutes) % (24 * 60)
        return f"{total // 60:02d}:{total % 60:02d}"

    def has(self, name: str) -> bool:
        attr = {"venue": "venue_id", "court": "court_id", "duration": "duration_minutes"}.get(name, name)
        return getattr(self, attr, None) not in (None, "")

    def player_sourced(self, name: str) -> bool:
        return self.has(name) and self.prov.get(name) in PLAYER_SOURCED

    def known(self, name: str) -> bool:
        """The field has a usable value that is not a bare guess."""
        return self.has(name) and self.prov.get(name) != ASSUMED

    def clear(self, *names: str) -> None:
        for name in names:
            self.prov.pop(name, None)
            if name == "venue":
                self.venue_id = self.venue_name = None
            elif name == "court":
                self.court_id = self.court_name = None
            elif name == "duration":
                self.duration_minutes = None
            else:
                setattr(self, name, None)

    def to_dict(self) -> dict:
        return {
            "v": self.v,
            "venue": {"id": self.venue_id, "name": self.venue_name},
            "court": {"id": self.court_id, "name": self.court_name},
            "sport": self.sport,
            "date": self.date,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "duration_minutes": self.duration_minutes,
            "language": self.language,
            "stage": self.stage,
            "prov": dict(self.prov),
            "ambiguous_hour": self.ambiguous_hour,
            "ambiguous_end_hour": self.ambiguous_end_hour,
            "pending": self.pending,
            "unclear": self.unclear,
            "mode": self.mode,
            "wanted_sport": self.wanted_sport,
        }

    @classmethod
    def from_dict(cls, data: dict | None) -> "ChatState | None":
        if not isinstance(data, dict) or data.get("v") != STATE_VERSION:
            return None
        venue, court = data.get("venue") or {}, data.get("court") or {}
        return cls(
            venue_id=venue.get("id"), venue_name=venue.get("name"), court_id=court.get("id"), court_name=court.get("name"),
            sport=data.get("sport"), date=data.get("date"), start_time=data.get("start_time"),
            duration_minutes=data.get("duration_minutes"), language=data.get("language") or "en", stage=data.get("stage") or "browsing",
            prov=dict(data.get("prov") or {}), ambiguous_hour=data.get("ambiguous_hour"), ambiguous_end_hour=data.get("ambiguous_end_hour"),
            pending=data.get("pending"), unclear=int(data.get("unclear") or 0), mode=data.get("mode") or "booking",
            wanted_sport=data.get("wanted_sport"),
        )


_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def display_date(iso: str | None) -> str | None:
    if not iso:
        return None
    d = date.fromisoformat(iso)
    return f"{_WEEKDAYS[d.weekday()]} {d.day} {_MONTHS[d.month - 1]} {d.year}"


def display_time(value: str | None) -> str | None:
    if not value:
        return None
    h, m = (int(x) for x in value.split(":"))
    return f"{h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def display_duration(minutes: int | None) -> str | None:
    if not minutes:
        return None
    from app.utils.timezone import format_duration

    return format_duration(int(minutes))


# --- plain agreement (shared with webhooks through ai_chat_service) ------------------------------------------------------------------

# Words that may appear in a *plain* confirmation ("Yesss", "haan bhai book kardo", "ok"). Anything else in the message (a time, a date, "but",
# "no") means the player is saying something more, so it goes to the assistant instead of being treated as a bare yes.
_AFFIRMATIVE_RE = re.compile(
    r"^(y+e+s+|y+e+a+h*|y+e+p+|y+u+p+|y+a+|y|h+a+a*n+|h+a+a+|h+n+|o+k+a*y*|ji+|je+e+|g|sure|bilkul|zaroor|"
    r"confirm(ed)?|kardo|karo|done|theek|thik|book)$"
)
_FILLER_WORDS = frozenset(
    "bhai yaar sir please plz pls thanks thank you it this the kar do karo kardo booking hai hain sahi fine "
    "go ahead lets let s now abhi".split()
)


def is_plain_affirmative(text: str) -> bool:
    """True for a short reply that is nothing but agreement, e.g. "Yesss" or "Haan bhai yes book kardo"."""
    words = re.sub(r"[^a-z\s]", " ", (text or "").lower()).split()
    if not words or len(words) > 8:
        return False
    if not all(_AFFIRMATIVE_RE.match(w) or w in _FILLER_WORDS for w in words):
        return False
    return any(_AFFIRMATIVE_RE.match(w) for w in words)


# --- sport words --------------------------------------------------------------------------------------------------------------------

# A HINT for recognising sport words and common misspellings. It does not say which sports exist: that is always the database.
SPORT_ALIASES: dict[str, tuple[str, ...]] = {
    "cricket": ("cricket", "circket", "crickt", "cricet", "kricket", "criket", "crikcet", "cricket nets", "cricket net", "net practice", "nets"),
    "futsal": ("futsal", "furtsal", "futsl", "fustal", "footsal", "futsel", "futzal", "football indoor", "indoor football", "indoor soccer", "mini football"),
    "football": ("football", "footbal", "fotball", "foot ball", "soccer", "futball"),
    "padel": ("padel", "paddle", "padle", "paddel", "padal", "padell", "padle tennis"),
    "tennis": ("tennis", "tenis", "tennnis", "lawn tennis"),
    "badminton": ("badminton", "badmintan", "batminton", "badmington", "shuttle"),
    "squash": ("squash",),
    "basketball": ("basketball", "basket ball"),
    "volleyball": ("volleyball", "volley ball"),
    "hockey": ("hockey",),
    "snooker": ("snooker",),
    "table tennis": ("table tennis", "ping pong", "tabletennis"),
    "pickleball": ("pickleball", "pickle ball"),
}
_ALIAS_TO_CANON: dict[str, str] = {alias: canon for canon, aliases in SPORT_ALIASES.items() for alias in aliases}
_STOPWORDS_FOR_FUZZY = frozenset("court courts ground grounds venue arena booking account contact accept ticket".split())


def _fuzzy(token: str, choices: Iterable[str], cutoff: float) -> str | None:
    match = difflib.get_close_matches(token, list(choices), n=1, cutoff=cutoff)
    return match[0] if match else None


def canonical_sport(word: str, extra: dict[str, str] | None = None) -> str | None:
    """The canonical (lower-case) sport a word or short phrase means, or None. `extra` maps the REAL sport names to their canonical form."""
    w = " ".join((word or "").lower().split())
    if not w:
        return None
    table = {**_ALIAS_TO_CANON, **(extra or {})}
    if w in table:
        return table[w]
    if len(w) >= 5 and w not in _STOPWORDS_FOR_FUZZY and " " not in w:
        close = _fuzzy(w, [k for k in table if " " not in k and len(k) >= 5], 0.8)
        if close:
            return table[close]
    if " " in w and len(w) >= 8:
        close = _fuzzy(w, [k for k in table if " " in k], 0.88)
        if close:
            return table[close]
    return None


def real_sport_table(real_sports: Iterable[str]) -> dict[str, str]:
    """alias -> canonical for the real sport names themselves ("Cricket Nets" -> cricket, an unknown custom sport -> itself)."""
    table: dict[str, str] = {}
    for name in real_sports:
        low = " ".join(name.lower().split())
        table[low] = canonical_sport(low) or low
    return table


def scan_sports(text: str, real_sports: Iterable[str] = ()) -> list[str]:
    """Distinct canonical sports named in `text` (misspellings tolerated), in order of appearance."""
    extra = real_sport_table(real_sports)
    tokens = re.findall(r"[a-z]+", (text or "").lower())
    found: list[str] = []
    i = 0
    while i < len(tokens):
        canon = None
        used = 1
        if i + 1 < len(tokens):
            bigram = f"{tokens[i]} {tokens[i + 1]}"
            canon = canonical_sport(bigram, extra)
            if canon:
                used = 2
        if canon is None:
            canon = canonical_sport(tokens[i], extra)
        if canon and canon not in found:
            found.append(canon)
        i += used
    return found


def match_real_sport(canon: str, real_sports: Iterable[str]) -> str | None:
    """The display name of the real sport that `canon` means, or None when this venue / platform does not offer it."""
    for name in real_sports:
        low = " ".join(name.lower().split())
        if low == canon or (canonical_sport(low) or low) == canon:
            return sport_display(name)
    return None


# --- venue / court names ------------------------------------------------------------------------------------------------------------

_GENERIC_NAME_WORDS = frozenset("court courts arena club sports sport ground complex the and of center centre academy".split())


def _norm(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", (text or "").lower()))


def match_venue(text: str, venues: list[VenueFact]) -> VenueFact | None:
    """The one venue the text names (full name, or its distinctive words, typos tolerated); None when none or several match equally."""
    norm = _norm(text)
    if not norm:
        return None
    words = norm.split()
    best: list[tuple[int, VenueFact]] = []
    for venue in venues:
        name = _norm(venue.name)
        if not name:
            continue
        if re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", norm):
            best.append((100 + len(name), venue))
            continue
        tokens = name.split()
        distinctive = [t for t in tokens if t not in _GENERIC_NAME_WORDS and not t.isdigit() and len(t) >= 3]
        if not distinctive:
            continue
        hits = 0
        for tok in distinctive:
            if tok in words or (len(tok) >= 5 and _fuzzy(tok, [w for w in words if len(w) >= 4], 0.86)):
                hits += 1
        if hits == len(distinctive):
            best.append((10 * hits, venue))
    if not best:
        return None
    best.sort(key=lambda x: -x[0])
    if len(best) > 1 and best[0][0] == best[1][0]:
        return None
    return best[0][1]


def match_court(text: str, venue_courts: list[tuple[VenueFact, object]]) -> tuple[VenueFact, object] | None:
    """The one court the text names ("Court A", "court 2", "Centre Court"), among (venue, court) pairs; None when none or ambiguous."""
    norm = _norm(text)
    if not norm:
        return None
    hits: list[tuple[VenueFact, object]] = []
    for venue, court in venue_courts:
        name = _norm(court.name)
        if not name:
            continue
        compact = name.replace(" ", "")
        if re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", norm) or (
            name.startswith("court ") and re.search(rf"(?<![a-z0-9])court{re.escape(compact[5:])}(?![a-z0-9])", norm.replace(" ", " "))
        ):
            hits.append((venue, court))
    if len(hits) == 1:
        return hits[0]
    return None


# --- dates -------------------------------------------------------------------------------------------------------------------------

_MONTH_WORDS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6,
    "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10,
    "nov": 11, "november": 11, "dec": 12, "december": 12,
}
_MONTH_RE = "|".join(sorted(_MONTH_WORDS, key=len, reverse=True))
_WEEKDAY_WORDS = {
    "monday": 0, "mon": 0, "somwar": 0, "somvar": 0, "peer": 0, "pir": 0,
    "tuesday": 1, "tue": 1, "tues": 1, "mangal": 1, "mangalwar": 1,
    "wednesday": 2, "wed": 2, "budh": 2, "budhwar": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3, "jumerat": 3, "jumeraat": 3, "jumeraat": 3,
    "friday": 4, "fri": 4, "juma": 4, "jumma": 4,
    "saturday": 5, "sat": 5, "hafta": 5, "sanichar": 5,
    "sunday": 6, "sun": 6, "itwar": 6, "itvar": 6, "ittwar": 6,
}
_WEEKDAY_WORDS.pop("hafta", None)  # "week", not Saturday
_DAY_MONTH = re.compile(rf"(?<![\d:])(\d{{1,2}})(?:st|nd|rd|th)?\s*(?:of\s+)?({_MONTH_RE})\b(?:\s*,?\s*(20\d\d))?")
_MONTH_DAY = re.compile(rf"\b({_MONTH_RE})\s*(\d{{1,2}})(?:st|nd|rd|th)?\b(?:\s*,?\s*(20\d\d))?")
_NUMERIC_DATE = re.compile(r"(?<![\d:/.])(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?![\d:])")
_NUMERIC_DATE_DASH_YEAR = re.compile(r"(?<![\d:])(\d{1,2})-(\d{1,2})-(\d{2,4})(?![\d:])")
_ORDINAL_DAY = re.compile(r"(?<![\d:])(\d{1,2})\s*(?:st|nd|rd|th|tarikh|tareekh|tarik|date)\b")
_REL_PARSON = re.compile(r"\b(?:parson|parso|parsoon|parsun|day after tomorrow|overmorrow)\b")
_REL_KAL = re.compile(r"\b(?:kal|kl|tomorrow|tmrw|tmr|tomorow|tommorow|tomorro)\b")
_REL_AAJ = re.compile(r"\b(?:aaj|aj|today|tonight|tonite|todays)\b")


@dataclass
class DateFound:
    value: date
    past: bool = False


def _mk_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def extract_date(text: str, today: date) -> tuple[DateFound | None, str]:
    """(the date the text names or None, the text with the date words removed so the time reader does not misread them)."""
    t = (text or "").lower()
    # explicit day + month
    for rx, order in ((_DAY_MONTH, "dm"), (_MONTH_DAY, "md")):
        m = rx.search(t)
        if m:
            if order == "dm":
                day, month, year = int(m.group(1)), _MONTH_WORDS[m.group(2)], m.group(3)
            else:
                month, day, year = _MONTH_WORDS[m.group(1)], int(m.group(2)), m.group(3)
            found = _mk_date(int(year) if year else today.year, month, day)
            if found:
                if not year and found < today and (today - found).days > 90:
                    found = _mk_date(today.year + 1, month, day) or found
                return DateFound(found, found < today), t[: m.start()] + " " + t[m.end() :]
    m = _NUMERIC_DATE.search(t) or _NUMERIC_DATE_DASH_YEAR.search(t)
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), m.group(3)
        if 1 <= month <= 12 and 1 <= day <= 31:
            y = today.year if not year else (int(year) + 2000 if len(year) == 2 else int(year))
            found = _mk_date(y, month, day)
            if found:
                if not year and found < today and (today - found).days > 90:
                    found = _mk_date(today.year + 1, month, day) or found
                return DateFound(found, found < today), t[: m.start()] + " " + t[m.end() :]
    if _REL_PARSON.search(t):
        return DateFound(today + timedelta(days=2)), t
    if _REL_KAL.search(t):
        return DateFound(today + timedelta(days=1)), t
    if _REL_AAJ.search(t):
        return DateFound(today), t
    for word in re.findall(r"[a-z]+", t):
        if word in _WEEKDAY_WORDS:
            delta = (_WEEKDAY_WORDS[word] - today.weekday()) % 7
            return DateFound(today + timedelta(days=delta)), t
    m = _ORDINAL_DAY.search(t)
    if m:
        day = int(m.group(1))
        if 1 <= day <= 31:
            found = _mk_date(today.year, today.month, day)
            if found is None or found < today:
                nm = today.month % 12 + 1
                found = _mk_date(today.year + (1 if today.month == 12 else 0), nm, day)
            if found:
                return DateFound(found), t[: m.start()] + " " + t[m.end() :]
    return None, t


# --- durations ---------------------------------------------------------------------------------------------------------------------

_NUM_WORDS = {
    "ek": 1, "one": 1, "do": 2, "two": 2, "teen": 3, "three": 3, "char": 4, "chaar": 4, "four": 4, "paanch": 5, "panch": 5, "five": 5,
    "chhe": 6, "chey": 6, "che": 6, "six": 6, "saat": 7, "seven": 7, "aath": 8, "eight": 8, "nau": 9, "das": 10, "gyarah": 11, "barah": 12,
}
_UNIT_H = r"(?:hours?|hrs?|hr|h|ghant[a-z]*|ghnt[a-z]*)"
_DUR_NUM = re.compile(rf"(?<![\d:.])(\d+(?:\.\d+)?)\s*{_UNIT_H}\b")
_DUR_MIN = re.compile(r"(?<![\d:.])(\d+)\s*(?:minutes?|mins?|min)\b")
_DUR_WORD = re.compile(rf"\b({'|'.join(sorted(_NUM_WORDS, key=len, reverse=True))})\s+{_UNIT_H}\b")
_DUR_DEDH = re.compile(r"\b(?:dedh|derh|1\.5)\s*(?:ghant[a-z]*|hours?)?\b")
_DUR_DHAI = re.compile(r"\bdhai\s*(?:ghant[a-z]*|hours?)\b")
_DUR_HALF = re.compile(r"\b(?:half\s+(?:an?\s+)?hour|aadha\s+ghant[a-z]*|adha\s+ghant[a-z]*)\b")


def _valid_duration(minutes: float | None) -> int | None:
    if minutes is None:
        return None
    m = int(round(minutes))
    return m if MIN_DURATION <= m <= MAX_DURATION and m % 30 == 0 else None


def extract_duration(text: str, *, bare_ok: bool = False) -> tuple[int | None, str]:
    """(minutes, text with the duration words removed). Only multiples of 30 minutes between 30 and 360 count (the booking grid)."""
    t = (text or "").lower()
    for rx, fn in (
        (_DUR_HALF, lambda m: 30),
        (_DUR_DHAI, lambda m: 150),
        (_DUR_NUM, lambda m: float(m.group(1)) * 60),
        (_DUR_MIN, lambda m: float(m.group(1))),
        (_DUR_WORD, lambda m: _NUM_WORDS[m.group(1)] * 60),
    ):
        m = rx.search(t)
        if m:
            got = _valid_duration(fn(m))
            return got, t[: m.start()] + " " + t[m.end() :]
    m = _DUR_DEDH.search(t)
    if m and ("ghant" in m.group(0) or "hour" in m.group(0) or m.group(0).startswith(("dedh", "derh"))):
        return 90, t[: m.start()] + " " + t[m.end() :]
    if bare_ok:
        bare = t.strip(" .!?")
        if re.fullmatch(r"\d(?:\.5)?", bare):
            return _valid_duration(float(bare) * 60), ""
        if re.fullmatch(r"\d{2,3}", bare):
            return _valid_duration(float(bare)), ""
    return None, t


# --- times -------------------------------------------------------------------------------------------------------------------------

_AM_WORDS = frozenset("subah subha savere sawere morning fajr".split())
_PM_WORDS = frozenset("shaam sham evening".split())
_NIGHT_WORDS = frozenset("raat rat night tonight tonite".split())
_NOON_WORDS = frozenset("dopahar dopehar afternoon noon".split())
_SUFFIX = r"(?:baje|bajay|bajey|bje|bajae|o'?clock|ki|ka|ke)"
_MER = r"(?:a\.?m\.?|p\.?m\.?)"
_TIME_PART = r"(\d{1,2})(?:[:.]([0-5]\d))?"
_RANGE_RE = re.compile(
    rf"(?<![\d:.]){_TIME_PART}\s*({_MER})?\s*(?:{_SUFFIX}\s+)?(?:se|to|till|until|tak|-|–)\s*{_TIME_PART}\s*({_MER})?(?:\s*{_SUFFIX}|\s*tak)?(?![\d:])"
)
_SINGLE_SUFFIX_RE = re.compile(rf"(?<![\d:.]){_TIME_PART}\s*(?:({_MER})|({_SUFFIX})(?![a-z]))")
_SINGLE_AT_RE = re.compile(rf"\b(?:at|around|from|by|@)\s*{_TIME_PART}(?!\s*(?:hours?|hrs?|min|\d))")
_SINGLE_PART_RE = re.compile(
    rf"\b(?:subah|subha|savere|sawere|morning|dopahar|dopehar|afternoon|shaam|sham|evening|raat|rat|night|tonight|tonite)\s*(?:ko\s+|mein\s+|me\s+)?{_TIME_PART}(?![\d:]|\s*(?:hours?|hrs?|ghant|min))"
)
_COLON_RE = re.compile(r"(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])")
_WORD_HOUR_RE = re.compile(rf"\b({'|'.join(sorted(_NUM_WORDS, key=len, reverse=True))})\s+(?:baje|bajay|bajey|bje)\b")


@dataclass
class TimeFound:
    start: time | None = None
    end: time | None = None
    ambiguous_hour: int | None = None  # 1-12, start hour said without AM/PM
    ambiguous_end_hour: int | None = None

    @property
    def any(self) -> bool:
        return self.start is not None or self.ambiguous_hour is not None


def _daypart(tokens: list[str]) -> str | None:
    for tok in tokens:
        if tok in _NIGHT_WORDS:
            return "night"
        if tok in _PM_WORDS:
            return "pm"
        if tok in _NOON_WORDS:
            return "noon"
        if tok in _AM_WORDS:
            return "am"
    return None


def _mer_norm(mer: str | None) -> str | None:
    if not mer:
        return None
    return "am" if mer.lower().startswith("a") else "pm"


def _resolve_hour(hour: int, minute: int, mer: str | None, part: str | None) -> time | None:
    """A wall-clock time, or None when AM/PM is genuinely unknown."""
    if hour == 24:
        hour = 0
    if hour > 24 or minute > 59:
        return None
    if hour == 0 or hour >= 13:
        return time(hour % 24, minute)
    if mer == "am":
        return time(0 if hour == 12 else hour, minute)
    if mer == "pm":
        return time(12 if hour == 12 else hour + 12, minute)
    if part == "am":
        return time(0 if hour == 12 else hour, minute)
    if part == "pm":
        return time(12 if hour == 12 else hour + 12, minute)
    if part == "night":
        if hour == 12:
            return time(0, minute)
        if 6 <= hour <= 11:
            return time(hour + 12, minute)
        if 1 <= hour <= 5:
            return time(hour, minute)
    if part == "noon":
        if hour == 12:
            return time(12, minute)
        if 1 <= hour <= 5:
            return time(hour + 12, minute)
        if hour in (10, 11):
            return time(hour, minute)
    return None


def extract_times(text: str, *, bare_ok: bool = False) -> TimeFound:
    """Start (and end) time from free text. `text` should already have dates and durations removed. Hours said without a day-part
    stay ambiguous (AM/PM unknown) instead of being guessed."""
    t = (text or "").lower()
    t = re.sub(r"\b\d{3,}\b", " ", t)  # prices ("3000"), never a clock time
    tokens = re.findall(r"[a-z']+", t)
    part = _daypart(tokens)
    if "midnight" in tokens:
        return TimeFound(start=time(0, 0))

    m = _RANGE_RE.search(t)
    if m:
        h1, mi1, mer1, h2, mi2, mer2 = int(m.group(1)), int(m.group(2) or 0), _mer_norm(m.group(3)), int(m.group(4)), int(m.group(5) or 0), _mer_norm(m.group(6))
        if h1 <= 24 and h2 <= 24:
            inherited_end = False
            if mer1 and not mer2 and 1 <= h2 <= 12:
                mer2, inherited_end = mer1, True
            if mer2 and not mer1 and 1 <= h1 <= 12 and part is None:
                mer1 = mer2  # "9 to 11 pm": both evening
            start = _resolve_hour(h1, mi1, mer1, part)
            end = _resolve_hour(h2, mi2, mer2, part)
            if inherited_end and start is not None and end is not None:
                # "9am to 12", "9pm to 12": the end is the next time that hour comes round after the start
                s_min, e_min = start.hour * 60 + start.minute, end.hour * 60 + end.minute
                while e_min <= s_min:
                    e_min += 720
                end = time((e_min // 60) % 24, e_min % 60)
            if start is not None and end is None and 1 <= h2 <= 12 and not mer2:
                # "9 pm to 12": the end continues from the start (next time that hour comes round)
                s_min = start.hour * 60 + start.minute
                options = sorted({(h2 % 12) * 60 + mi2, (h2 % 12) * 60 + mi2 + 720})
                nxt = next((o for o in options if o > s_min), options[0] + 1440)
                end = time((nxt // 60) % 24, nxt % 60)
            if start is not None and end is not None:
                return TimeFound(start=start, end=end)
            if start is None and 1 <= h1 <= 12:
                return TimeFound(ambiguous_hour=h1, ambiguous_end_hour=h2 if 1 <= h2 <= 12 else None)
            if start is not None:
                return TimeFound(start=start)

    for rx in (_SINGLE_SUFFIX_RE, _SINGLE_AT_RE, _SINGLE_PART_RE):
        m = rx.search(t)
        if m:
            hour, minute = int(m.group(1)), int(m.group(2) or 0)
            mer = _mer_norm(m.group(3)) if rx is _SINGLE_SUFFIX_RE else None
            if hour > 24:
                continue
            resolved = _resolve_hour(hour, minute, mer, part)
            if resolved is not None:
                return TimeFound(start=resolved)
            if 1 <= hour <= 12:
                return TimeFound(ambiguous_hour=hour)
    m = _COLON_RE.search(t)
    if m:
        hour, minute = int(m.group(1)), int(m.group(2))
        resolved = _resolve_hour(hour, minute, None, part)
        if resolved is not None:
            return TimeFound(start=resolved)
        return TimeFound(ambiguous_hour=hour)
    m = _WORD_HOUR_RE.search(t)
    if m:
        hour = _NUM_WORDS[m.group(1)]
        resolved = _resolve_hour(hour, 0, None, part)
        return TimeFound(start=resolved) if resolved else TimeFound(ambiguous_hour=hour if 1 <= hour <= 12 else None)
    if bare_ok:
        bare = t.strip(" .!?")
        mm = re.fullmatch(r"(\d{1,2})(?:[:.]([0-5]\d))?", bare)
        if mm:
            hour = int(mm.group(1))
            resolved = _resolve_hour(hour, int(mm.group(2) or 0), None, part)
            if resolved is not None:
                return TimeFound(start=resolved)
            if 1 <= hour <= 12:
                return TimeFound(ambiguous_hour=hour)
    return TimeFound()


def meridiem_answer(text: str) -> str | None:
    """"pm", "raat", "subah" ... as the whole answer to an AM/PM question: 'am' | 'pm' | 'night' | 'noon'."""
    tokens = re.findall(r"[a-z']+", (text or "").lower().replace(".", ""))
    if not tokens or len(tokens) > 5:
        return None
    for tok in tokens:
        if tok == "pm" or tok in _PM_WORDS:
            return "pm"
        if tok in _NIGHT_WORDS:
            return "night"
        if tok == "am" or tok in _AM_WORDS:
            return "am"
        if tok in _NOON_WORDS:
            return "noon"
    return None


def apply_meridiem(hour12: int, answer: str) -> time | None:
    return _resolve_hour(hour12, 0, "am" if answer == "am" else "pm" if answer == "pm" else None, answer if answer in ("night", "noon") else None)


# --- questions the bot asked (so a reply can be matched to its question) -----------------------------------------------------------------

_Q_PATTERNS: tuple[tuple[str, re.Pattern], ...] = (
    ("ampm", re.compile(r"(?i)\bam\b.{0,25}\bpm\b|subah.{0,20}(shaam|raat)|morning.{0,25}(evening|night)|\bam ya pm\b|\bam or pm\b")),
    ("confirm", re.compile(r"(?i)shall i book|reply yes or no|yes or no|book (?:kar|kr)\s*(?:du|don)|haan ya na|should i (?:book|hold)|confirm (?:kar|this)")),
    ("name", re.compile(r"(?i)\bname\b.{0,40}\b(booking|under|put)\b|\bnaam\b|what name|which name")),
    ("show_venues", re.compile(r"(?i)see them|show them|dikha(?:oon|un| doon)|dekhna chahenge|dekhna chahte")),
    ("duration", re.compile(r"(?i)how long|how many hours|kitni der|kitne ghant|duration|for how long|kitna time khel")),
    ("sport", re.compile(r"(?i)which sport|what sport|kaun\s*sa sport|kon\s*sa sport|konsa sport|kis sport|sport (?:chahiye|khelna)|which one:|play\?|khelna chahte hain\?|in mein se kaun")),
    ("court", re.compile(r"(?i)which court|kaun\s*sa court|kon\s*sa court|konsa court|court (?:chahiye|select|choose)")),
    ("venue", re.compile(r"(?i)which venue|kaun\s*sa venue|kon\s*sa venue|konsa venue|which arena|which club")),
    ("date", re.compile(r"(?i)which date|what date|which day|kis date|kaun\s*si date|kon\s*si date|kis din|konse din|kab khelna|date (?:bata|chahiye)|what day")),
    ("time", re.compile(r"(?i)what time|which time|start time|kitne baje|kis time|kis waqt|kab se|what.{0,12}start|time (?:bata|chahiye)")),
)
_NUMBERED_LINE = re.compile(r"(?m)^\s*(\d)[.)]\s*(.+?)\s*$")


def ask_fields(text: str) -> list[str]:
    """The kinds of question a bot message asks (sport | court | venue | date | time | ampm | duration | name | confirm | show_venues), in text order."""
    out: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", text or ""):
        if "?" not in sentence and not re.search(r"(?i)\b(batain|bata dein|bataiye|let me know|tell me|please (?:say|write|send))\b", sentence):
            continue
        for kind, rx in _Q_PATTERNS:
            if rx.search(sentence):
                if kind not in out:
                    out.append(kind)
                break
    return out


def numbered_options(text: str) -> list[str]:
    lines = [(int(m.group(1)), m.group(2)) for m in _NUMBERED_LINE.finditer(text or "")]
    if len(lines) >= 2 and [n for n, _ in lines] == list(range(1, len(lines) + 1)):
        return [t for _, t in lines]
    return []


_SLOT_LABEL_RE = re.compile(
    r"(\d{1,2}):(\d{2}) (AM|PM) to (\d{1,2}):(\d{2}) (AM|PM), (Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
)


def parse_slot_labels(text: str, today: date) -> list[tuple[date, time, int]]:
    """(date, start, minutes) for every exact slot label ("7:00 PM to 8:00 PM, Wed 23 Sep") a bot message states."""
    out = []
    for m in _SLOT_LABEL_RE.finditer(text or ""):
        h1, m1, ap1, h2, m2, ap2 = int(m.group(1)), int(m.group(2)), m.group(3), int(m.group(4)), int(m.group(5)), m.group(6)
        start = time((h1 % 12) + (12 if ap1 == "PM" else 0), m1)
        end_min = ((h2 % 12) + (12 if ap2 == "PM" else 0)) * 60 + m2
        minutes = (end_min - (start.hour * 60 + start.minute)) % 1440 or 1440
        month = _MONTH_WORDS[m.group(9).lower()]
        day = int(m.group(8))
        d = _mk_date(today.year, month, day)
        if d is not None and (today - d).days > 90:
            d = _mk_date(today.year + 1, month, day)
        if d is not None:
            out.append((d, start, minutes))
    return out


# --- what the player's message is about ----------------------------------------------------------------------------------------------

_GREETING_WORDS = frozenset(
    "hi hii hiii hello hellow helo hey heyy hy hlo salam salaam slam assalam assalamu assalamualaikum assalamoalaikum assalamualikum aoa "
    "asalam walaikum walikum namaste hola".split()
)
_GREETING_FILLER = frozenset(
    "bhai bhaijan sir ji jee yaar bro dear there everyone all team aap kaise kese ho hain hai kya haal how are you u alaikum o oo mubarak "
    "good morning evening afternoon night khelo app".split()
)
_THANKS_WORDS = frozenset("thanks thank thankyou thanx thx tysm shukriya shukria shukriyah jazakallah meherbani mehrbani".split())
_THANKS_FILLER = frozenset(
    "you so much a lot very bohat bahut boht bhai ji g sir ok okay dear alot great nice achha acha theek hai ho gya gaya".split()
)
_NEGATIVE_WORDS = frozenset("no nahi nahin nhi na nope nah nai cancel rehne rehnay chhor chor mat".split())
_PRICE_WORDS = frozenset(
    "price prices pricing cost rate rates charges charge fee fees kitna kitni kitne kitnay qeemat keemat kimat paisa paise rupay rupees pkr rs "
    "sasta sasti discount kam".split()
)
_PRICE_PHRASES = re.compile(r"(?i)how much|kitne ka|kitne ki|per hour|per ghanta|rate kya")
_LOCATION_WORDS = frozenset("where address location kahan kahaan kaha map directions direction pata jagah located".split())
_HOURS_PHRASES = re.compile(
    r"(?i)\btimings?\b|\btime ?table\b|opening hours|open hours|closing time|\bkhulta\b|\bkhulte\b|\bkhulti\b|kab tak|band (?:hota|hoti|hote)|what time do you (?:open|close)|"
    r"kitne baje (?:khul|band|tak)"
)
_SPORT_Q = re.compile(
    r"(?i)(?:kaun|kon|konse|kaunse|kon kon)\s*se?\s*sports?|kya kya (?:khel|sports?|games?)|which sports|what sports|sports (?:available|hain|kya)|konsi games|konse games|games (?:kya|hain)|sports kon"
)
_LISTING_RE = re.compile(r"(?i)\bavailable\b|\bavailability\b|\bfree\b|\bkhali\b|\bkhaali\b|kon kon|kaun kaun|\bslots?\b.{0,20}\b(dikha|show|list|batao|bata)|dikhao|dikha do")
_MORE_OPTIONS = re.compile(
    r"(?i)koi (?:aur|or|dusra|doosra|dosra|aur option)|(?:aur|or) koi|other options?|any other|another (?:option|time|slot|court)|aur options?|kuch aur|different time|other time|something else|aur time|any more"
)
_COMPLAINT = re.compile(
    r"(?i)\b(?:upper|oper|upar|pehle|pehly|already|btaya|bataya|bata diya|bata chuka|told you|i said|i told|maine kaha|kaha tha|bola tha|mention(?:ed)?)\b"
)
_NEW_BOOKING = re.compile(r"(?i)\b(?:naya|nayi|nai|new|another|ek aur|aur ek|ik aur|dusri|doosri|dosri)\s+(?:booking|court|slot)\b|\bbook (?:another|one more)\b|start over|dobara shuru")
_BOOKING_WORDS = frozenset(
    "book booking bookings slot slots reserve reservation chahiye chayie chahie chaiye chahye chahta chahtay chahte lena khelna khelni khelne court courts "
    "need want khel play".split()
)
_ACCOUNT_WORDS = frozenset("cancel refund payment screenshot paid hold held receipt status mera meri apni apna".split())
_BARGAIN_WORDS = re.compile(r"(?i)\b(?:discount|sasta|sasti|kam karo|kam kardo|kam kr|rate kam|price kam|cheap|cheaper|less price|reduce)\b")
_BARGAIN_NUMBER = re.compile(r"(?<![\d:/.])(\d{3,6})(?![\d:/])")


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z']+", (text or "").lower())


def is_greeting(text: str) -> bool:
    toks = _tokens(text)
    if not toks or not any(t in _GREETING_WORDS for t in toks) and not re.search(r"(?i)good (?:morning|evening|afternoon)|kya haal|kaise ho|how are you", text or ""):
        return False
    rest = [t for t in toks if t not in _GREETING_WORDS and t not in _GREETING_FILLER]
    return not rest and not re.search(r"\d", text or "")


def is_thanks(text: str) -> bool:
    toks = _tokens(text)
    if not any(t in _THANKS_WORDS for t in toks):
        return False
    rest = [t for t in toks if t not in _THANKS_WORDS and t not in _THANKS_FILLER]
    return not rest and not re.search(r"\d", text or "")


def is_negative(text: str) -> bool:
    toks = _tokens(text)
    return 0 < len(toks) <= 4 and all(t in _NEGATIVE_WORDS or t in _FILLER_WORDS or t in {"thanks", "thank", "you", "ji", "g"} for t in toks) and any(t in _NEGATIVE_WORDS for t in toks)


def is_bargain(text: str) -> bool:
    """The player names a price ("3000 per hour karo") or asks for a discount: the venue sets prices, not the assistant."""
    if _BARGAIN_WORDS.search(text or ""):
        return True
    for m in _BARGAIN_NUMBER.finditer(text or ""):
        value = int(m.group(1))
        if value < 500 or 2020 <= value <= 2035:
            continue
        window = (text or "").lower()
        if re.search(r"\b(?:hour|hours|hr|ghanta|ghante|ghantay|per|phr|rate|price|mai|mein|me|ka|ke|pkr|rs|rupay|rupees)\b", window):
            return True
    return False


@dataclass
class TurnFacts:
    """What THIS player message contains and what it is about (all deterministic)."""

    text: str = ""
    intent: str = "other"  # greeting | thanks | affirmative | negative | price_question | location_question | hours_question | sport_question | slot_request | other
    got: set[str] = field(default_factory=set)  # state fields this message set
    unsupported: list[str] = field(default_factory=list)  # sports asked for that the venue / platform does not offer (display names)
    multi_sport: list[str] = field(default_factory=list)  # several real sports named at once
    sport_word_unknown: bool = False
    past_date: bool = False
    bargain: bool = False
    listing: bool = False
    more_options: bool = False
    complaint: bool = False
    new_booking: bool = False
    picked_option: bool = False
    adopted_slot: bool = False
    pending_before: str | None = None
    answered_pending: bool = False
    short: bool = False
    has_facts: bool = False

    @property
    def booking_related(self) -> bool:
        return self.intent == "slot_request" or self.has_facts


def starts_new_booking(text: str) -> bool:
    return bool(_NEW_BOOKING.search(text or ""))


# --- applying messages to the state ----------------------------------------------------------------------------------------------------


def _derive(state: ChatState, facts: PlatformFacts | None) -> None:
    """Fill in what the database settles by itself: the only venue offering the sport, the only sport of the venue, the only court of the
    sport. Provenance `tool_result`; a multi-sport venue's sport is NEVER filled in (the player must choose)."""
    if facts is None or facts.empty:
        return
    if not state.has("venue"):
        candidates = facts.venues_with_sport(state.sport) if state.sport else facts.venues
        if len(candidates) == 1:
            v = candidates[0]
            state.venue_id, state.venue_name = v.id, v.name
            state.prov["venue"] = TOOL
    venue = facts.venue(state.venue_id)
    if venue is None:
        return
    if not state.has("sport") and len(venue.sports) == 1:
        state.sport = venue.sports[0]
        state.prov["sport"] = TOOL
    if state.sport and not state.has("court"):
        courts = venue.courts_for(state.sport)
        if len(courts) == 1:
            state.court_id, state.court_name = courts[0].id, courts[0].name
            state.prov["court"] = TOOL


def _set_venue(state: ChatState, venue: VenueFact, prov: str, turn: TurnFacts | None) -> None:
    if state.venue_id == venue.id:
        state.prov["venue"] = prov if prov in PLAYER_SOURCED else state.prov.get("venue", prov)
        return
    state.venue_id, state.venue_name = venue.id, venue.name
    state.prov["venue"] = prov
    if state.court_id and not any(c.id == state.court_id for c in venue.courts):
        state.clear("court")
    if state.sport and state.sport.lower() not in {s.lower() for s in venue.sports}:
        if turn is not None:
            turn.unsupported.append(state.sport)
        state.clear("sport", "court")


def _apply_player(
    state: ChatState, text: str, facts: PlatformFacts | None, today: date, *, prov_for_pick: str = PLAYER
) -> TurnFacts:
    turn = TurnFacts(text=text or "")
    turn.pending_before = state.pending
    pending = state.pending
    options = state.options
    state.pending, state.options = None, []
    raw = text or ""

    # a numbered choice we offered ("2") picks that line
    picked = False
    m = re.fullmatch(r"\s*(\d)\s*[.)]?\s*", raw)
    if m and options and 1 <= int(m.group(1)) <= len(options):
        raw = options[int(m.group(1)) - 1]
        picked = True
        turn.picked_option = True
    prov = BUTTON if picked else prov_for_pick

    turn.new_booking = starts_new_booking(raw)
    turn.bargain = is_bargain(raw)
    turn.listing = bool(_LISTING_RE.search(raw))
    turn.more_options = bool(_MORE_OPTIONS.search(raw))
    turn.complaint = bool(_COMPLAINT.search(raw))
    words = _tokens(raw)
    turn.short = len(words) <= 6

    venues = facts.venues if facts and not facts.empty else []
    # venue, then court (courts of the venue in play, else of every venue)
    venue_text = raw
    named_venue = match_venue(raw, venues) if venues else None
    if named_venue is not None:
        before = state.venue_id
        _set_venue(state, named_venue, prov, turn)
        if before != named_venue.id:
            turn.got.add("venue")
        venue_text = re.sub(re.escape(named_venue.name), " ", raw, flags=re.I)
    if venues:
        in_play = [facts.venue(state.venue_id)] if state.venue_id and facts.venue(state.venue_id) else venues
        pairs = [(v, c) for v in in_play if v for c in v.courts]
        hit = match_court(raw, pairs)
        if hit is not None:
            v, c = hit
            if state.venue_id != v.id:
                _set_venue(state, v, prov, turn)
                turn.got.add("venue")
            if state.court_id != c.id:
                turn.got.add("court")
            state.court_id, state.court_name = c.id, c.name
            state.prov["court"] = prov
            if state.sport is None or state.sport.lower() != c.sport.lower():
                state.sport = c.sport
                state.prov["sport"] = prov
                turn.got.add("sport")

    # sport
    real_all = facts.sports() if facts and not facts.empty else []
    venue_in_play = facts.venue(state.venue_id) if facts else None
    real = venue_in_play.sports if venue_in_play else real_all
    scan = scan_sports(venue_text, real_all)
    if scan:
        supported, unsupported = [], []
        for canon in scan:
            shown = match_real_sport(canon, real) if real else sport_display(canon)
            (supported if shown else unsupported).append(shown or sport_display(canon))
        if len(supported) == 1 and not unsupported:
            if state.sport != supported[0]:
                state.sport = supported[0]
                turn.got.add("sport")
                if state.court_id and facts:
                    hit = facts.court(state.court_id)
                    if hit and hit[1].sport.lower() != supported[0].lower():
                        state.clear("court")
            state.prov["sport"] = prov
            state.wanted_sport = None
        elif len(supported) + len(unsupported) > 1 and supported:
            turn.multi_sport = supported + unsupported
        elif unsupported and not supported:
            turn.unsupported = [u for u in unsupported if u not in turn.unsupported] + turn.unsupported
            state.wanted_sport = unsupported[0]
    elif pending == "sport" and facts and not facts.empty and len(words) <= 3 and not (picked):
        turn.sport_word_unknown = True

    # duration, date, times (each removes its words before the next reads the text)
    duration, rest = extract_duration(raw, bare_ok=pending == "duration")
    found_date, rest = extract_date(rest, today)
    rest = re.sub(r"(?i)\b(?:court|courts|number|no)\s*#?\s*[a-z0-9]{1,2}\b", " ", rest)  # "Court 2 ka slot" is not 2 o'clock
    clock = extract_times(rest, bare_ok=pending in ("time", "ampm"))
    if found_date is not None:
        if found_date.past:
            turn.past_date = True
        else:
            if state.date != found_date.value.isoformat():
                turn.got.add("date")
            state.date = found_date.value.isoformat()
            state.prov["date"] = prov
    if clock.start is not None:
        new_start = f"{clock.start.hour:02d}:{clock.start.minute:02d}"
        if state.start_time != new_start:
            turn.got.add("start_time")
        state.start_time, state.ambiguous_hour, state.ambiguous_end_hour = new_start, None, None
        state.prov["start_time"] = prov
        if clock.end is not None and duration is None:
            s_min = clock.start.hour * 60 + clock.start.minute
            e_min = clock.end.hour * 60 + clock.end.minute
            duration = _valid_duration(((e_min - s_min) % 1440) or 1440)
    elif clock.ambiguous_hour is not None:
        state.start_time = None
        state.prov.pop("start_time", None)
        state.ambiguous_hour, state.ambiguous_end_hour = clock.ambiguous_hour, clock.ambiguous_end_hour
        turn.got.add("start_time")
    elif state.ambiguous_hour is not None:
        answer = meridiem_answer(raw)
        if answer:
            resolved = apply_meridiem(state.ambiguous_hour, answer)
            if resolved is not None:
                state.start_time = f"{resolved.hour:02d}:{resolved.minute:02d}"
                state.prov["start_time"] = prov
                turn.got.add("start_time")
                if state.ambiguous_end_hour and duration is None:
                    end = apply_meridiem(state.ambiguous_end_hour, answer)
                    if end is not None:
                        s_min = resolved.hour * 60 + resolved.minute
                        e_min = end.hour * 60 + end.minute
                        duration = _valid_duration(((e_min - s_min) % 1440) or 1440)
                state.ambiguous_hour, state.ambiguous_end_hour = None, None
    if duration is not None:
        if state.duration_minutes != duration:
            turn.got.add("duration")
        state.duration_minutes = duration
        state.prov["duration"] = prov

    # a plain "yes" to an exact slot the bot just stated adopts that slot (it was the player's own choice to accept it)
    # (handled by the caller, which has the previous bot message)

    # intent
    turn.has_facts = bool(turn.got) or bool(turn.unsupported) or bool(turn.multi_sport)
    toks = set(words)
    booking_word = bool(toks & _BOOKING_WORDS)
    asks_price = bool(toks & _PRICE_WORDS) or bool(_PRICE_PHRASES.search(raw))
    asks_where = bool(toks & _LOCATION_WORDS)
    asks_hours = bool(_HOURS_PHRASES.search(raw))
    asks_sports = bool(_SPORT_Q.search(raw))
    if asks_sports:
        turn.intent = "sport_question"
    elif turn.bargain or asks_price:
        turn.intent = "price_question"
    elif asks_where:
        turn.intent = "location_question"
    elif asks_hours:
        turn.intent = "hours_question"
    elif is_greeting(raw) and not turn.has_facts:
        turn.intent = "greeting"
    elif is_thanks(raw) and not turn.has_facts:
        turn.intent = "thanks"
    elif is_plain_affirmative(raw) and not turn.has_facts:
        turn.intent = "affirmative"
    elif is_negative(raw) and not turn.has_facts:
        turn.intent = "negative"
    elif turn.has_facts or booking_word or turn.listing or turn.more_options or turn.past_date or turn.sport_word_unknown:
        turn.intent = "slot_request"
    else:
        turn.intent = "other"
    if toks & _ACCOUNT_WORDS and not turn.has_facts and turn.intent == "slot_request":
        turn.intent = "other"

    if turn.listing and turn.intent in ("slot_request", "other"):
        state.mode = "listing"
    elif {"start_time", "duration"} & turn.got or (booking_word and not turn.listing):
        state.mode = "booking"
    return turn


def _apply_ai(state: ChatState, text: str, proposal: dict | None, today: date) -> None:
    """The bot's own message: what it asked (so the next player message can be matched to the question) and what it proposed."""
    asked = ask_fields(text)
    state.pending = asked[0] if asked else None
    state.options = numbered_options(text)
    if state.options and not asked:
        state.pending = "choice"
    if proposal:
        # a slot the bot proposed: remember it, but never as something the player chose
        court_id = proposal.get("court_id")
        if court_id and not state.has("court"):
            state.court_id = str(court_id)
            state.court_name = proposal.get("court_name")
            state.prov["court"] = TOOL


def _adopt_stated_slot(state: ChatState, prev_ai_text: str, today: date) -> bool:
    """"haan" to "10:00 PM chalega?": the player accepted the one exact slot the bot just stated, so its date and start time are theirs."""
    labels = parse_slot_labels(prev_ai_text, today)
    if len(labels) != 1 or "?" not in prev_ai_text:
        return False
    d, start, _minutes = labels[0]
    changed = state.date != d.isoformat() or state.start_time != f"{start.hour:02d}:{start.minute:02d}"
    state.date = d.isoformat()
    state.start_time = f"{start.hour:02d}:{start.minute:02d}"
    state.ambiguous_hour = state.ambiguous_end_hour = None
    state.prov["date"] = state.prov["start_time"] = PLAYER
    return changed


# --- folding a conversation ----------------------------------------------------------------------------------------------------------------


@dataclass
class Row:
    role: str  # "player" | "ai"
    text: str
    at: datetime | None = None
    proposal: dict | None = None  # a live, exact `confirm_booking` the bot made in this message (ai rows)
    saved_state: dict | None = None  # `meta["state"]` of an ai row
    mtype: str = "text"


@dataclass
class FoldResult:
    state: ChatState
    turn: TurnFacts
    window: list[Row]  # rows after the conversation boundary (before the current message)
    sources: set[int]  # indexes into `window` of the player rows that set the current field values
    live_proposal: dict | None = None
    prev_ai_text: str = ""


def fresh_state() -> ChatState:
    return ChatState()


def reply_language(player_texts: list[str]) -> str:
    """The language to answer in: the lead's word-list vote (`chat_language.score`) over the player's last four messages, newest weighing most, so one
    short "koi bhi" in an English chat does not flip the language (and vice versa). No signal anywhere -> `conversation_language`'s default."""
    ru_w = en_w = 0
    for i, text in enumerate(reversed(player_texts[-4:])):
        ru, en = score(text)
        ru_w += (4 - i) * ru
        en_w += (4 - i) * en
    if ru_w == 0 and en_w == 0:
        return conversation_language(player_texts)
    return "ru" if ru_w >= en_w else "en"


def _row_today(row_at: datetime | None, default: date) -> date:
    return pkt_date_of(row_at) if row_at is not None and row_at.tzinfo is not None else default


def fold_state(
    rows: list[Row],
    current: str,
    facts: PlatformFacts | None,
    now: datetime | None = None,
    *,
    booking_floor: datetime | None = None,
    booking_stage: str | None = None,
    saved: ChatState | None = None,
) -> FoldResult:
    """The conversation state AFTER the current player message. `rows` are the earlier text messages of this user + channel, oldest first.

    `booking_floor` is when the player's latest booking was created: rows before it belong to a finished booking and are not part of this
    conversation. `booking_stage` ("awaiting_payment" | "done") is that booking's stage, kept while the player has said nothing new since.
    `saved` is the state persisted on the latest reply (`meta["state"]`); it only fills gaps (database / button facts the fold cannot see).
    """
    now = now or datetime.now(timezone.utc)
    default_today = pkt_today(now)
    state = fresh_state()
    window: list[Row] = []
    sources_for: dict[str, int] = {}
    prev_at: datetime | None = None
    prev_ai_text = ""
    unclear = 0

    def reset() -> None:
        nonlocal state, window, sources_for, unclear
        state, window, sources_for, unclear = fresh_state(), [], {}, 0

    for row in rows:
        if booking_floor is not None and row.at is not None and row.at <= booking_floor:
            continue
        if prev_at is not None and row.at is not None and row.at - prev_at > CONVERSATION_GAP:
            reset()
        if row.at is not None:
            prev_at = row.at
        today = _row_today(row.at, default_today)
        if row.role == "player":
            if starts_new_booking(row.text):
                reset()
            window.append(row)
            idx = len(window) - 1
            before = state.pending
            adopted = False
            if is_plain_affirmative(row.text) and prev_ai_text:
                adopted = _adopt_stated_slot(state, prev_ai_text, today)
            if before == "show_venues" and is_plain_affirmative(row.text) and state.wanted_sport:
                state.sport = state.wanted_sport
                state.prov["sport"] = PLAYER
                state.clear("venue", "court")
                state.wanted_sport = None
                adopted = True
            turn = _apply_player(state, row.text, facts, today)
            _derive(state, facts)
            progress = bool(turn.got) or adopted or turn.intent not in ("other", "affirmative", "negative", "slot_request") or turn.picked_option
            if before and before not in ("name", "confirm", "show_venues") and not progress and turn.intent in ("other", "affirmative", "negative", "slot_request") and turn.short:
                unclear += 1
            elif progress or before in (None, "name", "confirm", "show_venues"):
                unclear = 0
            for name in turn.got:
                sources_for[name] = idx
            if adopted:
                sources_for["date"] = sources_for["start_time"] = idx
        else:
            window.append(row)
            _apply_ai(state, row.text, row.proposal, today)
            prev_ai_text = row.text

    # the gap since the last message ends the conversation too
    if prev_at is not None and now - prev_at > CONVERSATION_GAP:
        reset()
        prev_ai_text = ""

    last_ai = window[-1] if window and window[-1].role == "ai" else None
    live = last_ai.proposal if last_ai is not None else None

    state.unclear = unclear
    if saved is not None and last_ai is not None:
        for name in ("court", "venue"):
            if not state.has(name):
                value = getattr(saved, f"{name}_id")
                if value and saved.prov.get(name) in (TOOL, BUTTON):
                    setattr(state, f"{name}_id", value)
                    setattr(state, f"{name}_name", getattr(saved, f"{name}_name"))
                    state.prov[name] = saved.prov[name]

    today_now = default_today
    adopted_now = False
    if is_plain_affirmative(current) and prev_ai_text and window:
        adopted_now = _adopt_stated_slot(state, prev_ai_text, today_now)
    before = state.pending
    if before == "show_venues" and is_plain_affirmative(current) and state.wanted_sport:
        state.sport = state.wanted_sport
        state.prov["sport"] = PLAYER
        state.clear("venue", "court")
        state.wanted_sport = None
        adopted_now = True
    turn = _apply_player(state, current, facts, today_now)
    turn.adopted_slot = adopted_now
    _derive(state, facts)
    progress = bool(turn.got) or adopted_now or turn.intent not in ("other", "affirmative", "negative", "slot_request") or turn.picked_option
    turn.answered_pending = before is None or progress
    if before and before not in ("name", "confirm", "show_venues") and not progress and turn.short and turn.intent in ("other", "affirmative", "negative", "slot_request"):
        state.unclear = unclear + 1
    elif progress or before in (None, "name", "confirm", "show_venues"):
        state.unclear = 0
    else:
        state.unclear = unclear
    for name in turn.got:
        sources_for[name] = len(window)  # the current message (not yet in the window)

    texts = [r.text for r in window if r.role == "player"] + [current]
    state.language = reply_language(texts)

    # stage
    if live is not None and not turn.got:
        state.stage = "confirming"
    elif booking_stage in ("awaiting_payment", "done") and not window and not turn.has_facts and turn.intent not in ("slot_request",):
        state.stage = booking_stage
    elif state.sport and state.date:
        state.stage = "choosing_slot"
    else:
        state.stage = "browsing"

    return FoldResult(
        state=state, turn=turn, window=window, sources={i for i in sources_for.values() if i < len(window)}, live_proposal=live, prev_ai_text=prev_ai_text
    )


# --- what is still missing ---------------------------------------------------------------------------------------------------------------------


def missing_fields(state: ChatState, facts: PlatformFacts | None, *, mode: str | None = None) -> list[str]:
    """The fields still needed, in the order they must be asked: sport, venue, court, date, time, duration. In "listing" mode (the player only
    asks what is available) only sport and date are required (and the court is optional)."""
    mode = mode or state.mode
    out: list[str] = []
    if not state.known("sport"):
        out.append("sport")
    if not state.known("venue") and facts is not None and len(facts.venues_with_sport(state.sport)) > 1:
        out.append("venue")
    if mode != "listing" and not state.known("court") and facts is not None:
        venue = facts.venue(state.venue_id)
        if venue is not None and state.sport and len(venue.courts_for(state.sport)) > 1:
            out.append("court")
    if not state.known("date"):
        out.append("date")
    if mode != "listing":
        if not (state.start_time and state.prov.get("start_time") != ASSUMED):
            out.append("time")
        if not state.known("duration"):
            out.append("duration")
    return out


def confirmable(state: ChatState) -> bool:
    """Every field of a booking proposal comes from the player (or is a database singleton for sport / venue / court)."""
    if state.ambiguous_hour is not None:
        return False
    for name in ("date", "start_time", "duration"):
        if not state.player_sourced(name):
            return False
    return state.prov.get("sport") in (PLAYER, BUTTON, TOOL) and state.has("sport")


# --- the history the model sees ----------------------------------------------------------------------------------------------------------------

HISTORY_TURNS = 8


def is_chit_chat(text: str) -> bool:
    """A greeting / thanks / bare ok that carries no booking information (it is dropped from the model's history when it is old)."""
    t = text or ""
    return not re.search(r"\d", t) and (is_greeting(t) or is_thanks(t) or is_plain_affirmative(t) or is_negative(t))


def select_history(window: list[Row], sources: set[int], *, last_turns: int = HISTORY_TURNS) -> list[dict]:
    """The text turns handed to the model: the last `last_turns` (player message + the bot's reply) PLUS every earlier turn that DEFINES a value
    in the state (the player row that set the sport / date / time / duration / court, found through the provenance), minus old chit-chat.
    Nothing from before the conversation boundary is in `window` to begin with. Always starts with a player message."""
    turns: list[list[int]] = []
    for i, row in enumerate(window):
        if row.role == "player":
            turns.append([i])
        elif turns:
            turns[-1].append(i)
    if not turns:
        return []
    keep: set[int] = set(range(max(0, len(turns) - last_turns), len(turns)))
    for t_idx, idxs in enumerate(turns):
        if t_idx not in keep and any(i in sources for i in idxs):
            keep.add(t_idx)
    # old chit-chat that does not define anything goes (the last two turns always stay: they carry the open question)
    for t_idx in list(keep):
        idxs = turns[t_idx]
        if t_idx >= len(turns) - 2:
            continue
        if not any(i in sources for i in idxs) and is_chit_chat(window[idxs[0]].text):
            keep.discard(t_idx)
    out: list[dict] = []
    for t_idx in sorted(keep):
        for i in turns[t_idx]:
            row = window[i]
            out.append({"role": "user" if row.role == "player" else "assistant", "content": row.text})
    return out
