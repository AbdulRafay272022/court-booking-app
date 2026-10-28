import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
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
from app.services.duplicate_proof import used_on_bookings
from app.schemas.staff_activity import StaffActivityOut
from app.schemas.admin import OwnerDigestOut, OwnerRefundOut
from app.schemas.booking import BookingOut
from app.schemas.owner_dashboard import ApprovalsQueuePageOut, GrowthOut, LedgerOut, PendingApprovalOut, TodayOut
from app.schemas.owner_overview import (
    CompletionIn,
    OwnerBadgesOut,
    OwnerBookingDetailOut,
    OwnerBookingRowOut,
    OwnerBookingsPageOut,
    OwnerOverviewOut,
)
from app.schemas.payment import PaymentOut
from app.schemas.venue import VenueOut
from app.services.admin_service import AdminService
from app.services.booking_service import BookingService
from app.services.growth_service import GrowthService
from app.services.notification_service import NotificationService
from app.services.owner_dashboard_service import OwnerDashboardService, positive_entries_by_booking, refund_out
from app.services.owner_overview_service import HistoryFilter, OwnerOverviewService
from app.services.staff_service import resolve_owner_context, staffed_venue_ids
from app.services.venue_service import VenueService
from app.utils.image import InvalidImageError, validate_image
from app.utils.s3 import upload_private_proof
from app.utils.timezone import pkt_today

router = APIRouter(prefix="/owners", tags=["owners"])

CourtIdsQuery = Annotated[list[str] | None, Query(description="Repeat the param or pass a comma list; empty = all courts")]


def parse_id_list(values: list[str] | None) -> list[uuid.UUID] | None:
    """`court_ids=a,b&court_ids=c` -> [a, b, c]; None/empty -> None (= all courts)."""
    ids: list[uuid.UUID] = []
    for raw in values or []:
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                ids.append(uuid.UUID(part))
            except ValueError:
                raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.VALIDATION_ERROR, f"Invalid court id: {part}") from None
    return ids or None


def parse_str_list(values: list[str] | None) -> list[str] | None:
    out = [p.strip() for raw in values or [] for p in raw.split(",") if p.strip()]
    return out or None

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
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    venue_id: uuid.UUID | None = None,
    date_: Annotated[date | None, Query(alias="date")] = None,
    court_ids: CourtIdsQuery = None,
    booking_id: uuid.UUID | None = None,
) -> list[PendingApprovalOut]:
    """Optional `date` (operating day, same rule as Overview), `court_ids` and `booking_id`; without them: unchanged."""
    eff_owner, eff_venue = await resolve_owner_context(db, owner, venue_id, "view_ledger")
    service = OwnerDashboardService(db, settings)
    return await service.pending_approvals(
        eff_owner, venue_id=eff_venue, on_date=date_, court_ids=parse_id_list(court_ids), booking_id=booking_id
    )


@router.get("/approvals-queue", response_model=ApprovalsQueuePageOut)
async def owner_approvals_queue(
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    venue_id: uuid.UUID | None = None,
    date_: Annotated[date | None, Query(alias="date")] = None,
    court_ids: CourtIdsQuery = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
) -> ApprovalsQueuePageOut:
    """Owner Round 2 (A1/A5): every payment waiting for the owner, newest first, paginated; same scope, permission
    and filters as /owners/pending-approvals (which stays unchanged for old app builds)."""
    eff_owner, eff_venue = await resolve_owner_context(db, owner, venue_id, "view_ledger")
    service = OwnerDashboardService(db, settings)
    return await service.approvals_queue(
        eff_owner, venue_id=eff_venue, on_date=date_, court_ids=parse_id_list(court_ids), page=page, page_size=page_size
    )


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
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    venue_id: uuid.UUID | None = None,
    date_: Annotated[date | None, Query(alias="date")] = None,
    court_ids: CourtIdsQuery = None,
    booking_id: uuid.UUID | None = None,
) -> list[OwnerRefundOut]:
    """Section 32 Part 10: the owner's "Refunds to pay" screen. Deliberately NOT
    gated by the refunds flag -- when refunds are turned off, already-owed refunds
    must stay visible (view-only); only the mark-refunded action is blocked."""
    eff_owner, eff_venue = await resolve_owner_context(db, owner, venue_id, "mark_refunds")
    service = OwnerDashboardService(db, settings)
    return await service.refunds_owed(
        eff_owner, venue_id=eff_venue, on_date=date_, court_ids=parse_id_list(court_ids), booking_id=booking_id
    )


# --- Owner Overview / Bookings history (docs/owner-overview-contract.md) ----------------------------------------


@router.get("/overview", response_model=OwnerOverviewOut)
async def owner_overview(
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    date_: Annotated[date | None, Query(alias="date")] = None,
    venue_id: uuid.UUID | None = None,
    court_ids: CourtIdsQuery = None,
) -> OwnerOverviewOut:
    return await OwnerOverviewService(db, settings).overview(owner, date_, venue_id, parse_id_list(court_ids))


