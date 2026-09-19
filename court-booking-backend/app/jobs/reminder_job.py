from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.user import User
from app.services.notification_service import NotificationService

logger = structlog.get_logger(__name__)

REMINDER_WINDOW_HOURS = 2


async def send_booking_reminders(session_factory: async_sessionmaker = AsyncSessionLocal) -> int:
    """Tier 1 (push-only) reminder ~2 hours before a confirmed booking.
    Re-queries every booking starting within the window on each run, but
    notify_booking_reminder is idempotent (checked against notification_log),
    so running this every few minutes is safe."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(hours=REMINDER_WINDOW_HOURS)
    sent = 0

    async with session_factory() as db:
        notifications = NotificationService(db, settings)
        result = await db.execute(
            select(Booking).where(
                Booking.status == BookingStatus.BOOKED,
                Booking.starts_at >= now,
                Booking.starts_at <= window_end,
                Booking.player_id.is_not(None),
            )
        )
        for booking in result.scalars().all():
            court = await db.get(Court, booking.court_id)
            player = await db.get(User, booking.player_id)
            if court is None or player is None:
                continue
            if await notifications.has_sent(player.id, "booking_reminder", booking.id):
                continue
            await notifications.notify_booking_reminder(
                user=player,
                court_name=court.name,
                starts_at=booking.starts_at.isoformat(),
                booking_id=booking.id,
            )
            sent += 1

    logger.info("reminder_job.completed", sent=sent)
    return sent
