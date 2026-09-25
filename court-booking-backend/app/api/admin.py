import uuid
from datetime import date

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.dependencies import AppSettings, DbSession, FeatureFlags, PageParams, RequireAdmin
from app.models.booking import BookingStatus
from app.models.user import User
from app.models.venue import Venue, VenueStatus
from app.schemas.admin import (
    AdminBookingOut,
    AdminDashboardOut,
    AdminUserOut,
    DisputeOut,
    FlaggedCheckinOut,
    PassiveOwnerVenueOut,
    PlatformStatsOut,
    ReasonIn,
    RefundQueueEntryOut,
    SuspendUserIn,
)
from app.schemas.feature_flag import FeatureFlagOut, FeatureFlagUpdateIn
from app.schemas.review import ReviewOut
from app.schemas.venue import VenueOut
from app.services.admin_service import AdminService
from app.services.audit_service import AuditService
from app.services.growth_service import GrowthService
from app.services.notification_service import NotificationService
from app.services.review_service import ReviewService
from app.services.venue_service import VenueService

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats", response_model=PlatformStatsOut)
async def platform_stats(db: DbSession, admin: RequireAdmin) -> PlatformStatsOut:
    return await GrowthService(db).platform_stats()


# --- Section 32 Part 12: global feature flags -------------------------------
@router.get("/feature-flags", response_model=list[FeatureFlagOut])
async def list_feature_flags(flags: FeatureFlags, admin: RequireAdmin) -> list[FeatureFlagOut]:
    return await flags.list_flags()


@router.patch("/feature-flags/{key}", response_model=FeatureFlagOut)
async def update_feature_flag(
    key: str, payload: FeatureFlagUpdateIn, flags: FeatureFlags, admin: RequireAdmin
) -> FeatureFlagOut:
    return await flags.set_flag(key, payload.enabled, admin.id)


@router.get("/dashboard", response_model=AdminDashboardOut)
async def admin_dashboard(db: DbSession, settings: AppSettings, admin: RequireAdmin) -> AdminDashboardOut:
    return await AdminService(db, settings).dashboard()


@router.get("/venues/pending", response_model=list[VenueOut])
async def pending_venues(
    db: DbSession, settings: AppSettings, admin: RequireAdmin, page: PageParams
) -> list[VenueOut]:
    venue_service = VenueService(db, settings)
    result = await db.execute(
        select(Venue)
        .where(Venue.status == VenueStatus.PENDING)
        .order_by(Venue.created_at.asc())
        .offset(page.offset)
        .limit(page.page_size)
    )
    venues = result.scalars().all()
    return [
        await venue_service.to_out(await venue_service.get_venue(v.id), requesting_user=admin)
        for v in venues
    ]


@router.get("/venues", response_model=list[VenueOut])
async def list_venues(
    db: DbSession,
    settings: AppSettings,
    admin: RequireAdmin,
    page: PageParams,
    status_: str = Query("all", alias="status"),
) -> list[VenueOut]:
    venue_service = VenueService(db, settings)
    query = select(Venue)
    if status_ != "all":
        query = query.where(Venue.status == VenueStatus(status_))
    query = query.order_by(Venue.created_at.desc()).offset(page.offset).limit(page.page_size)
    result = await db.execute(query)
    venues = result.scalars().all()
    return [
        await venue_service.to_out(await venue_service.get_venue(v.id), requesting_user=admin)
        for v in venues
    ]


async def _review_venue(
    venue_id: uuid.UUID,
    new_status: VenueStatus,
    reason: str | None,
    db: DbSession,
    settings: AppSettings,
    admin: User,
) -> VenueOut:
    venue_service = VenueService(db, settings)
    venue = await venue_service.get_venue(venue_id)
    old_status = venue.status.value
    venue = await venue_service.set_status(venue, new_status, reason)

    await AuditService(db).log(
        actor_user_id=admin.id,
        actor_type="admin",
        action="venue.reviewed",
        entity_type="venue",
        entity_id=venue.id,
        old_value={"status": old_status},
        new_value={"status": new_status.value, "reason": reason},
    )
    await db.commit()

    owner = await db.get(User, venue.owner_id)
    if owner is not None:
        notifications = NotificationService(db, settings)
        if new_status == VenueStatus.APPROVED:
            await notifications.notify_venue_approved(owner=owner, venue_name=venue.name)
        elif new_status == VenueStatus.CHANGES_REQUESTED:
            await notifications.notify_venue_changes_requested(
                owner=owner, venue_name=venue.name, reason=reason or ""
            )
        elif new_status == VenueStatus.REJECTED:
            await notifications.notify_venue_rejected(owner=owner, venue_name=venue.name, reason=reason or "")

    return await venue_service.to_out(venue, requesting_user=admin)


