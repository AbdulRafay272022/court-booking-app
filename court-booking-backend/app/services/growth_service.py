import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.payment import Payment
from app.models.user import User
from app.models.venue import Venue, VenueStatus
from app.schemas.admin import OwnerDigestOut, PlatformStatsOut

REVENUE_STATUSES = (BookingStatus.BOOKED, BookingStatus.COMPLETED)


class GrowthService:
    """Read-side aggregates for the admin dashboard and owner daily digest.

    Computed live from bookings/payments for now; app/jobs/growth_job.py
    additionally materializes per-court/hour booking-rate stats into
    slot_stats nightly for trend charts that would otherwise need a full
    table scan on every request.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def platform_stats(self) -> PlatformStatsOut:
        now = datetime.now(timezone.utc)
        window_start = now - timedelta(days=30)

        total_users = await self.db.scalar(select(func.count(User.id)))
        total_venues = await self.db.scalar(select(func.count(Venue.id)))
        approved_venues = await self.db.scalar(
            select(func.count(Venue.id)).where(Venue.status == VenueStatus.APPROVED)
        )
        total_courts = await self.db.scalar(select(func.count(Court.id)))
        total_bookings = await self.db.scalar(select(func.count(Booking.id)))
        booked_bookings = await self.db.scalar(
            select(func.count(Booking.id)).where(Booking.status == BookingStatus.BOOKED)
        )
        bookings_last_30_days = await self.db.scalar(
            select(func.count(Booking.id)).where(Booking.created_at >= window_start)
        )
        revenue_last_30_days = await self.db.scalar(
            select(func.coalesce(func.sum(Booking.amount_paid), 0)).where(
                Booking.status.in_(REVENUE_STATUSES), Booking.created_at >= window_start
            )
        )

        return PlatformStatsOut(
            total_users=total_users or 0,
            total_venues=total_venues or 0,
            approved_venues=approved_venues or 0,
            total_courts=total_courts or 0,
            total_bookings=total_bookings or 0,
            booked_bookings=booked_bookings or 0,
            bookings_last_30_days=bookings_last_30_days or 0,
            revenue_last_30_days=float(revenue_last_30_days or 0),
        )

    async def owner_digest(self, owner_id: uuid.UUID) -> list[OwnerDigestOut]:
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(days=1)
        week_end = now + timedelta(days=7)

        venues_result = await self.db.execute(select(Venue).where(Venue.owner_id == owner_id))
        venues = venues_result.scalars().all()

        digests: list[OwnerDigestOut] = []
        for venue in venues:
            court_ids_result = await self.db.execute(select(Court.id).where(Court.venue_id == venue.id))
            court_ids = [row[0] for row in court_ids_result.all()]
            if not court_ids:
                digests.append(
                    OwnerDigestOut(
                        venue_id=venue.id,
                        venue_name=venue.name,
                        bookings_today=0,
                        revenue_today=0.0,
                        payments_awaiting_review=0,
                        upcoming_bookings_7_days=0,
                    )
                )
                continue

            bookings_today = await self.db.scalar(
                select(func.count(Booking.id)).where(
                    Booking.court_id.in_(court_ids),
                    Booking.starts_at >= today_start,
                    Booking.starts_at < today_end,
                    Booking.status.in_(REVENUE_STATUSES),
                )
            )
            revenue_today = await self.db.scalar(
                select(func.coalesce(func.sum(Booking.amount_paid), 0)).where(
                    Booking.court_id.in_(court_ids),
                    Booking.starts_at >= today_start,
                    Booking.starts_at < today_end,
                    Booking.status.in_(REVENUE_STATUSES),
                )
            )
            payments_awaiting_review = await self.db.scalar(
                select(func.count(Payment.id))
                .join(Booking, Booking.id == Payment.booking_id)
                .where(Booking.court_id.in_(court_ids), Payment.review_verdict.is_(None))
            )
            upcoming = await self.db.scalar(
                select(func.count(Booking.id)).where(
                    Booking.court_id.in_(court_ids),
                    Booking.starts_at >= now,
                    Booking.starts_at < week_end,
                    Booking.status.in_((BookingStatus.BOOKED, BookingStatus.PAYMENT_SUBMITTED, BookingStatus.HELD)),
                )
            )

            digests.append(
                OwnerDigestOut(
                    venue_id=venue.id,
                    venue_name=venue.name,
                    bookings_today=bookings_today or 0,
                    revenue_today=float(revenue_today or 0),
                    payments_awaiting_review=payments_awaiting_review or 0,
                    upcoming_bookings_7_days=upcoming or 0,
                )
            )
        return digests
