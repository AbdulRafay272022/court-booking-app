import uuid

from fastapi import APIRouter, status

from app.dependencies import AppSettings, CurrentUser, DbSession
from app.schemas.venue import VenueListItemOut
from app.services.favorite_service import FavoriteService

router = APIRouter(tags=["favorites"])


@router.get("/users/me/favorites", response_model=list[VenueListItemOut])
async def list_my_favorites(db: DbSession, settings: AppSettings, user: CurrentUser) -> list[VenueListItemOut]:
    """The signed-in player's saved venues as search cards, most recently saved first (at most 100)."""
    return await FavoriteService(db, settings).list_for(user)


@router.put("/venues/{venue_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def add_favorite(venue_id: uuid.UUID, db: DbSession, settings: AppSettings, user: CurrentUser) -> None:
    """Save a venue. Idempotent. 404 for a venue that does not exist or is not live (approved and active)."""
    await FavoriteService(db, settings).add(user, venue_id)


@router.delete("/venues/{venue_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def remove_favorite(venue_id: uuid.UUID, db: DbSession, settings: AppSettings, user: CurrentUser) -> None:
    """Un-save a venue. Idempotent: 204 whether or not it was saved."""
    await FavoriteService(db, settings).remove(user, venue_id)
