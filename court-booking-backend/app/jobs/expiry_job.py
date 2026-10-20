import math
from datetime import date, datetime, time, timedelta, timezone

import structlog
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.payment import Payment
from app.models.schedule import ScheduleTemplate
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.services.booking_service import BookingService
from app.services.notification_service import NotificationService
from app.services.reminder_schedule import reminder_schedule, shift_to_open_hours
from app.services.venue_timers import effective_timers, submitted_at_of
from app.utils.timezone import naive_pkt_to_utc, utc_to_pkt_naive
from app.services.waitlist_service import WaitlistService

logger = structlog.get_logger(__name__)


async def expire_stale_bookings(session_factory: async_sessionmaker = AsyncSessionLocal) -> int:
    """Cancel HELD bookings whose hold window has passed and PAYMENT_SUBMITTED
    bookings the owner never actioned, notify the affected parties, and wake
    up anyone on the waitlist for that slot. Intended to run every 1-2 minutes."""
    settings = get_settings()
    async with session_factory() as db:
        booking_service = BookingService(db, settings)
        notifications = NotificationService(db, settings)
        waitlist_service = WaitlistService(db, settings)

        expired = await booking_service.expire_stale_bookings()
        for booking in expired:
            court = await db.get(Court, booking.court_id)
            player = await db.get(User, booking.player_id) if booking.player_id else None
            if court and player:
                await notifications.notify_booking_cancelled(
                    user=player, court_name=court.name, starts_at=booking.starts_at, ends_at=booking.ends_at,
                    reference_id=booking.id,
                )
            # A payment-review timeout means the owner sat on it -- flag them too. Round 2 Stage 2: when a screenshot
            # was on file the owner gets the auto-cancel notice instead ("paisa aaya hai to wapas dena hai"; the
            # expired card in Approvals queues the refund through the existing payment_disputes path).
            if court and booking.cancellation_reason == "payment_review_expired":
                venue = await db.get(Venue, court.venue_id)
                owner = await db.get(User, venue.owner_id) if venue else None
                if owner:
                    proof = await db.scalar(
                        select(Payment)
                        .where(
                            Payment.booking_id == booking.id,
                            Payment.review_verdict.is_(None),
                            Payment.proof_key.is_not(None),
                        )
                        .order_by(Payment.created_at.desc())
                        .limit(1)
                    )
                    if proof is not None:
                        amount = proof.ocr_amount if proof.ocr_amount is not None else proof.amount_claimed
                        await notifications.notify_owner_payment_auto_cancelled(
                            owner=owner, court_name=court.name, booking_id=booking.id,
                            starts_at=booking.starts_at, ends_at=booking.ends_at,
                            amount=float(amount) if amount is not None else None,
                        )
                    else:
                        await notifications.notify_booking_cancelled(
                            user=owner, court_name=court.name, starts_at=booking.starts_at, ends_at=booking.ends_at,
                            reference_id=booking.id,
                        )
            if court:
                await waitlist_service.notify_matching_entries(court, booking.starts_at, booking.ends_at)

        logger.info("expiry_job.completed", expired_count=len(expired))
        return len(expired)


HOLD_REMINDER_FRACTION = 2 / 3


async def remind_expiring_holds(session_factory: async_sessionmaker = AsyncSessionLocal) -> int:
    """Owner Round 2 (B1): ONE push reminder to a player whose unpaid hold has used 2/3 of its time (5 minutes left
    of the default 15). Nothing reminded players before the hold expired until now. Deduped per booking through
    notification_log (`hold_expiring`), so a repeated or late run never sends twice; a hold that already ran out is
    not reminded (the expiry step releases it)."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    sent = 0
    async with session_factory() as db:
        notifications = NotificationService(db, settings)
        result = await db.execute(
            select(Booking).where(
                Booking.status == BookingStatus.HELD,
                Booking.held_until.is_not(None),
                Booking.held_until > now,
                Booking.player_id.is_not(None),
            )
        )
        for booking in result.scalars().all():
            remind_at = booking.created_at + (booking.held_until - booking.created_at) * HOLD_REMINDER_FRACTION
            if now < remind_at:
                continue
            player = await db.get(User, booking.player_id)
            court = await db.get(Court, booking.court_id)
            if player is None or court is None:
                continue
            minutes_left = max(1, math.ceil((booking.held_until - now).total_seconds() / 60))
            if await notifications.notify_hold_expiring(
                user=player, court_name=court.name, booking_id=booking.id, minutes_left=minutes_left,
                amount=float(booking.advance_amount),
            ):
                sent += 1
    logger.info("hold_reminder_job.completed", sent=sent)
    return sent


async def _venue_hours(db, venue_id, local_date: date) -> tuple[time | None, time | None]:
    """The venue's operating window on `local_date` (Pakistan wall clock) for night-time shifting: the earliest
    opening and the latest closing across its active courts' schedule for that weekday (a court open past midnight
    makes the window overnight). (None, None) = no schedule = no shifting."""
    rows = (
        await db.execute(
            select(ScheduleTemplate.open_time, ScheduleTemplate.close_time, ScheduleTemplate.closes_next_day)
            .join(Court, Court.id == ScheduleTemplate.court_id)
            .where(
                Court.venue_id == venue_id,
                Court.is_active.is_(True),
                ScheduleTemplate.is_active.is_(True),
                ScheduleTemplate.day_of_week == local_date.weekday(),
            )
        )
    ).all()
    if not rows:
        return None, None
    opens = min(r[0] for r in rows)
    overnight = [r[1] for r in rows if r[2]]
    closes = max(overnight) if overnight else max(r[1] for r in rows)
    return opens, closes


async def _shifted(db, venue_id, due: datetime, cache: dict) -> datetime:
    """`due` (UTC) moved into the venue's opening hours (reminder_schedule.shift_to_open_hours), back in UTC."""
    local = utc_to_pkt_naive(due)
    key = (venue_id, local.date())
    if key not in cache:
        cache[key] = await _venue_hours(db, venue_id, local.date())
    open_t, close_t = cache[key]
    return naive_pkt_to_utc(shift_to_open_hours(local, open_t, close_t))


