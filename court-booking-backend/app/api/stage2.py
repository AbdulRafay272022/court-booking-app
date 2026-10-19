"""Round 2 Stage 2 owner/admin endpoints (docs/stage2-contract.md section 3): venue timers, my permissions, CNIC."""

import uuid
from typing import Literal

from fastapi import APIRouter, File, Form, Query, UploadFile, status
from sqlalchemy import select

from app.dependencies import AppSettings, DbSession, RequireAdmin, RequireOwner, RequireStaffCapable
from app.errors import AppError, ErrorCode
from app.models.staff import StaffMember, StaffPermissionKey
from app.models.user import UserRole
from app.models.venue import Venue
from app.schemas.stage2 import (
    AdminIdentityFullOut,
    AdminIdentityPageOut,
    MyPermissionsOut,
    OwnerIdentityOut,
    VenuePermissionsOut,
    VenueTimersOut,
    VenueTimerValuesIn,
)
from app.services.audit_service import AuditService
from app.services.owner_identity_service import OwnerIdentityService, owner_view
from app.services.venue_service import VenueService
from app.services.venue_timers import TIMER_KEYS, reapply_payment_deadlines, stored_values, timers_view, validate_values

owner_router = APIRouter(prefix="/owners", tags=["owners"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])

ALL_PERMISSIONS = [p.value for p in StaffPermissionKey]


# -- venue timers -----------------------------------------------------------------------------------------------


@owner_router.get("/venues/{venue_id}/timers", response_model=VenueTimersOut)
async def get_venue_timers(venue_id: uuid.UUID, db: DbSession, settings: AppSettings, user: RequireStaffCapable) -> dict:
    """Owner, admin, or staff with `edit_court_settings` (there is no `edit_venue_settings` key); staff of the venue
    with only `view_ledger` may READ them too."""
    service = VenueService(db, settings)
    try:
        venue = await service.require_owned_venue(venue_id, user, permission="edit_court_settings")
    except AppError as exc:
        if exc.code != ErrorCode.NOT_STAFF_PERMITTED:
            raise
        venue = await service.require_owned_venue(venue_id, user, permission="view_ledger")
    return timers_view(venue)


@owner_router.put("/venues/{venue_id}/timers", response_model=VenueTimersOut)
async def put_venue_timers(
    venue_id: uuid.UUID, payload: VenueTimerValuesIn, db: DbSession, settings: AppSettings, user: RequireStaffCapable
) -> dict:
    """Body = all seven values; null resets that field to the default. 422 TIMER_OUT_OF_RANGE with the failing
    fields. Changing auto-cancel re-times screenshots already waiting (from their own submission time)."""
    venue = await VenueService(db, settings).require_owned_venue(venue_id, user, permission="edit_court_settings")
    values = payload.model_dump()
    errors = validate_values(values)
    if errors:
        raise AppError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            ErrorCode.TIMER_OUT_OF_RANGE,
            "A timer value is out of range.",
            details={"field": errors[0]["field"], "errors": errors},
        )
    before = stored_values(venue)
    for key in TIMER_KEYS:
        setattr(venue, key, values.get(key))
    await db.flush()
    retimed = await reapply_payment_deadlines(db, venue)
    await AuditService(db).log(
        actor_user_id=user.id,
        actor_type=user.role.value,
        action="venue.timers_updated",
        entity_type="venue",
        entity_id=venue.id,
        old_value=before,
        new_value={**stored_values(venue), "retimed_pending_payments": retimed},
    )
    await db.commit()
    await db.refresh(venue)
    return timers_view(venue)


# -- my permissions -------------------------------------------------------------------------------------------------


@owner_router.get("/me/permissions", response_model=MyPermissionsOut)
async def my_permissions(db: DbSession, user: RequireStaffCapable) -> MyPermissionsOut:
    """What this account may do, per venue, so the UI hides buttons up front. Owners: every key on each venue they
    own. Admin: every key on every venue. Staff: the granted keys on each venue where their staff row is active."""
    if user.role == UserRole.STAFF:
        rows = (
            await db.execute(
                select(StaffMember).where(StaffMember.staff_user_id == user.id, StaffMember.is_active.is_(True))
            )
        ).scalars().all()
        items = [
            VenuePermissionsOut(
                venue_id=sm.venue_id, permissions=sorted({p.permission for p in sm.permissions if p.permission in ALL_PERMISSIONS})
            )
            for sm in rows
        ]
        return MyPermissionsOut(role="staff", venue_permissions=items)
    query = select(Venue.id)
    if user.role != UserRole.ADMIN:
        query = query.where(Venue.owner_id == user.id)
    venue_ids = (await db.execute(query.order_by(Venue.created_at))).scalars().all()
    return MyPermissionsOut(
        role="admin" if user.role == UserRole.ADMIN else "owner",
        venue_permissions=[VenuePermissionsOut(venue_id=v, permissions=list(ALL_PERMISSIONS)) for v in venue_ids],
    )


# -- CNIC ----------------------------------------------------------------------------------------------------------


@owner_router.get("/identity", response_model=OwnerIdentityOut)
async def get_my_identity(db: DbSession, settings: AppSettings, user: RequireOwner) -> dict:
    return owner_view(await OwnerIdentityService(db, settings).get_for_user(user.id))


@owner_router.post("/identity", response_model=OwnerIdentityOut)
async def submit_my_identity(
    db: DbSession,
    settings: AppSettings,
    user: RequireOwner,
    number: str = Form(...),
    front: UploadFile = File(...),
    back: UploadFile = File(...),
) -> dict:
    """Multipart `number`, `front`, `back`. Replacing is allowed (the admin verification resets)."""
    row = await OwnerIdentityService(db, settings).submit(user, number, front, back)
    return owner_view(row)


@admin_router.get("/owner-identities", response_model=AdminIdentityPageOut)
async def admin_owner_identities(
    db: DbSession,
    settings: AppSettings,
    admin: RequireAdmin,
    filter: Literal["missing", "duplicates", "unverified", "all"] = "all",
    page: int = Query(1, ge=1),
) -> dict:
    """Masked only (never the number)."""
    return await OwnerIdentityService(db, settings).admin_list(filter, page)


@admin_router.get("/owner-identities/{user_id}", response_model=AdminIdentityFullOut)
async def admin_owner_identity(user_id: uuid.UUID, db: DbSession, settings: AppSettings, admin: RequireAdmin) -> dict:
    """The full number + 5-minute signed photo URLs; every call writes audit_log `owner_identity.viewed`."""
    return await OwnerIdentityService(db, settings).admin_full(admin, user_id)


@admin_router.post("/owner-identities/{user_id}/verify", response_model=AdminIdentityFullOut)
async def admin_verify_owner_identity(
    user_id: uuid.UUID, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> dict:
    return await OwnerIdentityService(db, settings).verify(admin, user_id)
