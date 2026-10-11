from fastapi import APIRouter, Response

from app.dependencies import DbSession
from app.schemas.public import PublicStatsOut
from app.services.public_stats_service import CACHE_TTL_SECONDS, PublicStatsService

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/stats", response_model=PublicStatsOut)
async def public_stats(db: DbSession, response: Response) -> PublicStatsOut:
    """Unauthenticated counts for the marketing site: live (approved and active) venues, their active courts,
    booked/completed bookings, and phone-verified players. Cached 5 minutes (server side and via Cache-Control)."""
    response.headers["Cache-Control"] = f"public, max-age={CACHE_TTL_SECONDS}"
    return await PublicStatsService(db).get_stats()
