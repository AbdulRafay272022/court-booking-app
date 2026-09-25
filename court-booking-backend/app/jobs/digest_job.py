import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.services.feature_flag_service import flag_on
from app.models.user import User, UserRole
from app.services.growth_service import GrowthService
from app.services.notification_service import NotificationService

logger = structlog.get_logger(__name__)


async def send_owner_daily_digests(session_factory: async_sessionmaker = AsyncSessionLocal) -> dict:
    """Send each venue owner a WhatsApp summary of today's bookings, revenue, and
    payments awaiting review. Intended to run once daily (e.g. 08:00 local time).

    Section 29 Part B: this used to call `whatsapp.send_text` directly (skipping the
    24h-window check every other notification goes through) with no per-owner error
    isolation -- since the digest is outbound-initiated, most owners won't have an
    open window on a given morning, so the first owner in iteration order whose send
    failed aborted the whole run, silently skipping everyone after them. Fixed by
    routing through NotificationService.notify_owner_daily_digest (send_smart, falls
    back to a template outside the window) and wrapping each owner's send in its own
    try/except so one failure can never block the rest."""
    settings = get_settings()
    sent = 0
    failed: list[str] = []

    async with session_factory() as db:
        # Admin global kill switch (Section 32 Part 12): skip the whole run when off.
        if not await flag_on(db, "digest_reminders"):
            return {"sent": 0, "failed": [], "skipped": "digest_reminders flag off"}
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
            try:
                await notifications.notify_owner_daily_digest(owner=owner, body="\n".join(lines))
                sent += 1
            except Exception:
                failed.append(str(owner.id))
                logger.warning("digest_job.owner_failed", owner_id=str(owner.id), exc_info=True)

    logger.info("digest_job.completed", owners_notified=sent, owners_failed=len(failed))
    return {"sent": sent, "failed": failed}
