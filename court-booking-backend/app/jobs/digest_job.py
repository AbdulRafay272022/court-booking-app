import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.services.growth_service import GrowthService
from app.services.notification_service import NotificationService

logger = structlog.get_logger(__name__)


async def send_owner_daily_digests(session_factory: async_sessionmaker = AsyncSessionLocal) -> int:
    """Send each venue owner a WhatsApp summary of today's bookings, revenue, and
    payments awaiting review. Intended to run once daily (e.g. 08:00 local time)."""
    settings = get_settings()
    sent = 0

    async with session_factory() as db:
        notifications = NotificationService(db, settings)
        growth_service = GrowthService(db)
        owners_result = await db.execute(select(User).where(User.role == UserRole.OWNER))
        owners = owners_result.scalars().all()

        for owner in owners:
            digests = await growth_service.owner_digest(owner.id)
            if not digests:
                continue
            lines = [f"Good morning {owner.name or ''}! Here's today's summary:".strip()]
            for d in digests:
                lines.append(
                    f"- {d.venue_name}: {d.bookings_today} bookings today "
                    f"(PKR {d.revenue_today:.0f}), {d.payments_awaiting_review} payments to verify, "
                    f"{d.upcoming_bookings_7_days} bookings in the next 7 days."
                )
            await notifications.whatsapp.send_text(owner.phone, "\n".join(lines))
            sent += 1

    logger.info("digest_job.completed", owners_notified=sent)
    return sent
