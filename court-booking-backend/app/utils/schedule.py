"""Opening-hours arithmetic that must be identical everywhere (Section 32 Part 3: overnight courts).

The model in one paragraph: a schedule day BELONGS TO THE DAY IT OPENS. A Thursday 3 PM to 3 AM schedule covers Thursday
3 PM through Friday 3 AM; a slot at Friday 1:00 AM is a Thursday slot (its schedule, its blackouts, its price rules). A
template stores `open_time`, `close_time` and an explicit `closes_next_day` flag: the flag is set exactly when
`close_time <= open_time` (close 03:00 vs open 15:00 = next morning; close == open = open 24 hours; close 00:00 = midnight).

Everything here is naive Pakistan wall-clock time (Pakistan has no DST); conversion to UTC happens only at the storage
boundary. Pure functions, no database, so the availability engine, the growth job and the schedule validator share them.
"""
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta
from typing import Protocol

DAY_MINUTES = 24 * 60


class _Template(Protocol):
    open_time: time
    close_time: time
    closes_next_day: bool


def closes_next_day_for(open_time: time, close_time: time) -> bool:
    """The flag a pair of times implies: close at or before open means the court closes the next morning."""
    return close_time <= open_time


def schedule_window(opening_date: date, template: _Template) -> tuple[datetime, datetime]:
    """(opens, closes) as naive PKT datetimes for the schedule day that OPENS on `opening_date`."""
    opens = datetime.combine(opening_date, template.open_time)
    closes = datetime.combine(opening_date, template.close_time)
    if template.closes_next_day:
        closes += timedelta(days=1)
    return opens, closes


def opening_day_of(local: datetime, templates: Mapping[int, _Template]) -> date:
    """The opening day whose schedule the naive PKT instant `local` belongs to.

    Yesterday's schedule owns the instant when it is overnight and still open at `local` (1:00 AM Friday belongs to
    Thursday's 3 PM to 3 AM); otherwise the instant belongs to its own calendar day."""
    yesterday = local.date() - timedelta(days=1)
    prev = templates.get(yesterday.weekday())
    if prev is not None and prev.closes_next_day:
        opens, closes = schedule_window(yesterday, prev)
        if opens <= local < closes:
            return yesterday
    return local.date()


def minutes_from_midnight(t: time) -> int:
    return t.hour * 60 + t.minute


def rule_matches_window(
    start_time: time | None, end_time: time | None, slot_start_min: int, slot_end_min: int
) -> bool:
    """Does a pricing rule's time window contain the slot [slot_start_min, slot_end_min)?

    Minutes count from midnight of the OPENING day, so a slot after midnight has minutes >= 1440. A rule window may cross
    midnight (22:00 to 02:00) and may sit entirely after midnight (01:00 to 03:00 on an overnight court): it is tried as
    written and shifted by one day. An open-ended window ("from 18:00") runs to the end of the schedule day."""
    if start_time is None and end_time is None:
        return True
    rs = minutes_from_midnight(start_time) if start_time is not None else 0
    if end_time is None:
        windows = [(rs, 3 * DAY_MINUTES), (rs + DAY_MINUTES, 3 * DAY_MINUTES)]
    else:
        re_ = minutes_from_midnight(end_time)
        if start_time is None:
            # "until 18:00" / "until 00:00" (midnight): from the start of the schedule day, NOT shifted a day forward
            # (shifting would make "until 18:00" also cover 19:00 on a same-day court).
            windows = [(0, re_ or DAY_MINUTES)]
            return any(ws <= slot_start_min and slot_end_min <= we for ws, we in windows)
        if re_ <= rs:
            re_ += DAY_MINUTES  # crosses midnight
        windows = [(rs, re_), (rs + DAY_MINUTES, re_ + DAY_MINUTES)]
    return any(ws <= slot_start_min and slot_end_min <= we for ws, we in windows)


def overlap_error(templates: Mapping[int, _Template], day_names: tuple[str, ...]) -> str | None:
    """A readable message when an overnight day runs into the next day's opening (Thursday until 3 AM, Friday opens 2 AM),
    else None. The week wraps: Sunday's tail is checked against Monday's opening."""
    for day in range(7):
        t = templates.get(day)
        nxt = templates.get((day + 1) % 7)
        if t is None or nxt is None or not t.closes_next_day:
            continue
        if t.close_time > nxt.open_time:
            return (
                f"{day_names[day]} runs until {_clock(t.close_time)} the next morning, but "
                f"{day_names[(day + 1) % 7]} opens at {_clock(nxt.open_time)}. The two would overlap: "
                f"open {day_names[(day + 1) % 7]} later, or close {day_names[day]} earlier."
            )
    return None


def _clock(t: time) -> str:
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"
