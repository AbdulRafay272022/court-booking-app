from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Request, Response, status
from sqlalchemy import text

from app.dependencies import AppSettings, DbSession
from app.utils.s3 import bucket_reachable

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check(request: Request, db: DbSession, settings: AppSettings) -> dict:
    try:
        await db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception:
        db_status = "disconnected"

    started_at = getattr(request.app.state, "started_at", None)
    uptime_seconds = (
        int((datetime.now(timezone.utc) - started_at).total_seconds()) if started_at else 0
    )

    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "database": db_status,
        "version": settings.APP_VERSION,
        "uptime_seconds": uptime_seconds,
    }


async def _check_db(db: DbSession) -> str:
    try:
        await db.execute(text("SELECT 1"))
        return "ok"
    except Exception:
        return "unreachable"


async def _check_s3(settings) -> str:
    if not settings.AWS_ACCESS_KEY_ID:
        return "not_configured"
    return "ok" if await bucket_reachable(settings.S3_BUCKET_PRIVATE) else "unreachable"


async def _check_whatsapp(settings) -> str:
    if not settings.WHATSAPP_API_TOKEN:
        return "not_configured"
    try:
        import httpx

        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{settings.WHATSAPP_API_URL}/{settings.WHATSAPP_PHONE_NUMBER_ID}",
                headers={"Authorization": f"Bearer {settings.WHATSAPP_API_TOKEN}"},
            )
        return "ok" if resp.status_code < 500 else "unreachable"
    except Exception:
        return "unreachable"


@router.get("/health/ready")
async def readiness_check(db: DbSession, settings: AppSettings, response: Response) -> dict:
    checks = {
        "database": await _check_db(db),
        "s3": await _check_s3(settings),
        "whatsapp": await _check_whatsapp(settings),
    }
    # A dependency that's simply not configured for this environment doesn't
    # fail readiness -- only an actively unreachable one does.
    ready = all(v != "unreachable" for v in checks.values())
    response.status_code = status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ready" if ready else "not_ready", "checks": checks}
