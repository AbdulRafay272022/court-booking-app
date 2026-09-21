import csv
import io
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone

from fastapi import status
from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.court import Court
from app.models.payment import Payment
from app.models.stats import SlotStats
from app.models.user import User
from app.models.venue import PlanTier, Venue
from app.services.availability_service import AvailabilityService
from app.services.payment_service import PaymentService
from app.utils.timezone import pkt_time_to_utc, pkt_today
from app.schemas.owner_dashboard import (
    GrowthOut,
    GrowthSuggestionOut,
    LedgerOut,
    LedgerRowOut,
    LedgerSummaryOut,
    PendingApprovalOut,
    TodayCourtOut,
    TodayOut,
    TodaySlotOut,
    TodaySummaryOut,
)

REVENUE_STATUSES = (BookingStatus.BOOKED, BookingStatus.COMPLETED)
GROWTH_TIERS = (PlanTier.PRO, PlanTier.BUSINESS)


class OwnerDashboardService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.availability = AvailabilityService(db)

    async def _owner_courts(self, owner: User, venue_id: uuid.UUID | None = None) -> list[Court]:
        query = select(Court).join(Venue, Venue.id == Court.venue_id).where(
            Venue.owner_id == owner.id, Court.is_active.is_(True)
        )
        if venue_id is not None:
            venue = await self.db.get(Venue, venue_id)
            if venue is None or venue.owner_id != owner.id:
                raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_VENUE_OWNER, "Not your venue")
            query = query.where(Court.venue_id == venue_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def today(self, owner: User, target_date: date | None = None, venue_id: uuid.UUID | None = None) -> TodayOut:
        target_date = target_date or pkt_today()
        courts = await self._owner_courts(owner, venue_id)
        court_ids = [c.id for c in courts]

        # A Pakistan calendar day, not a UTC one: [00:00 PKT, 24:00 PKT) = [19:00Z the day before, 19:00Z).
        day_start = pkt_time_to_utc(target_date, time.min)
        day_end = day_start + timedelta(days=1)

        # The day's slots, and the bookings on them. A schedule day belongs to the day it OPENS (Section 32 Part 3), so an
        # overnight court's after-midnight bookings are Today's even though they start on tomorrow's calendar date, and
        # yesterday's after-midnight tail (which starts today) belongs to yesterday, not to this day's totals.
        slots_by_court = {court.id: await self.availability.get_day_slots(court, target_date) for court in courts}
        slot_booking_ids = {s.booking_id for slots in slots_by_court.values() for s in slots if s.booking_id}
        yesterdays_tail_ids: set[uuid.UUID] = set()
        for court in courts:
            for s in await self.availability.get_day_slots(court, target_date - timedelta(days=1)):
                if s.after_midnight and s.booking_id:
                    yesterdays_tail_ids.add(s.booking_id)

        bookings_today: list[Booking] = []
        if court_ids:
            result = await self.db.execute(
                select(Booking).where(
                    Booking.court_id.in_(court_ids),
                    or_(
                        and_(Booking.starts_at >= day_start, Booking.starts_at < day_end),
                        Booking.id.in_(slot_booking_ids) if slot_booking_ids else false(),
                    ),
                )
            )
            # A booking counts for a day only if it STARTS inside that day: in the calendar-day window, or on this schedule
            # day's own slots at/after the day's first slot. (One that merely overlaps the first cell -- a 30-minute-offset
            # walk-in that started the evening before -- belongs to the day it started on.)
            first_slot_start = {
                court.id: slots_by_court[court.id][0].starts_at for court in courts if slots_by_court[court.id]
            }
            bookings_today = []
            for b in result.scalars().all():
                if b.id in yesterdays_tail_ids:
                    continue
                in_calendar_day = day_start <= b.starts_at < day_end
                on_todays_slots = b.id in slot_booking_ids and b.starts_at >= first_slot_start.get(b.court_id, b.starts_at)
                if in_calendar_day or on_todays_slots:
                    bookings_today.append(b)
        bookings_by_id = {b.id: b for b in bookings_today}

        court_outs = []
        for court in courts:
            slots = slots_by_court[court.id]
            slot_outs = []
            for slot in slots:
                booking = bookings_by_id.get(slot.booking_id) if slot.booking_id else None
                slot_outs.append(
                    TodaySlotOut(
                        starts_at=slot.starts_at,
                        ends_at=slot.ends_at,
                        status=slot.status,
                        booking_id=slot.booking_id,
                        player_name=booking.player_name if booking else None,
                        amount_paid=float(booking.amount_paid) if booking else None,
                        price=float(booking.price) if booking else None,
                        balance_due=float(booking.balance_due) if booking else None,
                    )
                )
            court_outs.append(TodayCourtOut(court_id=court.id, name=court.name, slots=slot_outs))

        total_bookings = sum(1 for b in bookings_today if b.status != BookingStatus.CANCELLED)
        total_revenue = sum(float(b.amount_paid) for b in bookings_today if b.status in REVENUE_STATUSES)
        walkins = sum(1 for b in bookings_today if b.source == BookingSource.WALKIN)

        pending_approvals = 0
        if court_ids:
            pending_approvals = await self.db.scalar(
                select(func.count(Payment.id))
                .join(Booking, Booking.id == Payment.booking_id)
                .where(Booking.court_id.in_(court_ids), Payment.review_verdict.is_(None))
            ) or 0

        return TodayOut(
            date=target_date,
            courts=court_outs,
            summary=TodaySummaryOut(
                total_bookings=total_bookings,
                total_revenue=total_revenue,
                pending_approvals=pending_approvals,
                walkins=walkins,
            ),
        )

    async def pending_approvals(self, owner: User, venue_id: uuid.UUID | None = None) -> list[PendingApprovalOut]:
        courts = await self._owner_courts(owner, venue_id)
        court_ids = [c.id for c in courts]
        if not court_ids:
            return []
        court_names = {c.id: c.name for c in courts}

        result = await self.db.execute(
            select(Payment, Booking)
            .join(Booking, Booking.id == Payment.booking_id)
            .where(Booking.court_id.in_(court_ids), Payment.review_verdict.is_(None))
            .order_by(Payment.created_at.asc())
        )
        now = datetime.now(timezone.utc)
        out = []
        for payment, booking in result.all():
            out.append(
                PendingApprovalOut(
                    payment_id=payment.id,
                    booking_id=booking.id,
                    court_name=court_names.get(booking.court_id, ""),
                    starts_at=booking.starts_at,
                    ends_at=booking.ends_at,
                    player_name=booking.player_name,
                    player_phone=booking.player_phone,
                    ocr_verdict=payment.ocr_verdict,
                    ocr_amount=float(payment.ocr_amount) if payment.ocr_amount is not None else None,
                    expected_amount=float(booking.advance_amount),
                    proof_url=PaymentService.proof_url(payment),
                    submitted_at=payment.created_at,
                    minutes_since_submission=round((now - payment.created_at).total_seconds() / 60, 1),
                )
            )
        return out

    async def _ledger_bookings(
        self, owner: User, start_date: date, end_date: date, venue_id: uuid.UUID | None
    ) -> tuple[list[Booking], dict[uuid.UUID, str]]:
        courts = await self._owner_courts(owner, venue_id)
        court_ids = [c.id for c in courts]
        court_names = {c.id: c.name for c in courts}
        if not court_ids:
            return [], court_names

        # Pakistan days: the range the owner picked is in THEIR calendar, so the boundaries are PKT midnights.
        range_start = pkt_time_to_utc(start_date, time.min)
        range_end = pkt_time_to_utc(end_date, time.min) + timedelta(days=1)
        result = await self.db.execute(
            select(Booking)
            .where(Booking.court_id.in_(court_ids), Booking.starts_at >= range_start, Booking.starts_at < range_end)
            .order_by(Booking.starts_at.asc())
        )
        return list(result.scalars().all()), court_names

    async def ledger(
        self, owner: User, start_date: date, end_date: date, venue_id: uuid.UUID | None = None
    ) -> LedgerOut:
        if end_date < start_date:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "end_date must be >= start_date")
        bookings, court_names = await self._ledger_bookings(owner, start_date, end_date, venue_id)

        rows = [
            LedgerRowOut(
                booking_id=b.id,
                date=b.starts_at,
                court=court_names.get(b.court_id, ""),
                player=b.player_name,
                source=b.source.value,
                amount_paid=float(b.amount_paid),
                balance_due=float(b.balance_due),
                status=b.status.value,
            )
            for b in bookings
        ]

        total_revenue = sum(r.amount_paid for r in rows)
        by_source: Counter[str] = Counter(r.source for r in rows)
        by_court: dict[str, float] = defaultdict(float)
        for r in rows:
            by_court[r.court] += r.amount_paid
        num_days = (end_date - start_date).days + 1

        return LedgerOut(
            bookings=rows,
            summary=LedgerSummaryOut(
                total_revenue=round(total_revenue, 2),
                total_bookings=len(rows),
                avg_revenue_per_day=round(total_revenue / num_days, 2) if num_days else 0.0,
                by_source=dict(by_source),
                by_court={k: round(v, 2) for k, v in by_court.items()},
            ),
        )

    async def ledger_csv(
        self, owner: User, start_date: date, end_date: date, venue_id: uuid.UUID | None = None
    ) -> str:
        ledger = await self.ledger(owner, start_date, end_date, venue_id)
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["date", "court", "player", "source", "amount_paid", "balance_due", "status"])
        for row in ledger.bookings:
            writer.writerow(
                [
                    row.date.isoformat(),
                    row.court,
                    row.player or "",
                    row.source,
                    row.amount_paid,
                    row.balance_due,
                    row.status,
                ]
            )
        return buf.getvalue()

    async def growth_suggestions(self, owner: User, venue_id: uuid.UUID | None = None) -> GrowthOut:
        """Reads the nightly-materialized `slot_stats` table (Section 14's
        `growth_job.compute_slot_stats`, which already enforces the
        >=6-weeks / >=20-observations guardrail before a row is ever
        written) rather than recomputing live -- this endpoint only has to
        pick the latest snapshot per bucket, average it, and flag anything
        meaningfully below that average. If the nightly job hasn't run yet
        for a given court, that court simply has no rows and contributes no
        suggestions -- there's no separate "not enough data" branch to
        maintain here, the guardrail already lives in one place."""
        if venue_id is not None:
            venue = await self.db.get(Venue, venue_id)
            if venue is None or venue.owner_id != owner.id:
                raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_VENUE_OWNER, "Not your venue")
            if venue.plan_tier not in GROWTH_TIERS:
                raise AppError(
                    status.HTTP_403_FORBIDDEN,
                    ErrorCode.FORBIDDEN,
                    "Growth insights require a Pro plan or higher",
                )
            venues = [venue]
        else:
            result = await self.db.execute(
                select(Venue).where(Venue.owner_id == owner.id, Venue.plan_tier.in_(GROWTH_TIERS))
            )
            venues = list(result.scalars().all())

        today = pkt_today()
        suggestions: list[GrowthSuggestionOut] = []

        for venue in venues:
            courts_result = await self.db.execute(
                select(Court.id).where(Court.venue_id == venue.id, Court.is_active.is_(True))
            )
            court_ids = [row[0] for row in courts_result.all()]
            if not court_ids:
                continue

            for court_id in court_ids:
                latest_computed_at = await self.db.scalar(
                    select(func.max(SlotStats.computed_at)).where(SlotStats.court_id == court_id)
                )
                if latest_computed_at is None:
                    continue

                rows_result = await self.db.execute(
                    select(SlotStats).where(
                        SlotStats.court_id == court_id, SlotStats.computed_at == latest_computed_at
                    )
                )
                rows = list(rows_result.scalars().all())
                if not rows:
                    continue

                venue_average = sum(float(r.booking_rate) for r in rows) / len(rows)
                for row in rows:
                    rate = float(row.booking_rate)
                    if rate >= self.settings.GROWTH_UNDERBOOKED_RATE_THRESHOLD:
                        continue
                    suggestions.append(
                        GrowthSuggestionOut(
                            court_id=court_id,
                            day_of_week=row.day_of_week,
                            hour=row.hour,
                            booking_rate=round(rate, 4),
                            venue_average=round(venue_average, 4),
                            suggestion=(
                                f"This slot books {rate:.0%} of the time vs your {venue_average:.0%} "
                                "average. Try a 20% discount?"
                            ),
                            weeks_of_data=row.weeks_of_data,
                        )
                    )

        return GrowthOut(underbooked_slots=suggestions, computed_at=today)
