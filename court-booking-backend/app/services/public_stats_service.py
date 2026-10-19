"""Public marketing-site counts (GET /public/stats), cached in-process for 5 minutes."""
import time
from collections.abc import Callable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.user import User, UserRole
from app.models.venue import Venue, VenueStatus
from app.schemas.public import PublicStatsOut

CACHE_TTL_SECONDS = 300

# Module-level cache: (expires_at, value). Per worker process; a few minutes of staleness is the contract.
_cache: tuple[float, PublicStatsOut] | None = None
_clock: Callable[[], float] = time.monotonic


def set_clock(clock: Callable[[], float]) -> None:
    """Tests only: swap the time source so the TTL can be driven without sleeping."""
    global _clock
    _clock = clock


def clear() -> None:
    """Drop the cached value and restore the real clock (tests call this between cases)."""
    global _cache, _clock
    _cache = None
    _clock = time.monotonic


class PublicStatsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_stats(self) -> PublicStatsOut:
        global _cache
        now = _clock()
        if _cache is not None and now < _cache[0]:
            return _cache[1]
        stats = await self._compute()
        _cache = (now + CACHE_TTL_SECONDS, stats)
        return stats

    async def _compute(self) -> PublicStatsOut:
        # "Live" venue = approved AND active: what a player can actually open (same rule as GET /venues).
        live = (Venue.status == VenueStatus.APPROVED) & Venue.is_active.is_(True)
        venues = await self.db.scalar(select(func.count()).select_from(Venue).where(live))
        courts = await self.db.scalar(
            select(func.count())
            .select_from(Court)
            .join(Venue, Venue.id == Court.venue_id)
            .where(live, Court.is_active.is_(True))
        )
        # Round 2 Stage 2 (spec C.1): every booking that was confirmed counts -- booked, completed AND no_show (the old
        # automatic no-show made played matches vanish from this number) -- on live venues only. Cancelled, expired,
        # held and awaiting-approval bookings never count.
        bookings = await self.db.scalar(
            select(func.count())
            .select_from(Booking)
            .join(Court, Court.id == Booking.court_id)
            .join(Venue, Venue.id == Court.venue_id)
            .where(
                live,
                Booking.status.in_([BookingStatus.BOOKED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW]),
            )
        )
        players = await self.db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == UserRole.PLAYER, User.phone_verified_at.is_not(None))
        )
        return PublicStatsOut(venues=venues or 0, courts=courts or 0, bookings=bookings or 0, players=players or 0)