async def remind_pending_payment_reviews(session_factory: async_sessionmaker = AsyncSessionLocal) -> int:
    """Round 2 Stage 2: owner reminders for screenshots still waiting for approval, timed by each venue's timers
    (app/services/venue_timers.py -> reminder_schedule): reminder n at its minute after the submission, then ONE
    final warning before the auto-cancel. Only during the venue's opening hours (a reminder due at night goes out
    when it opens). Replaces the old WhatsApp-after-5 / SMS-after-15 ladder. Stops by itself when the owner acts or
    the player cancels (only payment_submitted bookings are looked at). Deduped per booking through notification_log
    (`payment_reminder_<n>`, `payment_final_warning`): when several are due at once (a late run, or the morning after
    a night) only the latest one goes out, and nothing earlier than an already-sent step is ever sent. Submission
    time = the pending payment's created_at (fallback: payment_deadline minus the auto-cancel minutes). Returns how
    many messages went out."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    sent = 0
    hours_cache: dict = {}
    async with session_factory() as db:
        notifications = NotificationService(db, settings)
        bookings = (
            await db.execute(select(Booking).where(Booking.status == BookingStatus.PAYMENT_SUBMITTED))
        ).scalars().all()
        for booking in bookings:
            court = await db.get(Court, booking.court_id)
            venue = await db.get(Venue, court.venue_id) if court else None
            owner = await db.get(User, venue.owner_id) if venue else None
            if owner is None:
                continue
            eff = effective_timers(venue)
            submitted_at = await submitted_at_of(db, booking)
            if submitted_at is None:
                if booking.payment_deadline is None:
                    continue
                submitted_at = booking.payment_deadline - timedelta(minutes=eff["auto_cancel_after_min"])
            cancel_min = eff["auto_cancel_after_min"] if eff["auto_cancel_enabled"] else None
            reminders, final_at, _cancel_at = reminder_schedule(
                eff["first_reminder_after_min"],
                eff["repeat_every_min"],
                eff["max_reminders"] if eff["reminders_enabled"] else 0,
                cancel_min,
            )
            steps: list[tuple[str, int | None]] = [(f"payment_reminder_{n}", n) for n in range(1, len(reminders) + 1)]
            minutes = list(reminders)
            if final_at is not None:
                steps.append(("payment_final_warning", None))
                minutes.append(final_at)
            due_index = -1
            for i, minute in enumerate(minutes):
                at = await _shifted(db, venue.id, submitted_at + timedelta(minutes=minute), hours_cache)
                if at <= now:
                    due_index = i
            if due_index < 0:
                continue
            already = False
            for ev, _n in steps[due_index:]:
                if await notifications.has_sent(owner.id, ev, booking.id):
                    already = True
                    break
            if already:
                continue
            event_type, n = steps[due_index]
            minutes_waiting = int((now - submitted_at).total_seconds() // 60)
            minutes_to_cancel = None
            if booking.payment_deadline is not None:
                minutes_to_cancel = max(0, math.ceil((booking.payment_deadline - now).total_seconds() / 60))
            player = await db.get(User, booking.player_id) if booking.player_id else None
            try:
                if await notifications.notify_owner_payment_reminder(
                    owner=owner,
                    event_type=event_type,
                    court_name=court.name,
                    venue_name=venue.name,
                    amount=float(booking.advance_amount),
                    booking_id=booking.id,
                    starts_at=booking.starts_at,
                    ends_at=booking.ends_at,
                    player_name=booking.player_name or (player.name if player and player.name else ""),
                    minutes_waiting=minutes_waiting,
                    minutes_to_cancel=minutes_to_cancel,
                    reminder_no=n,
                ):
                    sent += 1
            except Exception:  # noqa: BLE001 -- one owner's send problem never stops the job
                logger.warning("payment_reminder_job.send_failed", booking_id=str(booking.id), exc_info=True)
                await db.rollback()

    logger.info("payment_reminder_job.completed", sent=sent)
    return sent


async def cleanup_waitlist(session_factory: async_sessionmaker = AsyncSessionLocal) -> int:
    """Deactivate waitlist entries whose slot time has passed, and give up on
    anyone who was notified a slot reopened but didn't act within
    WAITLIST_RENOTIFY_GRACE_MINUTES, advancing to the next person in line."""
    settings = get_settings()
    async with session_factory() as db:
        waitlist_service = WaitlistService(db, settings)
        advanced = await waitlist_service.advance_stale_notifications()
        deactivated = await waitlist_service.deactivate_past_entries()
        logger.info("waitlist_cleanup.completed", advanced=advanced, deactivated=deactivated)
        return deactivated


async def purge_stale_unverified_signups(session_factory: async_sessionmaker = AsyncSessionLocal) -> int:
    """QA re-test A: delete abandoned pending signups -- rows that set a password but never verified
    their phone -- once they are older than PENDING_SIGNUP_RETENTION_MINUTES. This is what makes the
    "block a re-signup while an unverified row exists" rule self-healing: an abandoned squat on a
    number is cleared here so the number can be signed up for again, while a real pending signup is
    protected until it verifies. A never-verified row can never have a session, so it owns no venues
    or bookings -- deleting it is safe. Pre-Section-26 rows (password_hash NULL, or already verified)
    are excluded."""
    settings = get_settings()
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=settings.PENDING_SIGNUP_RETENTION_MINUTES)
    async with session_factory() as db:
        # Age is measured from when the signup was SUBMITTED (terms_accepted_at is stamped then),
        # not from created_at: a signup that adopted an older WhatsApp guest row keeps the guest's
        # original created_at, which would otherwise make it look stale the minute it's submitted.
        # Rows from before terms_accepted_at existed fall back to created_at.
        started = func.coalesce(User.terms_accepted_at, User.created_at)
        stale_ids = (
            await db.execute(
                select(User.id).where(
                    User.phone_verified_at.is_(None),
                    User.password_hash.is_not(None),
                    started < cutoff,
                )
            )
        ).scalars().all()

        deleted = reverted = 0
        for user_id in stale_ids:
            try:
                async with db.begin_nested():
                    await db.execute(delete(User).where(User.id == user_id))
                deleted += 1
            except IntegrityError:
                # The row has data that references it (typically WhatsApp chat messages, when the
                # signup adopted a WhatsApp guest). Deleting would lose that history, so strip the
                # abandoned signup details instead and leave it a plain WhatsApp guest again -- which
                # no longer blocks a new signup on this number.
                await db.execute(
                    update(User)
                    .where(User.id == user_id)
                    .values(
                        password_hash=None,
                        name=None,
                        email=None,
                        city=None,
                        gender=None,
                        role=UserRole.PLAYER,
                        terms_accepted_at=None,
                    )
                )
                reverted += 1
        await db.commit()
        logger.info("unverified_signup_purge.completed", purged=deleted, reverted_to_guest=reverted)
        return deleted + reverted


async def run_expiry_job(session_factory: async_sessionmaker = AsyncSessionLocal) -> dict:
    """The single cron entrypoint (EventBridge -> Lambda in production, or an
    in-process scheduler for development) run every ~60 seconds. Each step
    below is independently idempotent, so running this twice in a row -- or
    running it late after a gap -- never double-fires a notification or
    errors on an already-processed booking; see the individual functions'
    docstrings for how each one achieves that."""
    expired = await expire_stale_bookings(session_factory)
    hold_reminders = await remind_expiring_holds(session_factory)
    # Round 2 Stage 2 (spec C.2): no automatic booked -> no_show any more. Owners mark a finished booking themselves
    # (Haan/Nahi -> completed, or "Nahi aaye" -> no_show); until then it shows as "Status baqi".
    payment_reminders = await remind_pending_payment_reviews(session_factory)
    waitlist_deactivated = await cleanup_waitlist(session_factory)
    unverified_purged = await purge_stale_unverified_signups(session_factory)

    result = {
        "expired_bookings": expired,
        "hold_reminders_sent": hold_reminders,
        "payment_reminders_sent": payment_reminders,
        "waitlist_entries_deactivated": waitlist_deactivated,
        "unverified_signups_purged": unverified_purged,
    }
    logger.info("run_expiry_job.completed", **result)
    return result
