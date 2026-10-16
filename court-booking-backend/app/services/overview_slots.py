"""Owner Overview: the ONE shared slot-count function, and the SQL form of the operating-day rule.

OPERATING DAY (docs/owner-overview-contract.md): a slot or booking belongs to the schedule day that OPENS it
(Section 32 Part 3). Thursday 3 PM to 3 AM covers Friday 1:00 AM, so a 1:00 AM Friday booking is a THURSDAY booking.
Times are Pakistan wall-clock (fixed +5h, no DST), exactly like `app.utils.schedule.opening_day_of`.

SLOT COUNTS: the unit is a 30-minute grid slot of the selected courts in the operating day, from
`AvailabilityService.build_day_slots` (the same grid code the day view and month calendar run). Closed hours are not
slots. Each slot has exactly ONE state:

    blocked  an owner blackout covers it (wins over a booking, as in the grid)
    booked   a confirmed booking covers it (status booked / completed / no_show)
    pending  a held or payment_submitted booking covers it
    free     everything else that is open

so `total == booked + pending + blocked + free` ALWAYS, by construction (it is a partition of the grid). `free` is split
into `free_upcoming` (ends after now) and `free_past` (already ended); past booked slots stay `booked`.
Fixed number of queries: schedule templates, blackouts, bookings (3), whatever the number of courts or bookings.
"""
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import Date, SmallInteger, Time, case, cast, exists, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.models.blackout import Blackout
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.schedule import ScheduleTemplate
from app.services.availability_service import AvailabilityService
from app.utils.schedule import schedule_window
from app.utils.timezone import PKT_OFFSET

CONFIRMED_STATUSES = (BookingStatus.BOOKED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW)
PENDING_STATUSES = (BookingStatus.HELD, BookingStatus.PAYMENT_SUBMITTED)


def operating_day_expr() -> ColumnElement:
    """SQL twin of `opening_day_of(utc_to_pkt_naive(bookings.starts_at), templates)`: the DATE of the schedule day that
    opens the booking's start. It is the previous calendar day when the court's previous weekday template is overnight
    (closes_next_day) and the start's local time of day is before that template's close time; otherwise the local date.
    Correlated on `Booking`, so the caller needs `bookings` in its FROM."""
    local_ts = func.timezone("UTC", Booking.starts_at) + literal_column("interval '5 hours'")
    prev_ts = local_ts - literal_column("interval '1 day'")
    prev_dow = cast(func.extract("isodow", prev_ts) - 1, SmallInteger)
    in_previous_tail = exists().where(
        ScheduleTemplate.court_id == Booking.court_id,
        ScheduleTemplate.is_active.is_(True),
        ScheduleTemplate.closes_next_day.is_(True),
        ScheduleTemplate.day_of_week == prev_dow,
        cast(local_ts, Time) < ScheduleTemplate.close_time,
    )
    return case((in_previous_tail, cast(prev_ts, Date)), else_=cast(local_ts, Date))


