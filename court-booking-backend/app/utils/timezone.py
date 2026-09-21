import re
from datetime import date, datetime, time, timedelta, timezone

# Pakistan has no DST, so a fixed offset is correct and doesn't need a real
# tz database. Swap for a real Asia/Karachi zoneinfo conversion (and a
# per-venue timezone field) if venues outside Pakistan are ever added.
PKT_OFFSET = timedelta(hours=5)


def pkt_time_to_utc(d: date, t: time) -> datetime:
    """Combine a calendar date with a naive Pakistan-local wall-clock time
    (as stored in schedule_templates.open_time/close_time, and as an owner
    types it in the venue-setup wizard) into a UTC-aware datetime."""
    local_naive = datetime.combine(d, t)
    return (local_naive - PKT_OFFSET).replace(tzinfo=timezone.utc)


def utc_to_pkt_naive(dt: datetime) -> datetime:
    """Convert a UTC-aware datetime to the equivalent Pakistan-local
    wall-clock moment, as a naive datetime -- for comparing a real booking
    timestamp against naive local-time columns (schedule_templates,
    pricing_rules) the same way pkt_time_to_utc's input was defined."""
    return (dt + PKT_OFFSET).replace(tzinfo=None)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def pkt_now(now_utc: datetime | None = None) -> datetime:
    """Current Pakistan wall-clock time as a naive datetime."""
    return utc_to_pkt_naive(now_utc or utc_now())


def pkt_today(now_utc: datetime | None = None) -> date:
    """Today's calendar date IN PAKISTAN. Never use `date.today()` or `datetime.now(timezone.utc).date()`
    for "today" in this app: between midnight and 5 AM in Karachi both still say YESTERDAY, which made the
    owner's Today screen show the wrong day and the date tabs query the wrong day."""
    return pkt_now(now_utc).date()


def pkt_date_of(dt: datetime) -> date:
    """The Pakistan calendar date an absolute instant falls on (derive every displayed date from THIS,
    never from a UTC date or from `created_at`)."""
    return utc_to_pkt_naive(dt).date()


# --- display formatting -----------------------------------------------------------------------------
#
# The ONE place user-facing times and dates are built (WhatsApp, notifications, AI tool results, error
# messages). 12-hour clock, Pakistan time, human dates, never UTC/ISO/24-hour. Weekday and month names are
# fixed tables, not strftime: strftime follows the process locale and would silently change on another host.

_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_MONTHS_LONG = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
_WEEKDAYS_LONG = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _clock(local: datetime) -> str:
    """12-hour clock, no leading zero, no seconds: 7:30 PM, 12:00 AM."""
    hour12 = local.hour % 12 or 12
    return f"{hour12}:{local.minute:02d} {'AM' if local.hour < 12 else 'PM'}"


def format_time(dt: datetime) -> str:
    """"7:30 PM" for an absolute instant, in Pakistan time."""
    return _clock(utc_to_pkt_naive(dt))


def format_time_range(starts_at: datetime, ends_at: datetime) -> str:
    """"7:30 PM to 9:00 PM"."""
    return f"{format_time(starts_at)} to {format_time(ends_at)}"


def format_date(dt: datetime, now_utc: datetime | None = None) -> str:
    """"Wed, 23 Sep", with the year only when it is not the current (Pakistan) year: "Wed, 5 Jan 2027"."""
    local = utc_to_pkt_naive(dt)
    text = f"{_WEEKDAYS[local.weekday()]}, {local.day} {_MONTHS[local.month - 1]}"
    if local.year != pkt_now(now_utc).year:
        text += f" {local.year}"
    return text


def format_date_relative(dt: datetime, now_utc: datetime | None = None) -> str:
    """"Today" / "Tomorrow" when within a day of today (Pakistan calendar), otherwise `format_date`."""
    delta = (pkt_date_of(dt) - pkt_today(now_utc)).days
    return {0: "Today", 1: "Tomorrow"}.get(delta) or format_date(dt, now_utc)


def format_when(dt: datetime, now_utc: datetime | None = None) -> str:
    """"Wed, 23 Sep, 7:30 PM" -- for notifications and error messages about a moment in time."""
    return f"{format_date_relative(dt, now_utc)}, {format_time(dt)}"


def format_when_range(starts_at: datetime, ends_at: datetime, now_utc: datetime | None = None) -> str:
    """"Wed, 23 Sep, 7:30 PM to 9:00 PM" (or "Tomorrow, 7:30 PM to 9:00 PM")."""
    return f"{format_date_relative(starts_at, now_utc)}, {format_time_range(starts_at, ends_at)}"


def format_slot_label(starts_at: datetime, ends_at: datetime, now_utc: datetime | None = None) -> str:
    """"7:30 PM to 9:00 PM, Wed 23 Sep": the ready-made label the chat assistant copies verbatim.

    Always an explicit date (never "Today"/"Tomorrow"): a label is stored in chat history and would go
    stale overnight. The assistant is handed THIS instead of raw UTC timestamps: given UTC it converts
    (badly) and told players things like "3:00 PM - 4:30 PM UTC" or that 9 PM was unavailable because the
    last slot "ends at 17:30" (which is 10:30 PM Pakistan time)."""
    local = utc_to_pkt_naive(starts_at)
    date_text = f"{_WEEKDAYS[local.weekday()]} {local.day} {_MONTHS[local.month - 1]}"
    if local.year != pkt_now(now_utc).year:
        date_text += f" {local.year}"
    return f"{format_time_range(starts_at, ends_at)}, {date_text}"


# Kept under its old name: the WhatsApp "Held!" reply and the chat tools import it.
format_pkt_slot = format_slot_label


def format_pkt_now(now_utc: datetime) -> str:
    """"Sunday, 20 September 2026, 9:15 PM" in Pakistan time, for the assistant's system prompt."""
    local = utc_to_pkt_naive(now_utc)
    return f"{_WEEKDAYS_LONG[local.weekday()]}, {local.day} {_MONTHS_LONG[local.month - 1]} {local.year}, {_clock(local)}"


# --- safety net for model-written text --------------------------------------------------------------

_ISO_TIMESTAMP_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?")
_TIME_24H_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b(?!\s?[AaPp]\.?[Mm])")


def contains_24h_time(text: str) -> bool:
    """True if `text` has a clock time that is not followed by AM/PM (e.g. "17:30", "07:00")."""
    return bool(_TIME_24H_RE.search(text))


def enforce_display_format(text: str) -> str:
    """Last line of defence for text WRITTEN BY THE MODEL: rewrites any ISO timestamp as a human "when" and
    any stray 24-hour time as 12-hour. The real fix is that tools hand the model ready-made labels and the
    prompt forbids reformatting; this only guarantees a player never SEES "21:00" or "2026-09-23T14:30Z"
    if the model slips anyway. (An ISO timestamp carries its own offset, so it is converted properly; a
    bare "17:30" is read as already-local, which is the best a text-only guess can do.)"""

    def _iso(match: re.Match) -> str:
        raw = match.group(0).replace(" ", "T", 1)
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return match.group(0)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return format_when(parsed)

    def _clock24(match: re.Match) -> str:
        hour, minute = int(match.group(1)), int(match.group(2))
        return f"{hour % 12 or 12}:{minute:02d} {'AM' if hour < 12 else 'PM'}"

    return _TIME_24H_RE.sub(_clock24, _ISO_TIMESTAMP_RE.sub(_iso, text))
