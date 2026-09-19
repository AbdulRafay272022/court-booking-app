"""Manually re-trigger the expiry/no-show/escalation/waitlist-cleanup job.

There is no cron wired up inside this app -- production expects
EventBridge -> Lambda (or an equivalent scheduler) to call
`app.jobs.expiry_job.run_expiry_job` on its own cadence (~every 60s). If
that scheduler misses a run (an incident, a deploy window, a scheduler
outage), this script re-runs the same job by hand. Every step inside
run_expiry_job is independently idempotent, so running this late or twice
in a row is always safe -- see RUNBOOK.md.

Usage (from court-booking-backend/):
    .venv/Scripts/python.exe -m scripts.run_expiry_job
"""

import asyncio

import structlog

from app.jobs.expiry_job import run_expiry_job

logger = structlog.get_logger(__name__)


async def main() -> None:
    result = await run_expiry_job()
    logger.info("scripts.run_expiry_job.manual_trigger_completed", **result)
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
