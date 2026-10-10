"""Daily owner-billing job: update who is active / past due / lapsed, issue invoices that are due, send reminders.
A no-op while `owner_billing_enforced` is off. Run daily from cron (see infra/scripts/court-booking.cron) or by hand with
`python -m app.jobs.runner billing`; every step is safe to repeat.
"""

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.services.owner_billing_service import OwnerBillingService


async def run_billing_job(session_factory=None) -> dict:
    factory = session_factory or AsyncSessionLocal
    async with factory() as db:
        service = OwnerBillingService(db, get_settings())
        # in this order: write down who has slipped into grace / lapsed, bill what is due, THEN remind (so a reminder that
        # says "pay your invoice" always has an invoice behind it)
        statuses = await service.refresh_statuses()
        invoices = await service.generate_all()
        reminders = await service.send_reminders()
        return {**invoices, "statuses_changed": statuses["changed"], "reminders_sent": reminders["sent"]}
