import csv
import io
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from fastapi import status
from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.payment_entry import PaymentEntry
from app.models.stats import SlotStats
from app.models.user import User
from app.models.venue import Venue
from app.services.entitlement_service import EntitlementService, premium_required_error
from app.services.availability_service import AvailabilityService
from app.services.feature_flag_service import flag_on
from app.services.overview_slots import operating_day_expr, starts_between_prefilter
from app.services.payment_service import PaymentService, build_payment_checks
from app.utils.timezone import pkt_date_of, pkt_time_to_utc, pkt_today
from app.schemas.owner_dashboard import (
    GrowthOut,
    GrowthSuggestionOut,
    LedgerEntryOut,
    LedgerOut,
    LedgerSummaryOut,
    PendingApprovalOut,
    TodayCourtOut,
    TodayOut,
    TodaySlotOut,
    TodaySummaryOut,
)
from app.schemas.admin import OwnerRefundOut  # Section 32 Part 10: "Refunds to pay" owner screen

# Booked/completed slots whose balance still counts as money owed.
OUTSTANDING_STATUSES = (BookingStatus.BOOKED, BookingStatus.COMPLETED)

REVENUE_STATUSES = (BookingStatus.BOOKED, BookingStatus.COMPLETED)


class OwnerDashboardService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.availability = AvailabilityService(db)

    async def _owner_courts(
        self, owner: User, venue_id: uuid.UUID | None = None, include_inactive: bool = False
    ) -> list[Court]:
        # `include_inactive` is for the historical financial views (the ledger): a
        # court that was deactivated still collected real money, so its payments
        # must stay in the ledger and remain selectable by the per-court filter --
        # otherwise picking that court showed zero while "All courts" also silently
        # dropped its money (post-batch backlog #2). Live views (Today, pending
        # approvals) keep the active-only default.
        query = select(Court).join(Venue, Venue.id == Court.venue_id).where(Venue.owner_id == owner.id)
        if not include_inactive:
            query = query.where(Court.is_active.is_(True))
        if venue_id is not None:
            venue = await self.db.get(Venue, venue_id)
            if venue is None or venue.owner_id != owner.id:
                raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_VENUE_OWNER, "Not your venue")
            query = query.where(Court.venue_id == venue_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _account_names(self, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
        """Registered account names by user id (one query), for owner screens that show the account behind a booking
        as a fallback / secondary label. The booking's own `player_name` is what the customer was booked under and
        always wins where both exist."""
        if not user_ids:
            return {}
        result = await self.db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))
        return {uid: name for uid, name in result.all() if name}

    @staticmethod
    def _merge_booking_rows(rows: list[TodaySlotOut]) -> list[TodaySlotOut]:
        """One display row per booking: the grid is 30 minutes, so a 1-hour booking arrives as two cells carrying the
        same booking_id. Back-to-back cells of one booking collapse into a single row spanning the whole booking
        ("6:00 PM - 7:00 PM"). Display only -- the bookings themselves are untouched, and free/closed cells never merge."""
        merged: list[TodaySlotOut] = []
        for row in rows:
            prev = merged[-1] if merged else None
            if (
                prev is not None
                and row.booking_id is not None
                and prev.booking_id == row.booking_id
                and prev.ends_at == row.starts_at
            ):
                merged[-1] = prev.model_copy(update={"ends_at": row.ends_at})
            else:
                merged.append(row)
        return merged

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
        account_names = await self._account_names({b.player_id for b in bookings_today if b.player_id is not None})

        # `get_day_slots` only considers LIVE_BOOKING_STATUSES (Section 32 Part 9 finding), so once a booking is
        # checked in or marked no-show its grid cell reverts to "available" -- correct for booking purposes (that
        # court-time really is free again), but it made the checked-in/no-show record vanish from Today entirely,
        # defeating "record who and when". Overlay completed/no-show bookings from `bookings_today` (which is NOT
        # status-filtered) back onto whichever "available" cell they actually cover, the same overlap test
        # `build_day_slots` itself uses for a live booking.
        settled_by_court: dict[uuid.UUID, list[Booking]] = defaultdict(list)
        for b in bookings_today:
            if b.status in (BookingStatus.COMPLETED, BookingStatus.NO_SHOW):
                settled_by_court[b.court_id].append(b)

        court_outs = []
        for court in courts:
            slots = slots_by_court[court.id]
            settled = settled_by_court.get(court.id, [])
            slot_outs = []
            for slot in slots:
                booking = bookings_by_id.get(slot.booking_id) if slot.booking_id else None
                if booking is None and slot.status == "available" and settled:
                    booking = next(
                        (b for b in settled if b.starts_at < slot.ends_at and b.ends_at > slot.starts_at), None
                    )
                slot_status = booking.status.value if booking is not None else slot.status
                slot_outs.append(
                    TodaySlotOut(
                        starts_at=slot.starts_at,
                        ends_at=slot.ends_at,
                        status=slot_status,
                        booking_id=booking.id if booking is not None else slot.booking_id,
                        # The name the booking was made under first (walk-in / booked for a friend), then the account.
                        player_name=(booking.player_name or account_names.get(booking.player_id)) if booking else None,
                        amount_paid=float(booking.amount_paid) if booking else None,
                        price=float(booking.price) if booking else None,
                        balance_due=float(booking.balance_due) if booking else None,
                        checked_in_at=booking.checked_in_at if booking else None,
                        checked_in_by=booking.checked_in_by if booking else None,
                        court_id=court.id if booking is not None else None,
                        court_name=court.name if booking is not None else None,
                        court_sport=court.sport if booking is not None else None,
                        booking_source=booking.source.value if booking else None,
                        booked_at=booking.created_at if booking else None,
                        account_name=account_names.get(booking.player_id) if booking and booking.player_id else None,
                        player_phone=booking.player_phone if booking else None,
                    )
                )
            court_outs.append(
                TodayCourtOut(court_id=court.id, name=court.name, sport=court.sport, slots=self._merge_booking_rows(slot_outs))
            )

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

    @staticmethod
    def _overview_filters(
        on_date: date | None, court_ids: list[uuid.UUID] | None, booking_id: uuid.UUID | None
    ) -> list:
        """The optional Owner Overview filters shared by pending approvals and refunds: the booking's OPERATING DAY (same
        SQL rule as the Overview cards, so a card count and the page behind it match), the selected courts, one booking."""
        conds: list = []
        if on_date is not None:
            lo, hi = starts_between_prefilter(on_date, on_date)
            conds += [Booking.starts_at >= lo, Booking.starts_at < hi, operating_day_expr() == on_date]
        if court_ids:
            conds.append(Booking.court_id.in_(court_ids))
        if booking_id is not None:
            conds.append(Booking.id == booking_id)
        return conds

    async def pending_approvals(
        self,
        owner: User,
        venue_id: uuid.UUID | None = None,
        on_date: date | None = None,
        court_ids: list[uuid.UUID] | None = None,
        booking_id: uuid.UUID | None = None,
    ) -> list[PendingApprovalOut]:
        courts = await self._owner_courts(owner, venue_id)
        court_ids_all = [c.id for c in courts]
        court_ids_filter = court_ids
        court_ids = court_ids_all
        if not court_ids:
            return []
        court_names = {c.id: c.name for c in courts}
        court_sports = {c.id: c.sport for c in courts}

        result = await self.db.execute(
            select(Payment, Booking)
            .join(Booking, Booking.id == Payment.booking_id)
            .where(
                Booking.court_id.in_(court_ids),
                Payment.review_verdict.is_(None),
                *self._overview_filters(on_date, court_ids_filter, booking_id),
            )
            .order_by(Payment.created_at.asc())
        )
        rows = result.all()

        # Section 32 Part 7: batch-resolve each booking's real account name
        # (not booking.player_name, which is only ever set for walk-ins) so
        # build_payment_checks can render "App account: X" without an N+1
        # query per approval card.
        player_ids = {booking.player_id for _, booking in rows if booking.player_id is not None}
        account_names: dict[uuid.UUID, str] = {}
        if player_ids:
            users_result = await self.db.execute(select(User.id, User.name).where(User.id.in_(player_ids)))
            account_names = {uid: name for uid, name in users_result.all() if name}

        court_venues: dict[uuid.UUID, Venue] = {}
        venue_ids = {c.venue_id for c in courts}
        if venue_ids:
            venues_result = await self.db.execute(select(Venue).where(Venue.id.in_(venue_ids)))
            venues_by_id = {v.id: v for v in venues_result.scalars().all()}
            court_venues = {c.id: venues_by_id[c.venue_id] for c in courts if c.venue_id in venues_by_id}

        now = datetime.now(timezone.utc)
        out = []
        for payment, booking in rows:
            account_name = account_names.get(booking.player_id) or booking.player_name
            out.append(
                PendingApprovalOut(
                    payment_id=payment.id,
                    booking_id=booking.id,
                    court_name=court_names.get(booking.court_id, ""),
                    court_id=booking.court_id,
                    court_sport=court_sports.get(booking.court_id),
                    account_name=account_names.get(booking.player_id),
                    starts_at=booking.starts_at,
                    ends_at=booking.ends_at,
                    # The name the booking was made under first; the account name only if it has none.
                    player_name=booking.player_name or account_names.get(booking.player_id),
                    player_phone=booking.player_phone,
                    ocr_verdict=payment.ocr_verdict,
                    ocr_amount=float(payment.ocr_amount) if payment.ocr_amount is not None else None,
                    expected_amount=float(booking.advance_amount),
                    proof_url=PaymentService.proof_url(payment),
                    submitted_at=payment.created_at,
                    minutes_since_submission=round((now - payment.created_at).total_seconds() / 60, 1),
                    checks=build_payment_checks(payment, booking, account_name),
                )
            )
        return out

    async def refunds_owed(
        self,
        owner: User,
        venue_id: uuid.UUID | None = None,
        on_date: date | None = None,
        court_ids: list[uuid.UUID] | None = None,
        booking_id: uuid.UUID | None = None,
    ) -> list[OwnerRefundOut]:
        """Section 32 Part 10's owner-facing "Refunds to pay" screen -- the
        owner's own venue(s) only, filtered to `refund_status == "owed"`.
        Deliberately does NOT go through `_owner_courts` (which filters to
        `is_active` courts): a refund already owed on a booking shouldn't
        disappear from this list just because the court was later
        deactivated -- the money is still owed regardless."""
        query = select(Court).join(Venue, Venue.id == Court.venue_id).where(Venue.owner_id == owner.id)
        if venue_id is not None:
            venue = await self.db.get(Venue, venue_id)
            if venue is None or venue.owner_id != owner.id:
                raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
            query = query.where(Court.venue_id == venue_id)
        courts = (await self.db.execute(query)).scalars().all()
        all_court_ids = [c.id for c in courts]
        if not all_court_ids:
            return []
        court_names = {c.id: c.name for c in courts}
        court_sports = {c.id: c.sport for c in courts}

        result = await self.db.execute(
            select(PaymentDispute, Booking, Venue, User)
            .join(Booking, Booking.id == PaymentDispute.booking_id)
            .join(Court, Court.id == Booking.court_id)
            .join(Venue, Venue.id == Court.venue_id)
            .outerjoin(User, User.id == PaymentDispute.player_id)
            .where(
                Court.id.in_(all_court_ids),
                PaymentDispute.refund_status == "owed",
                *self._overview_filters(on_date, court_ids, booking_id),
            )
            .order_by(PaymentDispute.created_at.asc())
        )
        now = datetime.now(timezone.utc)
        overdue_cutoff = timedelta(days=self.settings.REFUND_OVERDUE_DAYS)
        out = []
        for dispute, booking, venue, player in result.all():
            out.append(
                OwnerRefundOut(
                    id=dispute.id,
                    booking_id=booking.id,
                    court_name=court_names.get(booking.court_id, ""),
                    court_id=booking.court_id,
                    court_sport=court_sports.get(booking.court_id),
                    venue_name=venue.name,
                    # The name the booking was made under first (a friend's / a walk-in's), then the account's.
                    player_name=booking.player_name or (player.name if player else None),
                    player_phone=player.phone if player else booking.player_phone,
                    starts_at=booking.starts_at,
                    reason=dispute.reason,
                    refund_amount=float(dispute.refund_amount or 0),
                    refund_status=dispute.refund_status,
                    refunded_amount=float(dispute.refunded_amount) if dispute.refunded_amount is not None else None,
                    remaining_amount=round(max(float(dispute.refund_amount or 0) - float(dispute.refunded_amount or 0), 0.0), 2),
                    refund_reference=dispute.refund_reference,
                    refunded_at=dispute.refunded_at,
                    created_at=dispute.created_at,
                    is_overdue=(dispute.refund_amount or 0) > (dispute.refunded_amount or 0)
                    and now - dispute.created_at >= overdue_cutoff,
                )
            )
        return out

    async def _sum_entries(self, court_ids: list[uuid.UUID], start_date: date, end_date: date) -> int:
        """Net PKR recorded (positive entries minus any reversals) for these courts, in a Pakistan-calendar
        date range -- the building block for the "collected today/this week/this month" headline numbers,
        which are always "now"-relative and unaffected by whatever filter the entry list below uses."""
        range_start = pkt_time_to_utc(start_date, time.min)
        range_end = pkt_time_to_utc(end_date, time.min) + timedelta(days=1)
        total = await self.db.scalar(
            select(func.coalesce(func.sum(PaymentEntry.amount_pkr), 0))
            .join(Booking, Booking.id == PaymentEntry.booking_id)
            .where(
                Booking.court_id.in_(court_ids),
                PaymentEntry.created_at >= range_start,
                PaymentEntry.created_at < range_end,
            )
        )
        return int(total or 0)

    async def ledger(
        self,
        owner: User,
        start_date: date,
        end_date: date,
        venue_id: uuid.UUID | None = None,
        court_id: uuid.UUID | None = None,
        method: str | None = None,
        booking_status: str | None = None,
    ) -> LedgerOut:
        if end_date < start_date:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "end_date must be >= start_date")
        # Ledger is a historical money record: include deactivated courts so their
        # past payments still show and the per-court filter works for them (#2).
        courts = await self._owner_courts(owner, venue_id, include_inactive=True)
        if court_id is not None:
            courts = [c for c in courts if c.id == court_id]
        court_ids = [c.id for c in courts]
        court_names = {c.id: c.name for c in courts}
        court_sports = {c.id: c.sport for c in courts}

        today = pkt_today()
        empty_summary = LedgerSummaryOut(
            collected_today=0,
            collected_this_week=0,
            collected_this_month=0,
            outstanding_balance=0.0,
            cancelled_refund_pending=0.0,
            total_in_range=0,
            by_court={},
            by_day={},
        )
        if not court_ids:
            return LedgerOut(entries=[], summary=empty_summary)

        # Pakistan days: the range the owner picked is in THEIR calendar, so the boundaries are PKT midnights.
        range_start = pkt_time_to_utc(start_date, time.min)
        range_end = pkt_time_to_utc(end_date, time.min) + timedelta(days=1)
        query = (
            select(PaymentEntry, Booking)
            .join(Booking, Booking.id == PaymentEntry.booking_id)
            .where(
                Booking.court_id.in_(court_ids),
                PaymentEntry.created_at >= range_start,
                PaymentEntry.created_at < range_end,
            )
        )
        if method is not None:
            query = query.where(PaymentEntry.method == method)
        if booking_status is not None:
            query = query.where(Booking.status == booking_status)
        result = await self.db.execute(query.order_by(PaymentEntry.created_at.asc()))
        rows = result.all()

        ledger_accounts = await self._account_names({b.player_id for _, b in rows if b.player_id is not None})
        entries: list[LedgerEntryOut] = []
        running = 0
        by_court: dict[str, int] = defaultdict(int)
        by_day: dict[str, int] = defaultdict(int)
        for entry, booking in rows:
            running += entry.amount_pkr
            # Recognisable refund rows (no new enum value): a negative entry that is not a reversal of an
            # earlier entry is money paid back out -- a refund.
            # A "Booking completed" adjustment that lowers the total paid is a correction, not money paid back out.
            if entry.reverses_entry_id is not None or (entry.note or "").startswith("Booking completed"):
                entry_type, entry_label = "correction", "Correction"
            elif entry.amount_pkr < 0:
                entry_type, entry_label = "refund", "Refund"
            else:
                entry_type, entry_label = "payment", "Payment"
            court_name = court_names.get(booking.court_id, "")
            by_court[court_name] += entry.amount_pkr
            by_day[pkt_date_of(entry.created_at).isoformat()] += entry.amount_pkr
            entries.append(
                LedgerEntryOut(
                    entry_id=entry.id,
                    recorded_at=entry.created_at,
                    court=court_name,
                    court_id=booking.court_id,
                    court_sport=court_sports.get(booking.court_id),
                    booking_id=booking.id,
                    starts_at=booking.starts_at,
                    player=booking.player_name or ledger_accounts.get(booking.player_id),
                    method=entry.method.value,
                    entry_type=entry_type,
                    label=entry_label,
                    note=entry.note,
                    amount_pkr=entry.amount_pkr,
                    running_total=running,
                    booking_status=booking.status.value,
                )
            )

        collected_today = await self._sum_entries(court_ids, today, today)
        week_start = today - timedelta(days=today.weekday())  # Monday-first week
        collected_week = await self._sum_entries(court_ids, week_start, today)
        month_start = today.replace(day=1)
        collected_month = await self._sum_entries(court_ids, month_start, today)

        outstanding = await self.db.scalar(
            select(func.coalesce(func.sum(Booking.balance_due), 0)).where(
                Booking.court_id.in_(court_ids),
                Booking.status.in_(OUTSTANDING_STATUSES),
                Booking.balance_due > 0,
            )
        )
        refund_pending = await self.db.scalar(
            # Remaining refund still owed (refund_amount minus whatever partial refunds were already paid),
            # not the booking's amount_paid.
            select(
                func.coalesce(
                    func.sum(
                        func.greatest(
                            func.coalesce(PaymentDispute.refund_amount, 0) - func.coalesce(PaymentDispute.refunded_amount, 0),
                            0,
                        )
                    ),
                    0,
                )
            )
            .join(Booking, Booking.id == PaymentDispute.booking_id)
            .where(Booking.court_id.in_(court_ids), PaymentDispute.resolved.is_(False))
        )

        return LedgerOut(
            entries=entries,
            summary=LedgerSummaryOut(
                collected_today=collected_today,
                collected_this_week=collected_week,
                collected_this_month=collected_month,
                outstanding_balance=round(float(outstanding or 0), 2),
                cancelled_refund_pending=round(float(refund_pending or 0), 2),
                total_in_range=running,
                by_court=dict(by_court),
                by_day=dict(by_day),
            ),
        )

    async def ledger_csv(
        self,
        owner: User,
        start_date: date,
        end_date: date,
        venue_id: uuid.UUID | None = None,
        court_id: uuid.UUID | None = None,
        method: str | None = None,
        booking_status: str | None = None,
    ) -> str:
        ledger = await self.ledger(
            owner, start_date, end_date, venue_id=venue_id, court_id=court_id, method=method, booking_status=booking_status
        )
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            ["recorded_at", "court", "booking_starts_at", "player", "type", "method", "amount_pkr", "running_total", "booking_status", "note"]
        )
        for row in ledger.entries:
            writer.writerow(
                [
                    row.recorded_at.isoformat(),
                    row.court,
                    row.starts_at.isoformat(),
                    row.player or "",
                    row.label,
                    row.method,
                    row.amount_pkr,
                    row.running_total,
                    row.booking_status,
                    row.note or "",
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
        # Admin global kill switch (Section 32 Part 12): stop surfacing suggestions.
        # The screen already handles an empty list ("check back in a few weeks").
        if not await flag_on(self.db, "growth_suggestions"):
            return GrowthOut(underbooked_slots=[], computed_at=pkt_today())
        # Owner premium billing replaced the old plan_tier (Pro/Business) gate.
        entitled = await EntitlementService(self.db).owner_entitled(owner.id, "growth_suggestions")
        if venue_id is not None:
            venue = await self.db.get(Venue, venue_id)
            if venue is None or venue.owner_id != owner.id:
                raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_VENUE_OWNER, "Not your venue")
            if not entitled:
                raise premium_required_error("Growth suggestions")
            venues = [venue]
        elif not entitled:
            venues = []
        else:
            result = await self.db.execute(select(Venue).where(Venue.owner_id == owner.id))
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
