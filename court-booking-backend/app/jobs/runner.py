"""Cron entrypoint for the background jobs.

    python -m app.jobs.runner {expiry|reminders|digest|growth}

Section 25 runs these from the EC2 host's cron (infra/scripts/court-booking.cron)
via `docker exec` into the backend container, instead of EventBridge->Lambda:
a VPC-attached Lambda has no internet without a ~$35/mo NAT Gateway, and the
expiry job sends WhatsApp notifications. This lives in `app/` (not
`scripts/`) because the Docker image only copies `app/`, `alembic/` and
`alembic.ini`.

Thin wrapper only -- every job is the existing service-layer function, and
each is independently idempotent (see CLAUDE.md), so a repeated or late cron
run is safe. `scripts/run_expiry_job.py` remains the manual-trigger tool
documented in RUNBOOK.md.
"""

import asyncio
import sys

import structlog

logger = structlog.get_logger(__name__)


async def _run(name: str):
    # Imported lazily so an unknown job name fails fast without importing
    # every job's dependency graph.
    if name == "expiry":
        from app.jobs.expiry_job import run_expiry_job

        return await run_expiry_job()
    if name == "reminders":
        from app.jobs.reminder_job import send_booking_reminders

        return await send_booking_reminders()
    if name == "digest":
        from app.jobs.digest_job import send_owner_daily_digests

        return await send_owner_daily_digests()
    if name == "growth":
        from app.jobs.growth_job import materialize_nightly_stats

        return await materialize_nightly_stats()
    raise SystemExit(f"unknown job {name!r}; expected one of: expiry, reminders, digest, growth")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m app.jobs.runner {expiry|reminders|digest|growth}")
    name = sys.argv[1]
    result = asyncio.run(_run(name))
    logger.info("jobs.runner.completed", job=name, result=result)
    print(f"{name}: {result}")


if __name__ == "__main__":
    main()