def _history_filter(
    date_from: date | None,
    date_to: date | None,
    court_ids,
    statuses,
    q: str | None,
    sort: str,
    booking_id: uuid.UUID | None = None,
) -> HistoryFilter:
    today = pkt_today()
    return HistoryFilter(
        date_from=date_from or today,
        date_to=date_to or date_from or today,
        court_ids=parse_id_list(court_ids),
        statuses=parse_str_list(statuses),
        q=q,
        sort=sort,
        booking_id=booking_id,
    )


@router.get("/bookings-history", response_model=OwnerBookingsPageOut)
async def owner_bookings_history(
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    date_from: date | None = None,
    date_to: date | None = None,
    venue_id: uuid.UUID | None = None,
    court_ids: CourtIdsQuery = None,
    statuses: Annotated[list[str] | None, Query()] = None,
    q: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    sort: str = "starts_at:desc",
    booking_id: uuid.UUID | None = None,
) -> OwnerBookingsPageOut:
    """`booking_id` (Owner Round 2, A2): only that booking's rows, the date range ignored; same permissions."""
    f = _history_filter(date_from, date_to, court_ids, statuses, q, sort, booking_id)
    return await OwnerOverviewService(db, settings).history(owner, venue_id, f, page, page_size)


@router.get("/bookings-history/export.csv")
async def owner_bookings_history_export(
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    date_from: date | None = None,
    date_to: date | None = None,
    venue_id: uuid.UUID | None = None,
    court_ids: CourtIdsQuery = None,
    statuses: Annotated[list[str] | None, Query()] = None,
    q: str | None = Query(None, max_length=100),
    sort: str = "starts_at:desc",
    booking_id: uuid.UUID | None = None,
) -> Response:
    f = _history_filter(date_from, date_to, court_ids, statuses, q, sort, booking_id)
    csv_text = await OwnerOverviewService(db, settings).history_csv(owner, venue_id, f)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=bookings_{f.date_from}_{f.date_to}.csv"},
    )


@router.get("/bookings/{booking_id}/overview-detail", response_model=OwnerBookingDetailOut)
async def owner_booking_overview_detail(
    booking_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> OwnerBookingDetailOut:
    return await OwnerOverviewService(db, settings).detail(owner, booking_id)


@router.post("/bookings/{booking_id}/completion", response_model=OwnerBookingRowOut)
async def owner_booking_completion(
    booking_id: uuid.UUID, payload: CompletionIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> OwnerBookingRowOut:
    """Booking completed (Haan / Nahi). Permission record_payments (owner always); deliberately NOT behind the
    split_payments flag so it works for plain bookings."""
    row = await OwnerOverviewService(db, settings).mark_completion(
        owner, booking_id, payload.result, payload.received_pkr, payload.reason, received_now=payload.received_now
    )
    # audit 2026-10-28 items 17 + 18: "kam mila" (money still due after completing) tells the owner (when staff did it)
    # and the player
    if row.due > 0:
        from app.models.booking import Booking
        from app.services.unsettled_notices import notify_unsettled

        booking = await db.get(Booking, booking_id)
        if booking is not None:
            await db.refresh(booking)
            await notify_unsettled(db, settings, booking, owner, "short", short_pkr=int(round(row.due)))
    return row


@router.get("/badges", response_model=OwnerBadgesOut)
async def owner_badges(
    db: DbSession, settings: AppSettings, owner: RequireStaffCapable, venue_id: uuid.UUID | None = None
) -> OwnerBadgesOut:
    return await OwnerOverviewService(db, settings).badges(owner, venue_id)


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
    already_refunded = float(dispute.refunded_amount or 0)
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
                amount=float(dispute.refunded_amount or 0) - already_refunded,
                reference=reference,
                reference_id=booking.id,
            )

    await db.refresh(dispute)
    payment = await db.get(Payment, dispute.payment_id) if dispute.payment_id else None
    positives = await positive_entries_by_booking(db, {booking.id})
    out = refund_out(
        dispute, booking, venue, None, payment, positives.get(booking.id, 0),
        court_name=court.name if court else "", court_sport=court.sport if court else None,
        now=datetime.now(timezone.utc), overdue_cutoff=timedelta(days=settings.REFUND_OVERDUE_DAYS),
        duplicate_used=await used_on_bookings(db, payment) if payment is not None else 0,
    )
    out.player_name = booking.player_name
    out.player_phone = booking.player_phone
    out.is_overdue = False
    return out


@router.get("/staff-activity", response_model=StaffActivityOut)
async def owner_staff_activity(
    db: DbSession,
    owner: RequireStaffCapable,
    venue_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> StaffActivityOut:
    """Audit 2026-10-28 item 16: per person (owner + staff) bookings marked, no-shows, check-ins, walk-ins, short payments,
    cash recorded, transfers credited, refunds paid, and the no-show list with who marked it and when. Owner (or admin) only."""
    from app.services.staff_activity_service import staff_activity

    return StaffActivityOut(**await staff_activity(db, owner, venue_id, date_from, date_to))
