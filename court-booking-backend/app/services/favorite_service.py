import uuid

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.court import Court
from app.models.favorite import FavoriteVenue
from app.models.user import User
from app.models.venue import Venue, VenueStatus
from app.services.venue_service import VenueService

MAX_LISTED = 100


class FavoriteService:
    """A player's saved venues. Private to the user; only venues a player could actually open (approved and active) can
    be saved or listed."""

    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    async def add(self, user: User, venue_id: uuid.UUID) -> None:
        """Save a venue. Idempotent: saving one that is already saved changes nothing (ON CONFLICT DO NOTHING), so two taps
        or two devices can never fail or duplicate."""
        venue = await self.db.get(Venue, venue_id)
        if venue is None or venue.status != VenueStatus.APPROVED or not venue.is_active:
            raise AppError(404, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
        await self.db.execute(pg_insert(FavoriteVenue).values(user_id=user.id, venue_id=venue_id).on_conflict_do_nothing())
        await self.db.commit()

    async def remove(self, user: User, venue_id: uuid.UUID) -> None:
        """Un-save a venue. Idempotent, and works for a venue that has since gone offline (so a stale heart can always be cleared)."""
        await self.db.execute(delete(FavoriteVenue).where(FavoriteVenue.user_id == user.id, FavoriteVenue.venue_id == venue_id))
        await self.db.commit()

    async def list_for(self, user: User):
        """The user's saved venues as search cards, most recently saved first. A venue that is no longer approved/active is
        left out (its row stays, so it comes back if the venue does)."""
        venues = (
            (
                await self.db.execute(
                    select(Venue)
                    .join(FavoriteVenue, FavoriteVenue.venue_id == Venue.id)
                    .where(FavoriteVenue.user_id == user.id, Venue.status == VenueStatus.APPROVED, Venue.is_active.is_(True))
                    .options(selectinload(Venue.courts).selectinload(Court.pricing_rules))
                    .order_by(FavoriteVenue.created_at.desc(), Venue.name)
                    .limit(MAX_LISTED)
                )
            )
            .scalars()
            .all()
        )
        venue_service = VenueService(self.db, self.settings)
        return [await venue_service.to_list_item(v) for v in venues]
