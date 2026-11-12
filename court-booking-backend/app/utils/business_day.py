"""Ledger v2 business day (docs/design/LEDGER-V2-CONTRACT.md 2.1).

Money and slots belong to the day the venue OPENED, not the calendar day: a venue open Mon 6 PM - Tue 4 AM puts Tue 1:00 AM
money on Monday. For each schedule day (Monday = 0) we take the LATEST close_time among the venue's active courts whose
schedule for that day runs past midnight (`closes_next_day`); a PKT time before that close on the next calendar morning
belongs to the previous day. A venue with no overnight court uses the plain Pakistan calendar day.

The split is pure (`business_date_for`) so it is unit-tested without a database; `venue_overnight_closes` loads the map.
"""

import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils.timezone import utc_now, utc_to_pkt_naive

# schedule day (0 = Monday) -> the latest next-morning close_time of any active court that day
OvernightCloses = dict[int, time]


def business_date_for(instant: datetime, overnight: OvernightCloses) -> date:
    """The business day `instant` (an aware UTC datetime) belongs to, given the venue's overnight closing times."""
    local = utc_to_pkt_naive(instant)
    day = local.date()
    previous = day - timedelta(days=1)
    close = overnight.get(previous.weekday())
    if close is not None and local.time() < close:
        return previous
    return day


async def venue_overnight_closes(db: AsyncSession, venue_id: uuid.UUID) -> OvernightCloses:
    """For each schedule day, the latest close_time of the venue's active courts that close the next morning."""
    from app.models.court import Court
    from app.models.schedule import ScheduleTemplate

    rows = (
        await db.execute(
            select(ScheduleTemplate.day_of_week, ScheduleTemplate.close_time)
            .join(Court, Court.id == ScheduleTemplate.court_id)
            .where(
                Court.venue_id == venue_id,
                Court.is_active.is_(True),
                ScheduleTemplate.is_active.is_(True),
                ScheduleTemplate.closes_next_day.is_(True),
            )
        )
    ).all()
    out: OvernightCloses = {}
    for dow, close in rows:
        if dow not in out or close > out[dow]:
            out[dow] = close
    return out


async def business_date(db: AsyncSession, venue_id: uuid.UUID, instant: datetime | None = None) -> date:
    """The venue's business day for `instant` (default: now)."""
    return business_date_for(instant or utc_now(), await venue_overnight_closes(db, venue_id))
