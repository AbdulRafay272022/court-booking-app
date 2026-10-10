"""Daily owner-billing job: issue invoices that are due. A no-op while `owner_billing_enforced` is off.

Not scheduled yet (the cron entry on the server is step 4); run by hand with `python -m app.jobs.runner billing`.
"""

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.services.owner_billing_service import OwnerBillingService


async def run_billing_job(session_factory=None) -> dict:
    factory = session_factory or AsyncSessionLocal
    async with factory() as db:
        return await OwnerBillingService(db, get_settings()).generate_all()
