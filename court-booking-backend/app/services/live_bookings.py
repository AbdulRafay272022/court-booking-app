"""Owner Round 2 (B1): a hold is FREE the moment its time runs out, not when the expiry job next runs.

`live_claim()` is the read-time version of "this booking still claims its slot": a held / payment_submitted /
booked booking, EXCEPT a held one whose `held_until` has passed. Every query that decides whether a slot is taken
(availability grid, quote, month summary, waitlist, overview slot counter) uses it. The database's
`one_live_booking_per_slot` index and `no_overlapping_live_bookings` constraint still count an expired-but-not-yet-
cancelled hold as live, so `release_stale_holds` cancels such holds (system, hold_expired) inside the same
transaction as a new booking's insert (BookingService._insert_booking) -- see expire_stale_bookings for the job's
own copy of the same transition.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import and_, or_
from sqlalchemy.sql.elements import ColumnElement

from app.models.booking import LIVE_BOOKING_STATUSES, Booking, BookingStatus


def hold_not_expired(now: datetime | None = None) -> ColumnElement:
    now = now or datetime.now(timezone.utc)
    return or_(Booking.status != BookingStatus.HELD, Booking.held_until.is_(None), Booking.held_until > now)


def live_claim(now: datetime | None = None, statuses=LIVE_BOOKING_STATUSES) -> ColumnElement:
    return and_(Booking.status.in_(statuses), hold_not_expired(now))


def is_live_claim(booking: Booking, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    if booking.status not in LIVE_BOOKING_STATUSES:
        return False
    return not (booking.status == BookingStatus.HELD and booking.held_until is not None and booking.held_until <= now)
