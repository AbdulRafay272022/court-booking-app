"""Who may see / book a venue (audit 2026-10-28 Phase 1 item 2).

ONE rule, used by the venue page (by id and by slug), every availability endpoint (day, venue, quote, month summary), the
AI chat's venue tools and the player hold:

- A venue is PUBLIC when it is approved AND active. Pending / changes-requested / rejected / soft-deleted venues are not.
- The venue's own owner, an admin, and active staff of that venue still see a non-public venue (the owner's status screen,
  walk-ins at a venue still under review, the admin queue).
- Anyone else gets 404 VENUE_NOT_FOUND, the same answer as for a venue that does not exist (no existence leak).

Phase 2 adds the owner-CNIC gate (flag `cnic_visibility_gate`) to `is_public` here, so every surface picks it up at once.
"""

from __future__ import annotations

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError, ErrorCode
from app.models.user import User, UserRole
from app.models.venue import Venue, VenueStatus


def is_public(venue: Venue) -> bool:
    return venue.status == VenueStatus.APPROVED and bool(venue.is_active)


async def is_insider(db: AsyncSession, venue: Venue, viewer: User | None) -> bool:
    """The owner, an admin, or active staff of this venue."""
    if viewer is None:
        return False
    if viewer.role == UserRole.ADMIN or viewer.id == venue.owner_id:
        return True
    if viewer.role == UserRole.STAFF:
        from app.services.staff_service import is_active_staff_of_venue

        return await is_active_staff_of_venue(db, viewer.id, venue.id)
    return False


async def can_view(db: AsyncSession, venue: Venue, viewer: User | None) -> bool:
    return is_public(venue) or await is_insider(db, venue, viewer)


async def require_viewable(db: AsyncSession, venue: Venue | None, viewer: User | None) -> Venue:
    if venue is None or not await can_view(db, venue, viewer):
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
    return venue
