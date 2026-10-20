"""Per-venue hold / owner-reminder / auto-cancel timers (Round 2 Stage 2, docs/stage2-contract.md sections 2-3).

ONE source of the defaults: `DEFAULTS` below. The TypeScript twin is `VENUE_TIMER_DEFAULTS` in
`packages/types/src/stage2.ts`; both are checked against `packages/types/src/fixtures/venue-timer-defaults.json`
(tests/test_stage2_timers.py). A venue column that is NULL means "use the default", and the defaults ARE the
behaviour from before these columns existed (hold 15 min = BOOKING_HOLD_MINUTES; auto-cancel after 120 min =
PAYMENT_REVIEW_HOURS 2 h; owner reminders first after 10, every 30, at most 5, final warning 5 min before the
cancel per `reminder_schedule`).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

TIMER_KEYS = (
    "hold_minutes",
    "reminders_enabled",
    "first_reminder_after_min",
    "repeat_every_min",
    "max_reminders",
    "auto_cancel_enabled",
    "auto_cancel_after_min",
)

DEFAULTS: dict[str, Any] = {
    "hold_minutes": 15,
    "reminders_enabled": True,
    "first_reminder_after_min": 10,
    "repeat_every_min": 30,
    "max_reminders": 5,
    "auto_cancel_enabled": True,
    "auto_cancel_after_min": 120,
}

# Inclusive ranges (None = no upper bound). Mirror the CHECK constraints in the migration e5b8c2d4f6a1.
RANGES: dict[str, tuple[int, int | None]] = {
    "hold_minutes": (5, 180),
    "first_reminder_after_min": (1, None),
    "repeat_every_min": (5, None),
    "max_reminders": (1, 10),
    "auto_cancel_after_min": (5, 1440),
}
# SMALLINT upper bound for the open-ended ranges (so a huge value is a clean 422, not a DB error).
SMALLINT_MAX = 32767


def stored_values(venue: Any) -> dict[str, Any]:
    """The venue's own values (None = not set)."""
    return {k: getattr(venue, k, None) for k in TIMER_KEYS}


def effective_timers(venue: Any | None) -> dict[str, Any]:
    """What actually applies at this venue: its own value, else the default."""
    values = stored_values(venue) if venue is not None else {}
    return {k: (values.get(k) if values.get(k) is not None else DEFAULTS[k]) for k in TIMER_KEYS}


def timers_view(venue: Any) -> dict[str, Any]:
    return {"values": stored_values(venue), "defaults": dict(DEFAULTS), "effective": effective_timers(venue)}


def validate_values(values: dict[str, Any]) -> list[dict[str, Any]]:
    """Range errors as [{field, code, min, max}] (empty = valid). None is always valid (reset to default)."""
    errors: list[dict[str, Any]] = []
    for key, (lo, hi) in RANGES.items():
        v = values.get(key)
        if v is None:
            continue
        upper = hi if hi is not None else SMALLINT_MAX
        if isinstance(v, bool) or not isinstance(v, int) or v < lo or v > upper:
            errors.append({"field": key, "code": "TIMER_OUT_OF_RANGE", "min": lo, "max": hi})
    return errors


def hold_minutes_for(venue: Any | None) -> int:
    return int(effective_timers(venue)["hold_minutes"])


def auto_cancel_minutes_for(venue: Any | None) -> int | None:
    """Minutes after the screenshot when an unreviewed payment auto-cancels the booking, or None = never."""
    eff = effective_timers(venue)
    if not eff["auto_cancel_enabled"]:
        return None
    return int(eff["auto_cancel_after_min"])


def payment_deadline_for(venue: Any | None, submitted_at: datetime) -> datetime | None:
    """bookings.payment_deadline for a payment submitted at `submitted_at` (None = never auto-cancel)."""
    minutes = auto_cancel_minutes_for(venue)
    return submitted_at + timedelta(minutes=minutes) if minutes is not None else None


async def submitted_at_of(db, booking) -> datetime | None:
    """When the screenshot awaiting review was submitted: the pending payment's created_at."""
    from sqlalchemy import select

    from app.models.payment import Payment

    return await db.scalar(
        select(Payment.created_at)
        .where(Payment.booking_id == booking.id, Payment.review_verdict.is_(None))
        .order_by(Payment.created_at.desc())
        .limit(1)
    )


async def reapply_payment_deadlines(db, venue) -> int:
    """After the owner changes the auto-cancel setting, every booking of this venue still waiting for payment
    review gets its `payment_deadline` recomputed from its own submission time (NULL = never auto-cancel), so the
    new setting applies to screenshots already in the queue. Not committed. Returns how many rows changed."""
    from sqlalchemy import select

    from app.models.booking import Booking, BookingStatus
    from app.models.court import Court

    rows = (
        await db.execute(
            select(Booking)
            .join(Court, Court.id == Booking.court_id)
            .where(Court.venue_id == venue.id, Booking.status == BookingStatus.PAYMENT_SUBMITTED)
        )
    ).scalars().all()
    changed = 0
    for booking in rows:
        submitted = await submitted_at_of(db, booking)
        if submitted is None:
            continue
        deadline = payment_deadline_for(venue, submitted)
        if deadline != booking.payment_deadline:
            booking.payment_deadline = deadline
            changed += 1
    return changed
