from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.user import User
from app.models.venue import Venue
from app.services.booking_service import BookingService
from app.services.notification_service import NotificationService
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
                    user=player, court_name=court.name, starts_at=booking.starts_at.isoformat()
                )
            # A payment-review timeout means the owner sat on it -- flag them too.
            if court and booking.cancellation_reason == "payment_review_expired":
                venue = await db.get(Venue, court.venue_id)
                owner = await db.get(User, venue.owner_id) if venue else None
                if owner:
                    await notifications.notify_booking_cancelled(
                        user=owner, court_name=court.name, starts_at=booking.starts_at.isoformat()
                    )
            if court:
                await waitlist_service.notify_matching_entries(court, booking.starts_at)

        logger.info("expiry_job.completed", expired_count=len(expired))
        return len(expired)


async def mark_overdue_no_shows(session_factory: async_sessionmaker = AsyncSessionLocal) -> int:
    """BOOKED bookings that started NO_SHOW_GRACE_MINUTES ago with no check-in
    become no-shows, which dents the player's reliability score."""
    settings = get_settings()
    async with session_factory() as db:
        booking_service = BookingService(db, settings)
        overdue = await booking_service.mark_overdue_no_shows()
        logger.info("no_show_job.completed", count=len(overdue))
        return len(overdue)


async def escalate_pending_payment_reviews(session_factory: async_sessionmaker = AsyncSessionLocal) -> int:
    """For every booking still awaiting owner review, fire the next
    escalation step (WhatsApp at ESCALATION_WHATSAPP_MINUTES, SMS at
    ESCALATION_SMS_MINUTES) if it's due and hasn't already gone out.
    Submission time is derived from payment_deadline (set to submission +
    PAYMENT_REVIEW_HOURS) since there's no separate "submitted_at" column."""
    settings = get_settings()
    escalated = 0
    async with session_factory() as db:
        notifications = NotificationService(db, settings)
        result = await db.execute(
            select(Booking).where(
                Booking.status == BookingStatus.PAYMENT_SUBMITTED, Booking.payment_deadline.is_not(None)
            )
        )
        for booking in result.scalars().all():
            submitted_at = booking.payment_deadline - timedelta(hours=settings.PAYMENT_REVIEW_HOURS)
            minutes_elapsed = (datetime.now(timezone.utc) - submitted_at).total_seconds() / 60

            court = await db.get(Court, booking.court_id)
            if court is None:
                continue
            venue = await db.get(Venue, court.venue_id)
            owner = await db.get(User, venue.owner_id) if venue else None
            if owner is None:
                continue

            steps_fired = await notifications.escalate_payment_submitted(
                owner=owner,
                court_name=court.name,
                amount=float(booking.advance_amount),
                booking_id=booking.id,
                minutes_elapsed=minutes_elapsed,
            )
            escalated += len(steps_fired)

    logger.info("escalation_job.completed", escalated=escalated)
    return escalated


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


async def run_expiry_job(session_factory: async_sessionmaker = AsyncSessionLocal) -> dict:
    """The single cron entrypoint (EventBridge -> Lambda in production, or an
    in-process scheduler for development) run every ~60 seconds. Each step
    below is independently idempotent, so running this twice in a row -- or
    running it late after a gap -- never double-fires a notification or
    errors on an already-processed booking; see the individual functions'
    docstrings for how each one achieves that."""
    expired = await expire_stale_bookings(session_factory)
    no_shows = await mark_overdue_no_shows(session_factory)
    escalated = await escalate_pending_payment_reviews(session_factory)
    waitlist_deactivated = await cleanup_waitlist(session_factory)

    result = {
        "expired_bookings": expired,
        "no_shows": no_shows,
        "escalations_sent": escalated,
        "waitlist_entries_deactivated": waitlist_deactivated,
    }
    logger.info("run_expiry_job.completed", **result)
    return result
