"""audit 2026-10-28 Phase 3 item 4: unanswered "Sahi hai / Ghalat hai" past 24 h -> -20 points + a message (flag
short_payment_reply), and points used on a booking that was later cancelled come back. Every 10 minutes from cron
(infra/scripts/court-booking.cron) or `python -m app.jobs.runner short-payments`; safe to repeat."""

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.services.phase3_service import run_short_payment_job


async def run_short_payments(session_factory=None) -> dict:
    factory = session_factory or AsyncSessionLocal
    async with factory() as db:
        return await run_short_payment_job(db, get_settings())