def starts_between_prefilter(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """A coarse, index-friendly UTC window that contains every booking whose operating day is in [date_from, date_to]
    (an overnight tail starts up to a day after its opening day's midnight). The exact test is `operating_day_expr`."""
    start = (datetime.combine(date_from, datetime.min.time()) - PKT_OFFSET).replace(tzinfo=timezone.utc)
    end = (datetime.combine(date_to + timedelta(days=2), datetime.min.time()) - PKT_OFFSET).replace(tzinfo=timezone.utc)
    return start, end


@dataclass
class CourtSlotCount:
    court_id: uuid.UUID
    court_name: str
    total: int = 0
    booked: int = 0
    pending: int = 0
    blocked: int = 0
    free: int = 0
    free_upcoming: int = 0
    free_past: int = 0


@dataclass
class SlotCounts:
    operating_start: datetime | None
    operating_end: datetime | None
    by_court: list[CourtSlotCount] = field(default_factory=list)

    def _sum(self, attr: str) -> int:
        return sum(getattr(c, attr) for c in self.by_court)

    total = property(lambda self: self._sum("total"))
    booked = property(lambda self: self._sum("booked"))
    pending = property(lambda self: self._sum("pending"))
    blocked = property(lambda self: self._sum("blocked"))
    free = property(lambda self: self._sum("free"))
    free_upcoming = property(lambda self: self._sum("free_upcoming"))
    free_past = property(lambda self: self._sum("free_past"))


def classify_court_day(
    court: Court,
    target_date: date,
    template: ScheduleTemplate | None,
    blackouts: list[Blackout],
    bookings: list[Booking],
    now: datetime,
) -> tuple[CourtSlotCount, datetime | None, datetime | None]:
    """Pure: partition one court's grid for the schedule day opening on `target_date` into the four states."""
    # confirmed bookings first, so a (rare) overlapping stale pending one never hides a confirmed one in the grid
    ordered = sorted(bookings, key=lambda b: 0 if b.status in CONFIRMED_STATUSES else 1)
    slots = AvailabilityService.build_day_slots(court, target_date, template, [], blackouts, ordered)
    count = CourtSlotCount(court_id=court.id, court_name=court.name)
    for s in slots:
        count.total += 1
        if s.status == "blocked":
            count.blocked += 1
        elif s.status == "available":
            count.free += 1
            if s.ends_at > now:
                count.free_upcoming += 1
            else:
                count.free_past += 1
        elif s.status in {b.value for b in CONFIRMED_STATUSES}:
            count.booked += 1
        else:  # held / payment_submitted
            count.pending += 1
    if not slots:
        return count, None, None
    return count, slots[0].starts_at, slots[-1].ends_at


async def count_slots(
    db: AsyncSession, courts: list[Court], target_date: date, now: datetime | None = None
) -> SlotCounts:
    """The shared slot-count function (Overview cards, tested by the invariant tests). 3 queries, not per court."""
    now = now or datetime.now(timezone.utc)
    if not courts:
        return SlotCounts(None, None, [])
    court_ids = [c.id for c in courts]
    templates = {
        t.court_id: t
        for t in (
            await db.execute(
                select(ScheduleTemplate).where(
                    ScheduleTemplate.court_id.in_(court_ids),
                    ScheduleTemplate.is_active.is_(True),
                    ScheduleTemplate.day_of_week == target_date.weekday(),
                )
            )
        ).scalars()
    }
    blackouts: dict[uuid.UUID, list[Blackout]] = {cid: [] for cid in court_ids}
    bookings: dict[uuid.UUID, list[Booking]] = {cid: [] for cid in court_ids}
    if templates:
        windows = [schedule_window(target_date, t) for t in templates.values()]
        window_start = (min(w[0] for w in windows) - PKT_OFFSET).replace(tzinfo=timezone.utc)
        window_end = (max(w[1] for w in windows) - PKT_OFFSET).replace(tzinfo=timezone.utc)
        for bl in (
            await db.execute(
                select(Blackout).where(
                    Blackout.court_id.in_(templates.keys()),
                    Blackout.starts_at < window_end,
                    Blackout.ends_at > window_start,
                )
            )
        ).scalars():
            blackouts[bl.court_id].append(bl)
        for b in (
            await db.execute(
                select(Booking).where(
                    Booking.court_id.in_(templates.keys()),
                    Booking.status.in_(CONFIRMED_STATUSES + PENDING_STATUSES),
                    Booking.starts_at < window_end,
                    Booking.ends_at > window_start,
                )
            )
        ).scalars():
            bookings[b.court_id].append(b)

    result = SlotCounts(None, None, [])
    first_starts: list[datetime] = []
    last_ends: list[datetime] = []
    for court in courts:
        count, first, last = classify_court_day(
            court, target_date, templates.get(court.id), blackouts[court.id], bookings[court.id], now
        )
        result.by_court.append(count)
        if first is not None and last is not None:
            first_starts.append(first)
            last_ends.append(last)
    if first_starts:
        result.operating_start = min(first_starts)
        result.operating_end = max(last_ends)
    return result
