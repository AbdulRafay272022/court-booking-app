"""Nightly Web Push subscription cleanup (docs/web-push-plan.md section 7), `python -m app.jobs.runner webpush-clean`.

Idempotent: deletes subscriptions revoked more than 30 days ago, and revokes subscriptions that were never confirmed
or delivered for 90 days (last_seen_at older than 90 days, or never seen and created more than 90 days ago).
"""

from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import and_, delete, or_, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.database import AsyncSessionLocal
from app.models.web_push_subscription import WebPushSubscription

logger = structlog.get_logger(__name__)

DELETE_REVOKED_AFTER = timedelta(days=30)
REVOKE_STALE_AFTER = timedelta(days=90)


async def clean_web_push_subscriptions(
    session_factory: async_sessionmaker = AsyncSessionLocal, now: datetime | None = None
) -> dict:
    now = now or datetime.now(timezone.utc)
    async with session_factory() as db:
        deleted = await db.execute(
            delete(WebPushSubscription).where(
                WebPushSubscription.revoked_at.is_not(None),
                WebPushSubscription.revoked_at < now - DELETE_REVOKED_AFTER,
            )
        )
        stale_cutoff = now - REVOKE_STALE_AFTER
        revoked = await db.execute(
            update(WebPushSubscription)
            .where(
                WebPushSubscription.revoked_at.is_(None),
                or_(
                    WebPushSubscription.last_seen_at < stale_cutoff,
                    and_(WebPushSubscription.last_seen_at.is_(None), WebPushSubscription.created_at < stale_cutoff),
                ),
            )
            .values(revoked_at=now)
        )
        await db.commit()
    result = {"deleted": deleted.rowcount or 0, "revoked": revoked.rowcount or 0}
    logger.info("web_push_cleanup.completed", **result)
    return result
