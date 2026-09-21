import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.stats import SlotStats
from app.services.audit_service import AuditService
from app.services.growth_service import GrowthService
from app.utils.timezone import pkt_date_of, pkt_today, utc_to_pkt_naive

logger = structlog.get_logger(__name__)

REVENUE_STATUSES = (BookingStatus.BOOKED, BookingStatus.COMPLETED)
# A stable, non-random UUID so every nightly snapshot audit row shares the
# same entity_id and can be queried as one time series.
PLATFORM_ENTITY_ID = uuid.uuid5(uuid.NAMESPACE_DNS, "platform.slot_stats")


async def materialize_nightly_stats(session_factory: async_sessionmaker = AsyncSessionLocal) -> dict:
    """Nightly job with two jobs in one:

    1. Snapshots platform-wide totals into the audit log so the admin
       dashboard can chart trends without recomputing full-table aggregates
       on every request.
    2. Rebuilds slot_stats (`compute_slot_stats`, Section 14): booking-rate
       per (court, day_of_week, hour), guardrailed so a suggestion is never
       built on too little data -- see that function's docstring.
    """
    async with session_factory() as db:
        growth_service = GrowthService(db)
        audit = AuditService(db)

        stats = await growth_service.platform_stats()
        await audit.log(
            actor_user_id=None,
            actor_type="system",
            action="growth.nightly_snapshot",
            entity_type="platform",
            entity_id=PLATFORM_ENTITY_ID,
            new_value=stats.model_dump(),
        )

        await compute_slot_stats(db)
        await db.commit()

    logger.info("growth_job.completed", **stats.model_dump())
    return stats.model_dump()


async def compute_slot_stats(db: AsyncSession) -> None:
    """For each active court, for each (day_of_week, hour) combination,
    compute how often that slot was booked -- this is what powers the
    "this slot is underbooked" suggestions in GET /owners/growth (Section
    12), which reads straight from this materialized table rather than
    recomputing live.

    GUARDRAIL (Section 14.2): a bucket is only written if the court has at
    least GROWTH_MIN_WEEKS of history *and* that weekday occurred at least
    GROWTH_MIN_OBSERVATIONS times in the window -- one wrong suggestion
    costs more owner trust than ten right ones, so a court/slot without
    enough data gets no row at all rather than a shaky one.

    One deliberate deviation from Section 14.2's illustrative pseudocode:
    that comment uses a 12-week lookback, but under (day_of_week, hour)
    bucketing a single bucket can occur at most once per week, so 12 weeks
    can never produce the required >=20 observations for ANY bucket -- the
    two guardrail numbers are mathematically incompatible at that window
    size. GROWTH_LOOKBACK_DAYS (180 days, ~25.7 weeks) is used instead,
    which is long enough for both thresholds to be reachable together
    while still being materially more than the 6-week minimum.
    """
    settings = get_settings()
    today = pkt_today()
    courts_result = await db.execute(select(Court.id, Court.created_at))
    courts = courts_result.all()

    for court_id, court_created_at in courts:
        window_start_date = max(
            pkt_date_of(court_created_at), today - timedelta(days=settings.GROWTH_LOOKBACK_DAYS)
        )
        weeks_of_data = (today - window_start_date).days // 7
        if weeks_of_data < settings.GROWTH_MIN_WEEKS:
            continue  # court hasn't been open long enough to trust any pattern yet

        window_start = datetime.combine(window_start_date, datetime.min.time(), tzinfo=timezone.utc)
        day_occurrences: Counter[int] = Counter()
        d = window_start_date
        while d <= today:
            day_occurrences[d.weekday()] += 1
            d += timedelta(days=1)

        bookings_result = await db.execute(
            select(Booking.starts_at, Booking.price).where(
                Booking.court_id == court_id,
                Booking.status.in_(REVENUE_STATUSES),
                Booking.starts_at >= window_start,
            )
        )
        buckets: dict[tuple[int, int], list[float]] = defaultdict(list)
        for starts_at, price in bookings_result.all():
            # Bucket by the PKT wall-clock day/hour an owner actually thinks
            # in, not the raw UTC instant the booking is stored as.
            local_starts_at = utc_to_pkt_naive(starts_at)
            buckets[(local_starts_at.weekday(), local_starts_at.hour)].append(float(price))

        for (day_of_week, hour), prices in buckets.items():
            total_slots = day_occurrences.get(day_of_week, 0)
            if total_slots < settings.GROWTH_MIN_OBSERVATIONS:
                continue  # not enough occurrences of this exact slot to trust its rate

            booked_count = len(prices)
            row = {
                "court_id": court_id,
                "day_of_week": day_of_week,
                "hour": hour,
                "total_slots": total_slots,
                "booked_count": booked_count,
                "booking_rate": round(booked_count / total_slots, 4),
                "avg_price": round(sum(prices) / len(prices), 2),
                "weeks_of_data": weeks_of_data,
                "computed_at": today,
            }
            stmt = insert(SlotStats).values(**row)
            stmt = stmt.on_conflict_do_update(
                index_elements=["court_id", "day_of_week", "hour", "computed_at"],
                set_={
                    "total_slots": stmt.excluded.total_slots,
                    "booked_count": stmt.excluded.booked_count,
                    "booking_rate": stmt.excluded.booking_rate,
                    "avg_price": stmt.excluded.avg_price,
                    "weeks_of_data": stmt.excluded.weeks_of_data,
                },
            )
            await db.execute(stmt)
