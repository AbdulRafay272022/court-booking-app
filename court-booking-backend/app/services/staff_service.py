"""Owner staff/manager accounts with per-feature permissions (Section 32 Part 12,
Layer 2).

A staff account is a `User` with role=STAFF plus one `StaffMember` row per venue
it works at (venue-level scope: it can act on every court in that venue, subject
to its granted permissions). Enforcement is at the service layer -- the two
ownership chokepoints (`VenueService.require_owned_venue` /
`BookingService.require_accessible_booking`) call `staff_can()` when the caller is
STAFF. Managing staff is owner-only and never itself a staff permission.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.staff import StaffMember, StaffPermission, StaffPermissionKey
from app.models.user import Session, User, UserRole
from app.models.venue import Venue
from app.utils.security import hash_password

VALID_PERMISSIONS: set[str] = {p.value for p in StaffPermissionKey}

# Permissions whose action fully disappears when a global feature flag is OFF.
# An owner can't grant one of these while its flag is off (the spec's "a staff
# member can never be granted something admin globally turned off"), and the
# action is blocked for everyone by require_feature regardless. Permissions NOT
# listed here stay available even when related flags are off (e.g. manual
# check-in survives QR being off; manual approve survives OCR/auto-approve off).
PERMISSION_FLAG: dict[str, str] = {
    StaffPermissionKey.RECORD_PAYMENTS.value: "split_payments",
    StaffPermissionKey.MARK_REFUNDS.value: "refunds",
    StaffPermissionKey.RESPOND_REVIEWS.value: "reviews",
    StaffPermissionKey.MANAGE_PHOTOS.value: "photos",
    StaffPermissionKey.VIEW_GROWTH.value: "growth_suggestions",
}


async def staff_can(db: AsyncSession, staff_user_id: uuid.UUID, venue_id: uuid.UUID, permission: str) -> bool:
    """True iff an ACTIVE staff_members row exists for (staff_user, venue) that
    holds `permission`. The single source of truth for staff authorization."""
    row = (
        await db.execute(
            select(StaffMember.id)
            .join(StaffPermission, StaffPermission.staff_member_id == StaffMember.id)
            .where(
                StaffMember.staff_user_id == staff_user_id,
                StaffMember.venue_id == venue_id,
                StaffMember.is_active.is_(True),
                StaffPermission.permission == permission,
            )
        )
    ).first()
    return row is not None


async def staffed_venue_ids(
    db: AsyncSession, staff_user_id: uuid.UUID, permission: str | None = None
) -> list[uuid.UUID]:
    """Active venues this staff user works at; if `permission` is given, only those
    where they hold it."""
    query = select(StaffMember.venue_id).where(
        StaffMember.staff_user_id == staff_user_id, StaffMember.is_active.is_(True)
    )
    if permission is not None:
        query = query.join(StaffPermission, StaffPermission.staff_member_id == StaffMember.id).where(
            StaffPermission.permission == permission
        )
    return list((await db.execute(query.distinct())).scalars().all())


async def resolve_owner_context(
    db: AsyncSession, actor: User, venue_id: uuid.UUID | None, permission: str
) -> tuple[User, uuid.UUID | None]:
    """Map the acting user to the (owner, venue_id) the owner-dashboard services
    expect. Owners/admins are returned unchanged. A STAFF user is resolved to the
    real owner they work for and pinned to a venue they staff with `permission`
    (so they only ever see that venue's data). Raises if they lack the permission
    or must disambiguate between several staffed venues."""
    if actor.role != UserRole.STAFF:
        return actor, venue_id

    staffed = await staffed_venue_ids(db, actor.id, permission)
    if not staffed:
        raise AppError(403, ErrorCode.NOT_STAFF_PERMITTED, "Your account isn't allowed to do this.")
    if venue_id is not None:
        if venue_id not in staffed:
            raise AppError(403, ErrorCode.NOT_STAFF_PERMITTED, "Your account isn't allowed to do this.")
        target = venue_id
    elif len(staffed) == 1:
        target = staffed[0]
    else:
        raise AppError(400, ErrorCode.VALIDATION_ERROR, "Please choose which venue.")
    venue = await db.get(Venue, target)
    owner = await db.get(User, venue.owner_id) if venue is not None else None
    if owner is None:
        raise AppError(403, ErrorCode.NOT_STAFF_PERMITTED, "Your account isn't allowed to do this.")
    return owner, target


async def is_active_staff_of_venue(db: AsyncSession, staff_user_id: uuid.UUID, venue_id: uuid.UUID) -> bool:
    row = (
        await db.execute(
            select(StaffMember.id).where(
                StaffMember.staff_user_id == staff_user_id,
                StaffMember.venue_id == venue_id,
                StaffMember.is_active.is_(True),
            )
        )
    ).first()
    return row is not None


class StaffService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    def _validate_permissions(self, permissions: list[str], flag_map: dict[str, bool] | None) -> list[str]:
        cleaned: list[str] = []
        for p in permissions:
            if p not in VALID_PERMISSIONS:
                raise AppError(400, ErrorCode.INVALID_STAFF_PERMISSION, f"Unknown permission: {p}")
            required_flag = PERMISSION_FLAG.get(p)
            # Fail-open: a missing flag row means ON (matches FeatureFlagService.is_on).
            if flag_map is not None and required_flag is not None and not flag_map.get(required_flag, True):
                raise AppError(
                    400,
                    ErrorCode.INVALID_STAFF_PERMISSION,
                    f"'{p}' can't be granted while its feature is turned off.",
                )
            if p not in cleaned:
                cleaned.append(p)
        return cleaned

    async def list_for_owner(self, owner: User) -> list[StaffMember]:
        result = await self.db.execute(
            select(StaffMember)
            .join(Venue, Venue.id == StaffMember.venue_id)
            .where(Venue.owner_id == owner.id)
            .options(
                selectinload(StaffMember.permissions),
                selectinload(StaffMember.staff_user),
                selectinload(StaffMember.venue),
            )
            .order_by(StaffMember.created_at.desc())
        )
        return list(result.scalars().all())

    async def _load_full(self, staff_member_id: uuid.UUID) -> StaffMember | None:
        # A select() (not db.get) so the selectinload options always run, even when
        # the row is already in the session's identity map (e.g. just created).
        result = await self.db.execute(
            select(StaffMember)
            .where(StaffMember.id == staff_member_id)
            .options(
                selectinload(StaffMember.permissions),
                selectinload(StaffMember.staff_user),
                selectinload(StaffMember.venue),
            )
        )
        return result.scalar_one_or_none()

    async def get_owned(self, staff_member_id: uuid.UUID, owner: User) -> StaffMember:
        sm = await self._load_full(staff_member_id)
        if sm is None:
            raise AppError(404, ErrorCode.STAFF_NOT_FOUND, "Staff member not found")
        if owner.role != UserRole.ADMIN:
            venue = await self.db.get(Venue, sm.venue_id)
            if venue is None or venue.owner_id != owner.id:
                raise AppError(403, ErrorCode.NOT_VENUE_OWNER, "Not your staff member")
        return sm

    async def _resolve_staff_user(self, owner: User, name: str, phone: str, password: str) -> User:
        """Find or create the STAFF user for this phone. A brand-new number gets a
        new STAFF account; an existing number is reused only if it's already a
        STAFF user working for THIS owner (so an owner can add the same person to a
        second of their venues). Any other existing account => conflict."""
        user = (await self.db.execute(select(User).where(User.phone == phone))).scalar_one_or_none()
        if user is None:
            user = User(
                phone=phone,
                name=name,
                role=UserRole.STAFF,
                password_hash=await hash_password(password),
                # Owner vouches for the number; skip the OTP step for a staff
                # account so it can log in immediately (still phone+password).
                phone_verified_at=datetime.now(timezone.utc),
            )
            self.db.add(user)
            await self.db.flush()
            return user
        if user.role != UserRole.STAFF:
            raise AppError(409, ErrorCode.PHONE_ALREADY_REGISTERED, "That phone number already has an account.")
        already_mine = (
            await self.db.execute(
                select(StaffMember.id)
                .join(Venue, Venue.id == StaffMember.venue_id)
                .where(StaffMember.staff_user_id == user.id, Venue.owner_id == owner.id)
            )
        ).first()
        if already_mine is None:
            raise AppError(409, ErrorCode.PHONE_ALREADY_REGISTERED, "That phone number already has an account.")
        return user

    async def create(
        self,
        owner: User,
        venue: Venue,
        name: str,
        phone: str,
        password: str,
        permissions: list[str],
        flag_map: dict[str, bool],
    ) -> StaffMember:
        perms = self._validate_permissions(permissions, flag_map)
        user = await self._resolve_staff_user(owner, name, phone, password)

        existing = (
            await self.db.execute(
                select(StaffMember).where(
                    StaffMember.staff_user_id == user.id, StaffMember.venue_id == venue.id
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise AppError(409, ErrorCode.STAFF_ALREADY_EXISTS, "This person is already staff at this venue.")

        sm = StaffMember(
            staff_user_id=user.id, venue_id=venue.id, invited_by_user_id=owner.id, is_active=True
        )
        self.db.add(sm)
        await self.db.flush()
        for p in perms:
            self.db.add(StaffPermission(staff_member_id=sm.id, permission=p))
        await self.db.commit()
        return await self.get_owned(sm.id, owner)

    async def set_permissions(self, sm: StaffMember, permissions: list[str], flag_map: dict[str, bool]) -> StaffMember:
        perms = self._validate_permissions(permissions, flag_map)
        await self.db.execute(delete(StaffPermission).where(StaffPermission.staff_member_id == sm.id))
        for p in perms:
            self.db.add(StaffPermission(staff_member_id=sm.id, permission=p))
        await self.db.commit()
        reloaded = await self._load_full(sm.id)
        assert reloaded is not None
        return reloaded

    async def set_active(self, sm: StaffMember, active: bool) -> None:
        sm.is_active = active
        await self.db.commit()
        if not active:
            await self.revoke_sessions(sm.staff_user_id)

    async def revoke_sessions(self, staff_user_id: uuid.UUID) -> None:
        """Kill every active session of a staff user immediately (owner decision:
        deactivation locks them out mid-session, not at natural token expiry)."""
        await self.db.execute(
            update(Session)
            .where(Session.user_id == staff_user_id, Session.is_revoked.is_(False))
            .values(is_revoked=True, revoked_reason="staff_deactivated")
        )
        await self.db.commit()