@router.post("/venues/{venue_id}/approve", response_model=VenueOut)
async def approve_venue(
    venue_id: uuid.UUID, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> VenueOut:
    return await _review_venue(venue_id, VenueStatus.APPROVED, None, db, settings, admin)


@router.post("/venues/{venue_id}/request-changes", response_model=VenueOut)
async def request_venue_changes(
    venue_id: uuid.UUID, payload: ReasonIn, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> VenueOut:
    return await _review_venue(venue_id, VenueStatus.CHANGES_REQUESTED, payload.reason, db, settings, admin)


@router.post("/venues/{venue_id}/reject", response_model=VenueOut)
async def reject_venue(
    venue_id: uuid.UUID, payload: ReasonIn, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> VenueOut:
    return await _review_venue(venue_id, VenueStatus.REJECTED, payload.reason, db, settings, admin)


@router.get("/bookings", response_model=list[AdminBookingOut])
async def list_bookings(
    db: DbSession,
    settings: AppSettings,
    admin: RequireAdmin,
    page: PageParams,
    status_: BookingStatus | None = Query(None, alias="status"),
    venue_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[AdminBookingOut]:
    service = AdminService(db, settings)
    return await service.list_bookings(
        status_filter=status_,
        venue_id=venue_id,
        date_from=date_from,
        date_to=date_to,
        offset=page.offset,
        limit=page.page_size,
    )


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    db: DbSession,
    settings: AppSettings,
    admin: RequireAdmin,
    page: PageParams,
    search: str | None = None,
    flagged: bool = False,
) -> list[AdminUserOut]:
    service = AdminService(db, settings)
    return await service.list_users(search=search, flagged=flagged, offset=page.offset, limit=page.page_size)


@router.get("/disputes", response_model=list[DisputeOut])
async def list_disputes(db: DbSession, settings: AppSettings, admin: RequireAdmin) -> list[DisputeOut]:
    return await AdminService(db, settings).list_disputes()


@router.get("/disputes/refund-queue", response_model=list[RefundQueueEntryOut])
async def list_refund_queue(
    db: DbSession, settings: AppSettings, admin: RequireAdmin, include_resolved: bool = False
) -> list[RefundQueueEntryOut]:
    return await AdminService(db, settings).list_refund_queue(include_resolved=include_resolved)


@router.get("/disputes/passive-venues", response_model=list[PassiveOwnerVenueOut])
async def list_passive_owner_venues(db: DbSession, settings: AppSettings, admin: RequireAdmin) -> list[PassiveOwnerVenueOut]:
    return await AdminService(db, settings).list_passive_owner_venues()


@router.get("/disputes/flagged-checkins", response_model=list[FlaggedCheckinOut])
async def list_flagged_checkins(db: DbSession, settings: AppSettings, admin: RequireAdmin) -> list[FlaggedCheckinOut]:
    return await AdminService(db, settings).list_flagged_checkins()


@router.post("/users/{user_id}/suspend", response_model=AdminUserOut)
async def suspend_user(
    user_id: uuid.UUID, payload: SuspendUserIn, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> AdminUserOut:
    service = AdminService(db, settings)
    user = await service.get_user(user_id)
    user = await service.suspend_user(user, payload.reason, admin)
    return AdminUserOut.model_validate(user)


@router.post("/users/{user_id}/unsuspend", response_model=AdminUserOut)
async def unsuspend_user(
    user_id: uuid.UUID, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> AdminUserOut:
    service = AdminService(db, settings)
    user = await service.get_user(user_id)
    user = await service.unsuspend_user(user, admin)
    return AdminUserOut.model_validate(user)


@router.post("/reviews/{review_id}/hide", response_model=ReviewOut)
async def hide_review(
    review_id: uuid.UUID, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> ReviewOut:
    """Admin hides an abusive review (Section 32 Part 6) -- it drops out of the public
    venue list; the average rating and count recompute over visible reviews only."""
    service = ReviewService(db, settings)
    review = await service.get(review_id)
    was_hidden = review.is_hidden
    out = await service.set_hidden(review, True)
    await AuditService(db).log(
        actor_user_id=admin.id, actor_type="admin", action="review_hidden",
        entity_type="review", entity_id=review_id,
        old_value={"is_hidden": was_hidden}, new_value={"is_hidden": True},
    )
    await db.commit()
    return out


@router.post("/reviews/{review_id}/unhide", response_model=ReviewOut)
async def unhide_review(
    review_id: uuid.UUID, db: DbSession, settings: AppSettings, admin: RequireAdmin
) -> ReviewOut:
    service = ReviewService(db, settings)
    review = await service.get(review_id)
    was_hidden = review.is_hidden
    out = await service.set_hidden(review, False)
    await AuditService(db).log(
        actor_user_id=admin.id, actor_type="admin", action="review_unhidden",
        entity_type="review", entity_id=review_id,
        old_value={"is_hidden": was_hidden}, new_value={"is_hidden": False},
    )
    await db.commit()
    return out
