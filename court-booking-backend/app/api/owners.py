import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from sqlalchemy import select

from app.api.payments import _payment_out
from app.dependencies import AppSettings, DbSession, RequireOwner, RequireStaffCapable, require_feature
from app.errors import AppError, ErrorCode
from app.models.booking import Booking
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.schemas.admin import OwnerDigestOut, OwnerRefundOut
from app.schemas.booking import BookingOut
from app.schemas.owner_dashboard import GrowthOut, LedgerOut, PendingApprovalOut, TodayOut
from app.schemas.payment import PaymentOut
from app.schemas.venue import VenueOut
from app.services.admin_service import AdminService
from app.services.booking_service import BookingService
from app.services.growth_service import GrowthService
from app.services.notification_service import NotificationService
from app.services.owner_dashboard_service import OwnerDashboardService
from app.services.staff_service import resolve_owner_context, staffed_venue_ids
from app.services.venue_service import VenueService
from app.utils.image import InvalidImageError, validate_image
from app.utils.s3 import upload_private_proof

router = APIRouter(prefix="/owners", tags=["owners"])

MAX_REFUND_SCREENSHOT_BYTES = 10 * 1024 * 1024
ALLOWED_REFUND_SCREENSHOT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.get("/venues", response_model=list[VenueOut])
async def my_venues(db: DbSession, settings: AppSettings, owner: RequireStaffCapable) -> list[VenueOut]:
    venue_service = VenueService(db, settings)
    if owner.role == UserRole.STAFF:
        # Staff see only the venue(s) they're assigned to.
        venue_ids = await staffed_venue_ids(db, owner.id)
        result = await db.execute(select(Venue).where(Venue.id.in_(venue_ids))) if venue_ids else None
        venues = result.scalars().all() if result is not None else []
    else:
        result = await db.execute(select(Venue).where(Venue.owner_id == owner.id))
        venues = result.scalars().all()
    return [
        await venue_service.to_out(await venue_service.get_venue(v.id), requesting_user=owner)
        for v in venues
    ]


