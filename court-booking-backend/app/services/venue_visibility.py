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


# ---- audit 2026-10-28 Phase 2 item 2: flag `cnic_visibility_gate` (default OFF) also hides a venue whose OWNER's CNIC is not
# approved. The owner can still set everything up; players see nothing (search, venue page, availability, AI chat, map,
# saved venues, holds). Only the `public_*` helpers below consult the flag, so every surface changes together.

GATE_FLAG = "cnic_visibility_gate"


async def cnic_gate_on(db: AsyncSession) -> bool:
    from app.services.feature_flag_service import flag_on

    return await flag_on(db, GATE_FLAG)


def _approved_owner_ids():
    from sqlalchemy import select

    from app.models.owner_identity import OwnerIdentity

    return select(OwnerIdentity.user_id).where(OwnerIdentity.cnic_status == "approved")


async def public_filters(db: AsyncSession) -> list:
    """SQL conditions for "players may see this venue" (use in every player-facing venue query)."""
    conds = [Venue.status == VenueStatus.APPROVED, Venue.is_active.is_(True)]
    if await cnic_gate_on(db):
        conds.append(Venue.owner_id.in_(_approved_owner_ids()))
    return conds


async def owner_cnic_approved(db: AsyncSession, owner_id) -> bool:
    from sqlalchemy import select

    from app.models.owner_identity import OwnerIdentity

    status_value = await db.scalar(select(OwnerIdentity.cnic_status).where(OwnerIdentity.user_id == owner_id))
    return status_value == "approved"


async def is_public_for_players(db: AsyncSession, venue: Venue) -> bool:
    if not is_public(venue):
        return False
    if await cnic_gate_on(db):
        return await owner_cnic_approved(db, venue.owner_id)
    return True


async def hidden_reason(db: AsyncSession, venue: Venue) -> str | None:
    """For the owner's banner: why players cannot see this venue right now (None = they can)."""
    if venue.status != VenueStatus.APPROVED:
        return "not_approved"
    if not venue.is_active:
        return "inactive"
    if await cnic_gate_on(db) and not await owner_cnic_approved(db, venue.owner_id):
        return "cnic"
    return None


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
    return await is_public_for_players(db, venue) or await is_insider(db, venue, viewer)


async def require_viewable(db: AsyncSession, venue: Venue | None, viewer: User | None) -> Venue:
    if venue is None or not await can_view(db, venue, viewer):
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.VENUE_NOT_FOUND, "Venue not found")
    return venue
