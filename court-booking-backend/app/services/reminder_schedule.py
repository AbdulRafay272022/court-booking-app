"""Owner payment-review reminder schedule (Owner Round 2, B1).

ONE pure function decides when the owner is reminded about a payment screenshot that is waiting for
approval, when the final "this booking will be cancelled in 5 minutes" warning goes out, and when the
booking is auto-cancelled. The web/mobile Settings preview uses the TypeScript twin
(`packages/types/src/reminder-schedule.ts`); both are checked against the same cases in
`packages/types/src/fixtures/reminder-schedule-cases.json` (tests/test_round2_fixtures.py), so the
preview line and the real scheduler can never disagree.

Rules (docs/round2-spec.md B1):
- Reminders at `first_after_min`, then every `every_min`, at most `max_reminders` of them (0 = reminders off).
- Auto-cancel OFF (`auto_cancel_min` None or 0): no final warning, no cancel.
- Auto-cancel ON with Y minutes: reminders at or after Y are dropped; ONE final warning 5 minutes before Y
  (Y - 5), or at half of Y (floor, whole minutes, minimum 1) when Y <= 10; the final warning does not count toward
  `max_reminders`. A reminder that would land at or after the final warning is dropped too (it would say
  the same thing a moment before the warning).
- All values are whole minutes after the payment screenshot was submitted.

Stage 1: nothing calls this with per-venue values yet (per-venue timers need schema, Stage 2); it exists so
the preview and the future scheduler share one implementation.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

FINAL_WARNING_LEAD_MIN = 5
SMALL_AUTO_CANCEL_MIN = 10


def reminder_schedule(
    first_after_min: int,
    every_min: int,
    max_reminders: int,
    auto_cancel_min: int | None,
) -> tuple[list[int], int | None, int | None]:
    """Returns (reminder minutes, final warning minute or None, cancel minute or None)."""
    cancel_at = auto_cancel_min if auto_cancel_min else None
    final_warning: int | None = None
    if cancel_at is not None:
        final_warning = max(1, cancel_at // 2) if cancel_at <= SMALL_AUTO_CANCEL_MIN else cancel_at - FINAL_WARNING_LEAD_MIN

    reminders: list[int] = []
    step = max(1, int(every_min))
    at = int(first_after_min)
    for _ in range(max(0, int(max_reminders))):
        if cancel_at is not None and (at >= cancel_at or (final_warning is not None and at >= final_warning)):
            break
        reminders.append(at)
        at += step
    return reminders, final_warning, cancel_at


def shift_to_open_hours(at: datetime, open_time: time | None, close_time: time | None) -> datetime:
    """Night-time shifting: a reminder due while the venue is closed is sent when it next opens.

    `at` is a naive Pakistan wall-clock datetime (the domain schedule_templates use). `open_time` /
    `close_time` are the venue's operating hours; `close_time <= open_time` means the venue stays open past
    midnight (e.g. 16:00 - 02:00). `open_time == close_time` (or either None) means open around the clock, so
    nothing moves. An instant inside opening hours is returned unchanged.
    """
    if open_time is None or close_time is None or open_time == close_time:
        return at
    t = at.time()
    if open_time < close_time:
        if open_time <= t < close_time:
            return at
        if t < open_time:
            return datetime.combine(at.date(), open_time)
        return datetime.combine(at.date() + timedelta(days=1), open_time)
    # overnight window: open from open_time until midnight, and from midnight until close_time
    if t >= open_time or t < close_time:
        return at
    return datetime.combine(at.date(), open_time)
