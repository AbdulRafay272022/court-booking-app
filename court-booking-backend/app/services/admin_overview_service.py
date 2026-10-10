"""Read-only platform overview for the super admin (GET /admin/overview). Nothing here writes, and nothing needs a
migration: every figure is a query over tables that already exist (venues, courts, users, sessions, bookings, payments,
messages, ai_usage_log, schedule_templates, slot_stats)."""

import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_usage import AIUsageLog
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.message import Message
from app.models.payment import Payment
from app.models.schedule import ScheduleTemplate
from app.models.stats import SlotStats
from app.models.user import Session, User, UserRole
from app.models.venue import Venue, VenueStatus
from app.schemas.admin_overview import (
    AdminOverviewOut,
    CourtActivityOut,
    PeriodFigures,
    UnderperformingCourtOut,
    UsageOut,
    UserCountsOut,
    WeakBucketOut,
)
from app.utils.timezone import pkt_time_to_utc, pkt_today, utc_to_pkt_naive

IDLE_DAYS = 14  # a live court with no booking made in this long reads as idle
WINDOW_DAYS = 28  # booking-rate window for "underperforming"
MIN_DAYS_MEASURED = 7  # a court younger than this has no meaningful rate yet
UNDERPERFORMING_LIMIT = 10

PLAYED = (BookingStatus.BOOKED, BookingStatus.COMPLETED)  # revenue statuses
COUNTED = (BookingStatus.BOOKED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW)  # court time that was really used
LIVE_NOT_CANCELLED = (
    BookingStatus.HELD,
    BookingStatus.PAYMENT_SUBMITTED,
    BookingStatus.BOOKED,
    BookingStatus.COMPLETED,
    BookingStatus.NO_SHOW,
)


def _day_start(d: date) -> datetime:
    return pkt_time_to_utc(d, time(0, 0))


def _template_hours(t: ScheduleTemplate) -> float:
    """Open hours of one schedule day (an overnight day runs past midnight; open == close with the flag is 24 h)."""
    opens = t.open_time.hour * 60 + t.open_time.minute
    closes = t.close_time.hour * 60 + t.close_time.minute
    minutes = closes - opens
    if getattr(t, "closes_next_day", False):
        minutes = minutes + 24 * 60 if minutes <= 0 else minutes
    return max(minutes, 0) / 60


