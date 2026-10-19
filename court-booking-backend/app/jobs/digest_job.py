import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.services.feature_flag_service import flag_on
from app.models.booking import Booking
from app.models.court import Court
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.services.owner_overview_service import status_pending_cond
from app.services.growth_service import GrowthService
from app.services.entitlement_service import EntitlementService
from app.services.notification_service import NotificationService

logger = structlog.get_logger(__name__)


async def _status_pending_count(db, owner_id) -> int:
    """Bookings of this owner's venues (any date) still `booked` after their slot ended with no Haan/Nahi."""
    return int(
        await db.scalar(
            select(func.count(Booking.id))
            .join(Court, Court.id == Booking.court_id)
            .join(Venue, Venue.id == Court.venue_id)
            .where(Venue.owner_id == owner_id, status_pending_cond())
        )
        or 0
    )


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
        entitlements = EntitlementService(db, settings)
        growth_service = GrowthService(db)
        owners_result = await db.execute(select(User).where(User.role == UserRole.OWNER))
        owners = owners_result.scalars().all()

        for owner in owners:
            # Owner premium billing: no "Digest & reminders" for this owner => no digest (same as the global switch off).
            if not await entitlements.owner_entitled(owner.id, "digest_reminders"):
                continue
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
            # Round 2 Stage 2 (spec C.4): finished bookings the owner has not marked yet (Haan/Nahi or Nahi aaye).
            status_pending = await _status_pending_count(db, owner.id)
            if status_pending > 0:
                lines.append(f"{status_pending} bookings ka status baqi hai.")
            payload = {
                "count": sum(d.bookings_today for d in digests),
                "amount": float(sum(d.revenue_today for d in digests)),
                "status_pending": status_pending,
            }
            try:
                await notifications.notify_owner_daily_digest(owner=owner, body="\n".join(lines), payload=payload)
                sent += 1
            except Exception:
                failed.append(str(owner.id))
                logger.warning("digest_job.owner_failed", owner_id=str(owner.id), exc_info=True)

    logger.info("digest_job.completed", owners_notified=sent, owners_failed=len(failed))
    return {"sent": sent, "failed": failed}
