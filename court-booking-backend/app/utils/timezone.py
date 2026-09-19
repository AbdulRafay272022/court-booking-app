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