class AdminOverviewService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def overview(self) -> AdminOverviewOut:
        now = datetime.now(timezone.utc)
        today = pkt_today(now)
        courts = await self._courts(now, today)
        return AdminOverviewOut(
            generated_at=now,
            idle_days=IDLE_DAYS,
            window_days=WINDOW_DAYS,
            courts=courts,
            users=await self._users(now),
            usage=await self._usage(now, today),
            underperforming=await self._underperforming(today),
            notes=[
                "Days are Pakistan days. 'Last 7 days' and 'last 30 days' include today.",
                "Bookings are counted by the date they are played on, cancelled ones excluded; "
                "'last booking' is when the most recent one was made.",
                "GMV is the full price of booked and completed bookings; collected is what was paid on them.",
                "Booking rate = booked court time / open court time over the last "
                f"{WINDOW_DAYS} days; blackouts are not subtracted from open time.",
                "Active users = a login session or a WhatsApp message in the last 30 days; someone who only "
                "ever uses a browser tab without a session cannot be seen.",
            ],
        )

    # ---- all venues / courts ---------------------------------------------------------------------------------------

    async def _courts(self, now: datetime, today: date) -> list[CourtActivityOut]:
        rows = (
            await self.db.execute(
                select(Court, Venue, User)
                .join(Venue, Venue.id == Court.venue_id)
                .join(User, User.id == Venue.owner_id)
                .where(Court.is_active.is_(True))
                .order_by(Venue.name, Court.name)
            )
        ).all()
        if not rows:
            return []
        today_start, tomorrow_start = _day_start(today), _day_start(today + timedelta(days=1))
        week_start = _day_start(today - timedelta(days=6))
        stats = {
            court_id: (in_today, in_week, last_made)
            for court_id, in_today, in_week, last_made in (
                await self.db.execute(
                    select(
                        Booking.court_id,
                        func.count(Booking.id).filter(and_(Booking.starts_at >= today_start, Booking.starts_at < tomorrow_start)),
                        func.count(Booking.id).filter(and_(Booking.starts_at >= week_start, Booking.starts_at < tomorrow_start)),
                        func.max(Booking.created_at),
                    )
                    .where(Booking.status.in_(LIVE_NOT_CANCELLED))
                    .group_by(Booking.court_id)
                )
            ).all()
        }
        out: list[CourtActivityOut] = []
        for court, venue, owner in rows:
            in_today, in_week, last_made = stats.get(court.id, (0, 0, None))
            if venue.status != VenueStatus.APPROVED:
                state = "not_live"  # pending / rejected / changes requested: not open to players yet
            elif not venue.is_active or not owner.is_active:
                state = "suspended"  # approved, but the venue is switched off or its owner's account is suspended
            else:
                state = "active"
            days_since = (now - last_made).days if last_made else None
            out.append(
                CourtActivityOut(
                    venue_id=venue.id,
                    venue_name=venue.name,
                    venue_status=venue.status.value,
                    court_id=court.id,
                    court_name=court.name,
                    sport=court.sport,
                    owner_id=owner.id,
                    owner_name=owner.name,
                    owner_phone=owner.phone,
                    state=state,
                    bookings_today=int(in_today or 0),
                    bookings_7_days=int(in_week or 0),
                    last_booking_at=last_made,
                    idle=state == "active" and (days_since is None or days_since >= IDLE_DAYS),
                    days_since_last_booking=days_since,
                )
            )
        return out

    # ---- user counts ------------------------------------------------------------------------------------------------

    async def _users(self, now: datetime) -> UserCountsOut:
        week, month = now - timedelta(days=7), now - timedelta(days=30)

        async def count(*conds) -> int:
            return int(await self.db.scalar(select(func.count(User.id)).where(*conds)) or 0)

        players, owners = UserRole.PLAYER, UserRole.OWNER
        used_session = select(Session.user_id).where(Session.last_active_at >= month)
        chatted = select(Message.sender_id).where(
            Message.sender_type == "player", Message.created_at >= month, Message.sender_id.is_not(None)
        )
        return UserCountsOut(
            total_players=await count(User.role == players),
            total_owners=await count(User.role == owners),
            total_staff=await count(User.role == UserRole.STAFF),
            total_admins=await count(User.role == UserRole.ADMIN),
            new_players_7_days=await count(User.role == players, User.created_at >= week),
            new_players_30_days=await count(User.role == players, User.created_at >= month),
            new_owners_7_days=await count(User.role == owners, User.created_at >= week),
            new_owners_30_days=await count(User.role == owners, User.created_at >= month),
            active_30_days=await count(User.role.in_((players, owners)), or_(User.id.in_(used_session), User.id.in_(chatted))),
            active_30_days_of_total=await count(User.role.in_((players, owners))),
        )

    # ---- platform usage ---------------------------------------------------------------------------------------------

    async def _usage(self, now: datetime, today: date) -> UsageOut:
        windows = {
            "today": (_day_start(today), _day_start(today + timedelta(days=1))),
            "last_7_days": (_day_start(today - timedelta(days=6)), _day_start(today + timedelta(days=1))),
            "last_30_days": (_day_start(today - timedelta(days=29)), _day_start(today + timedelta(days=1))),
        }

        async def per_window(fn) -> PeriodFigures:
            return PeriodFigures(**{name: int(await fn(lo, hi) or 0) for name, (lo, hi) in windows.items()})

        async def bookings(lo, hi):
            return await self.db.scalar(
                select(func.count(Booking.id)).where(
                    Booking.starts_at >= lo, Booking.starts_at < hi, Booking.status.in_(LIVE_NOT_CANCELLED)
                )
            )

        async def gmv(lo, hi):
            return await self.db.scalar(
                select(func.coalesce(func.sum(Booking.price), 0)).where(
                    Booking.starts_at >= lo, Booking.starts_at < hi, Booking.status.in_(PLAYED)
                )
            )

        async def collected(lo, hi):
            return await self.db.scalar(
                select(func.coalesce(func.sum(Booking.amount_paid), 0)).where(
                    Booking.starts_at >= lo, Booking.starts_at < hi, Booking.status.in_(PLAYED)
                )
            )

        def chat(channel: str):
            async def run(lo, hi):
                return await self.db.scalar(
                    select(func.count(Message.id)).where(
                        Message.channel == channel,
                        Message.sender_type == "player",
                        Message.message_type == "text",
                        Message.created_at >= lo,
                        Message.created_at < hi,
                    )
                )

            return run

        month_ago = now - timedelta(days=30)
        calls, tokens = (
            await self.db.execute(
                select(
                    func.count(AIUsageLog.id),
                    func.coalesce(func.sum(AIUsageLog.input_tokens + AIUsageLog.output_tokens), 0),
                ).where(AIUsageLog.created_at >= month_ago)
            )
        ).one()

        async def payments(*conds) -> int:
            return int(await self.db.scalar(select(func.count(Payment.id)).where(Payment.created_at >= month_ago, *conds)) or 0)

        approved = await payments(Payment.review_verdict == "approved")
        rejected = await payments(Payment.review_verdict == "rejected")
        pending = await payments(Payment.review_verdict.is_(None))
        decided = approved + rejected
        return UsageOut(
            bookings=await per_window(bookings),
            gmv_pkr=await per_window(gmv),
            collected_pkr=await per_window(collected),
            chat_messages_app=await per_window(chat("app")),
            chat_messages_whatsapp=await per_window(chat("whatsapp")),
            ai_model_calls_30_days=int(calls or 0),
            ai_tokens_30_days=int(tokens or 0),
            payments_approved_30_days=approved,
            payments_rejected_30_days=rejected,
            payments_pending_30_days=pending,
            payments_auto_approved_30_days=await payments(Payment.auto_approved.is_(True)),
            payment_approval_rate=round(approved / decided, 4) if decided else None,
        )

    # ---- underperforming courts ----------------------------------------------------------------------------------------

    async def _underperforming(self, today: date) -> list[UnderperformingCourtOut]:
        window_start, window_end = today - timedelta(days=WINDOW_DAYS), today  # complete days only: yesterday is the last
        rows = (
            await self.db.execute(
                select(Court, Venue, User)
                .join(Venue, Venue.id == Court.venue_id)
                .join(User, User.id == Venue.owner_id)
                .where(Court.is_active.is_(True), Venue.status == VenueStatus.APPROVED, Venue.is_active.is_(True))
            )
        ).all()
        if not rows:
            return []
        court_ids = [c.id for c, _v, _o in rows]
        templates: dict[uuid.UUID, dict[int, float]] = defaultdict(dict)
        for t in (
            await self.db.execute(
                select(ScheduleTemplate).where(ScheduleTemplate.court_id.in_(court_ids), ScheduleTemplate.is_active.is_(True))
            )
        ).scalars():
            templates[t.court_id][t.day_of_week] = _template_hours(t)
        booked_hours = {
            court_id: float(minutes or 0) / 3600
            for court_id, minutes in (
                await self.db.execute(
                    select(Booking.court_id, func.sum(func.extract("epoch", Booking.ends_at - Booking.starts_at)))
                    .where(
                        Booking.court_id.in_(court_ids),
                        Booking.starts_at >= _day_start(window_start),
                        Booking.starts_at < _day_start(window_end),
                        Booking.status.in_(COUNTED),
                    )
                    .group_by(Booking.court_id)
                )
            ).all()
        }
        latest_stats = (
            select(SlotStats.court_id, func.max(SlotStats.computed_at).label("d")).group_by(SlotStats.court_id).subquery()
        )
        weak: dict[uuid.UUID, list[WeakBucketOut]] = defaultdict(list)
        for s in (
            await self.db.execute(
                select(SlotStats)
                .join(latest_stats, and_(SlotStats.court_id == latest_stats.c.court_id, SlotStats.computed_at == latest_stats.c.d))
                .where(SlotStats.court_id.in_(court_ids))
                .order_by(SlotStats.court_id, SlotStats.booking_rate.asc())
            )
        ).scalars():
            if len(weak[s.court_id]) < 3:
                weak[s.court_id].append(WeakBucketOut(day_of_week=s.day_of_week, hour=s.hour, booking_rate=float(s.booking_rate)))

        out: list[UnderperformingCourtOut] = []
        for court, venue, owner in rows:
            first_day = max(window_start, utc_to_pkt_naive(court.created_at).date()) if court.created_at else window_start
            days = (window_end - first_day).days
            if days < MIN_DAYS_MEASURED or not templates.get(court.id):
                continue
            open_hours = sum(templates[court.id].get((first_day + timedelta(days=i)).weekday(), 0.0) for i in range(days))
            if open_hours <= 0:
                continue
            hours = booked_hours.get(court.id, 0.0)
            out.append(
                UnderperformingCourtOut(
                    venue_id=venue.id,
                    venue_name=venue.name,
                    court_id=court.id,
                    court_name=court.name,
                    sport=court.sport,
                    owner_name=owner.name,
                    booking_rate=round(min(hours / open_hours, 1.0), 4),
                    booked_hours=round(hours, 1),
                    open_hours=round(open_hours, 1),
                    days_measured=days,
                    weakest_slots=weak.get(court.id, []),
                )
            )
        out.sort(key=lambda c: (c.booking_rate, c.venue_name, c.court_name))
        return out[:UNDERPERFORMING_LIMIT]
