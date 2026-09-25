"""Owner-managed staff accounts (Section 32 Part 12, Layer 2).

Managing staff is OWNER-only (RequireOwner never admits STAFF), so a staff member
can't create or re-permission other staff. The staff members themselves act
through the normal owner endpoints, gated per-action by their permissions.
"""
import uuid

from fastapi import APIRouter, status

from app.dependencies import AppSettings, DbSession, FeatureFlags, RequireOwner
from app.models.staff import StaffMember, StaffPermissionKey
from app.models.user import User
from app.schemas.staff import (
    StaffActiveUpdateIn,
    StaffCreateIn,
    StaffMemberOut,
    StaffPermissionCatalogItem,
    StaffPermissionsUpdateIn,
)
from app.services.staff_service import PERMISSION_FLAG, StaffService
from app.services.venue_service import VenueService

router = APIRouter(prefix="/staff", tags=["staff"])

# Human labels for the permission catalog (order defines the UI order).
_PERMISSION_LABELS: list[tuple[str, str]] = [
    (StaffPermissionKey.APPROVE_PAYMENTS.value, "Approve / reject payments"),
    (StaffPermissionKey.RECORD_PAYMENTS.value, "Record & correct payments"),
    (StaffPermissionKey.CHECK_IN.value, "Check in players / mark no-show"),
    (StaffPermissionKey.WALKIN.value, "Add walk-in bookings"),
    (StaffPermissionKey.CANCEL_BOOKING.value, "Cancel bookings"),
    (StaffPermissionKey.EDIT_COURT_SETTINGS.value, "Edit court hours, prices & blackouts"),
    (StaffPermissionKey.MANAGE_PHOTOS.value, "Manage venue & court photos"),
    (StaffPermissionKey.RESPOND_REVIEWS.value, "Reply to reviews"),
    (StaffPermissionKey.MARK_REFUNDS.value, "Mark refunds as paid"),
    (StaffPermissionKey.VIEW_LEDGER.value, "View dashboard, bookings & ledger"),
    (StaffPermissionKey.VIEW_GROWTH.value, "View growth suggestions"),
]


def _to_out(sm: StaffMember) -> StaffMemberOut:
    return StaffMemberOut(
        id=sm.id,
        venue_id=sm.venue_id,
        venue_name=sm.venue.name if sm.venue else "",
        staff_user_id=sm.staff_user_id,
        name=sm.staff_user.name if sm.staff_user else None,
        phone=sm.staff_user.phone if sm.staff_user else "",
        is_active=sm.is_active,
        permissions=[p.permission for p in sm.permissions],
        created_at=sm.created_at,
    )


@router.get("/permissions", response_model=list[StaffPermissionCatalogItem])
async def permission_catalog(flags: FeatureFlags, owner: RequireOwner) -> list[StaffPermissionCatalogItem]:
    """Every grantable permission, with `available=False` for any whose feature is
    globally off (can't be granted, and the action is blocked for everyone)."""
    flag_map = await flags.as_map()
    items: list[StaffPermissionCatalogItem] = []
    for key, label in _PERMISSION_LABELS:
        required = PERMISSION_FLAG.get(key)
        items.append(
            StaffPermissionCatalogItem(
                key=key,
                label=label,
                flag_required=required,
                available=(required is None or flag_map.get(required, True)),  # fail-open
            )
        )
    return items


@router.get("", response_model=list[StaffMemberOut])
async def list_staff(db: DbSession, settings: AppSettings, owner: RequireOwner) -> list[StaffMemberOut]:
    members = await StaffService(db, settings).list_for_owner(owner)
    return [_to_out(sm) for sm in members]


@router.post("", response_model=StaffMemberOut, status_code=status.HTTP_201_CREATED)
async def create_staff(
    payload: StaffCreateIn,
    db: DbSession,
    settings: AppSettings,
    flags: FeatureFlags,
    owner: RequireOwner,
) -> StaffMemberOut:
    venue = await VenueService(db, settings).require_owned_venue(payload.venue_id, owner)
    flag_map = await flags.as_map()
    sm = await StaffService(db, settings).create(
        owner, venue, payload.name, payload.phone.strip(), payload.password, payload.permissions, flag_map
    )
    return _to_out(sm)


@router.get("/{staff_member_id}", response_model=StaffMemberOut)
async def get_staff(
    staff_member_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> StaffMemberOut:
    sm = await StaffService(db, settings).get_owned(staff_member_id, owner)
    return _to_out(sm)


@router.patch("/{staff_member_id}/permissions", response_model=StaffMemberOut)
async def update_staff_permissions(
    staff_member_id: uuid.UUID,
    payload: StaffPermissionsUpdateIn,
    db: DbSession,
    settings: AppSettings,
    flags: FeatureFlags,
    owner: RequireOwner,
) -> StaffMemberOut:
    service = StaffService(db, settings)
    sm = await service.get_owned(staff_member_id, owner)
    flag_map = await flags.as_map()
    sm = await service.set_permissions(sm, payload.permissions, flag_map)
    return _to_out(sm)


@router.patch("/{staff_member_id}/active", response_model=StaffMemberOut)
async def update_staff_active(
    staff_member_id: uuid.UUID,
    payload: StaffActiveUpdateIn,
    db: DbSession,
    settings: AppSettings,
    owner: RequireOwner,
) -> StaffMemberOut:
    """Deactivate (or reactivate) a staff member. Deactivating revokes their live
    sessions immediately (owner decision)."""
    service = StaffService(db, settings)
    sm = await service.get_owned(staff_member_id, owner)
    await service.set_active(sm, payload.is_active)
    sm = await service.get_owned(staff_member_id, owner)
    return _to_out(sm)
