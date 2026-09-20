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


def _clock(dt: datetime) -> str:
    """12-hour clock without a leading zero: 10:00 PM."""
    return dt.strftime("%I:%M %p").lstrip("0")


def format_pkt_slot(starts_at: datetime, ends_at: datetime) -> str:
    """Human label for a slot in Pakistan time, e.g. "Tue 22 Sep, 10:00 PM - 11:30 PM".

    The chat assistant is handed THIS instead of raw UTC timestamps: given UTC, it converts
    (badly) and ends up telling players things like "3:00 PM - 4:30 PM UTC"."""
    start, end = utc_to_pkt_naive(starts_at), utc_to_pkt_naive(ends_at)
    return f"{start.strftime('%a')} {start.day} {start.strftime('%b')}, {_clock(start)} - {_clock(end)}"


def format_pkt_now(now_utc: datetime) -> str:
    """"Sunday, 20 September 2026, 9:15 PM" in Pakistan time, for the assistant's system prompt."""
    local = utc_to_pkt_naive(now_utc)
    return f"{local.strftime('%A')}, {local.day} {local.strftime('%B %Y')}, {_clock(local)}"