@router.get("/venues/{venue_id}/bookings", response_model=list[BookingOut])
async def venue_bookings(
    venue_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> list[BookingOut]:
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(venue_id, owner, permission="view_ledger")

    court_ids_result = await db.execute(select(Court.id).where(Court.venue_id == venue_id))
    court_ids = [row[0] for row in court_ids_result.all()]
    if not court_ids:
        return []
    result = await db.execute(
        select(Booking).where(Booking.court_id.in_(court_ids)).order_by(Booking.starts_at.desc())
    )
    return [BookingOut.model_validate(b) for b in result.scalars().all()]


@router.get("/venues/{venue_id}/payments/pending", response_model=list[PaymentOut])
async def pending_payments(
    venue_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> list[PaymentOut]:
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(venue_id, owner, permission="view_ledger")

    court_ids_result = await db.execute(select(Court.id).where(Court.venue_id == venue_id))
    court_ids = [row[0] for row in court_ids_result.all()]
    if not court_ids:
        return []
    result = await db.execute(
        select(Payment)
        .join(Booking, Booking.id == Payment.booking_id)
        .where(Booking.court_id.in_(court_ids), Payment.review_verdict.is_(None))
        .order_by(Payment.created_at.asc())
    )
    return [_payment_out(p) for p in result.scalars().all()]


@router.get("/digest", response_model=list[OwnerDigestOut])
async def owner_digest(db: DbSession, owner: RequireOwner) -> list[OwnerDigestOut]:
    growth_service = GrowthService(db)
    return await growth_service.owner_digest(owner.id)


@router.get("/today", response_model=TodayOut)
async def owner_today(
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    date_: date | None = None,
    venue_id: uuid.UUID | None = None,
) -> TodayOut:
    eff_owner, eff_venue = await resolve_owner_context(db, owner, venue_id, "view_ledger")
    service = OwnerDashboardService(db, settings)
    return await service.today(eff_owner, target_date=date_, venue_id=eff_venue)


@router.get("/pending-approvals", response_model=list[PendingApprovalOut])
async def owner_pending_approvals(
    db: DbSession, settings: AppSettings, owner: RequireStaffCapable, venue_id: uuid.UUID | None = None
) -> list[PendingApprovalOut]:
    eff_owner, eff_venue = await resolve_owner_context(db, owner, venue_id, "view_ledger")
    service = OwnerDashboardService(db, settings)
    return await service.pending_approvals(eff_owner, venue_id=eff_venue)


@router.get("/ledger", response_model=LedgerOut)
async def owner_ledger(
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    start_date: date,
    end_date: date,
    venue_id: uuid.UUID | None = None,
    court_id: uuid.UUID | None = None,
    method: str | None = None,
    booking_status: str | None = None,
) -> LedgerOut:
    eff_owner, eff_venue = await resolve_owner_context(db, owner, venue_id, "view_ledger")
    service = OwnerDashboardService(db, settings)
    return await service.ledger(
        eff_owner, start_date, end_date, venue_id=eff_venue, court_id=court_id, method=method, booking_status=booking_status
    )


@router.get("/ledger/export")
async def owner_ledger_export(
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    start_date: date,
    end_date: date,
    venue_id: uuid.UUID | None = None,
    court_id: uuid.UUID | None = None,
    method: str | None = None,
    booking_status: str | None = None,
) -> Response:
    eff_owner, eff_venue = await resolve_owner_context(db, owner, venue_id, "view_ledger")
    service = OwnerDashboardService(db, settings)
    csv_text = await service.ledger_csv(
        eff_owner, start_date, end_date, venue_id=eff_venue, court_id=court_id, method=method, booking_status=booking_status
    )
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=ledger_{start_date}_{end_date}.csv"},
    )


@router.get("/growth", response_model=GrowthOut)
async def owner_growth(
    db: DbSession, settings: AppSettings, owner: RequireStaffCapable, venue_id: uuid.UUID | None = None
) -> GrowthOut:
    eff_owner, eff_venue = await resolve_owner_context(db, owner, venue_id, "view_growth")
    service = OwnerDashboardService(db, settings)
    return await service.growth_suggestions(eff_owner, venue_id=eff_venue)


@router.get("/refunds", response_model=list[OwnerRefundOut])
async def owner_refunds(
    db: DbSession, settings: AppSettings, owner: RequireStaffCapable, venue_id: uuid.UUID | None = None
) -> list[OwnerRefundOut]:
    """Section 32 Part 10: the owner's "Refunds to pay" screen. Deliberately NOT
    gated by the refunds flag -- when refunds are turned off, already-owed refunds
    must stay visible (view-only); only the mark-refunded action is blocked."""
    eff_owner, eff_venue = await resolve_owner_context(db, owner, venue_id, "mark_refunds")
    service = OwnerDashboardService(db, settings)
    return await service.refunds_owed(eff_owner, venue_id=eff_venue)


@router.post(
    "/refunds/{dispute_id}/mark-refunded",
    response_model=OwnerRefundOut,
    dependencies=[Depends(require_feature("refunds"))],
)
async def owner_mark_refund_paid(
    dispute_id: uuid.UUID,
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    reference: str = Form(...),
    amount: float | None = Form(None),
    screenshot: UploadFile | None = File(None),
) -> OwnerRefundOut:
    """The owner sent the refund outside the app (JazzCash/bank transfer)
    and is recording that here -- there is no payment gateway integration,
    this is purely a record. `reference` is required (what does the owner
    point to if a player disputes this later); `amount`/`screenshot` are
    optional per the spec."""
    dispute = await db.get(PaymentDispute, dispute_id)
    if dispute is None:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Refund not found")
    booking_service = BookingService(db, settings)
    booking = await booking_service.require_accessible_booking(dispute.booking_id, owner, permission="mark_refunds")

    screenshot_key: str | None = None
    if screenshot is not None:
        if screenshot.content_type not in ALLOWED_REFUND_SCREENSHOT_TYPES:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_IMAGE_FORMAT, "Unsupported image type")
        screenshot_bytes = await screenshot.read()
        if len(screenshot_bytes) > MAX_REFUND_SCREENSHOT_BYTES:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.PROOF_TOO_LARGE, "Screenshot too large")
        try:
            validate_image(screenshot_bytes)
        except InvalidImageError as exc:
            raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_IMAGE_FORMAT, str(exc)) from exc
        # Private bucket, same visibility rule as a payment proof (only the
        # venue's own owner or an admin can ever ask for the signed URL back) --
        # this is evidence of an outgoing transfer, not something to publish.
        screenshot_key = await upload_private_proof(screenshot_bytes, screenshot.filename or "refund.jpg", screenshot.content_type)

    admin_service = AdminService(db, settings)
    dispute = await admin_service.mark_refund_paid(
        dispute, actor=owner, amount=amount, reference=reference, screenshot_key=screenshot_key
    )

    court = await db.get(Court, booking.court_id)
    venue = await db.get(Venue, court.venue_id) if court is not None else None
    if booking.player_id is not None:
        player = await db.get(User, booking.player_id)
        if player is not None:
            await NotificationService(db, settings).notify_refund_paid(
                user=player,
                court_name=court.name if court else "",
                amount=float(dispute.refunded_amount or 0),
                reference=reference,
            )

    return OwnerRefundOut(
        id=dispute.id,
        booking_id=booking.id,
        court_name=court.name if court else "",
        venue_name=venue.name if venue else "",
        player_name=booking.player_name,
        player_phone=booking.player_phone,
        starts_at=booking.starts_at,
        reason=dispute.reason,
        refund_amount=float(dispute.refund_amount or 0),
        refund_status=dispute.refund_status,
        refunded_amount=float(dispute.refunded_amount) if dispute.refunded_amount is not None else None,
        refund_reference=dispute.refund_reference,
        refunded_at=dispute.refunded_at,
        created_at=dispute.created_at,
        is_overdue=False,
    )
