import uuid
from datetime import date

from fastapi import APIRouter, Response
from sqlalchemy import select

from app.api.payments import _payment_out
from app.dependencies import AppSettings, DbSession, RequireOwner
from app.models.booking import Booking
from app.models.court import Court
from app.models.payment import Payment
from app.models.venue import Venue
from app.schemas.admin import OwnerDigestOut
from app.schemas.booking import BookingOut
from app.schemas.owner_dashboard import GrowthOut, LedgerOut, PendingApprovalOut, TodayOut
from app.schemas.payment import PaymentOut
from app.schemas.venue import VenueOut
from app.services.growth_service import GrowthService
from app.services.owner_dashboard_service import OwnerDashboardService
from app.services.venue_service import VenueService

router = APIRouter(prefix="/owners", tags=["owners"])


@router.get("/venues", response_model=list[VenueOut])
async def my_venues(db: DbSession, settings: AppSettings, owner: RequireOwner) -> list[VenueOut]:
    venue_service = VenueService(db, settings)
    result = await db.execute(select(Venue).where(Venue.owner_id == owner.id))
    venues = result.scalars().all()
    return [
        await venue_service.to_out(await venue_service.get_venue(v.id), requesting_user=owner)
        for v in venues
    ]


@router.get("/venues/{venue_id}/bookings", response_model=list[BookingOut])
async def venue_bookings(
    venue_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> list[BookingOut]:
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(venue_id, owner)

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
    venue_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> list[PaymentOut]:
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(venue_id, owner)

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
    owner: RequireOwner,
    date_: date | None = None,
    venue_id: uuid.UUID | None = None,
) -> TodayOut:
    service = OwnerDashboardService(db, settings)
    return await service.today(owner, target_date=date_, venue_id=venue_id)


@router.get("/pending-approvals", response_model=list[PendingApprovalOut])
async def owner_pending_approvals(
    db: DbSession, settings: AppSettings, owner: RequireOwner, venue_id: uuid.UUID | None = None
) -> list[PendingApprovalOut]:
    service = OwnerDashboardService(db, settings)
    return await service.pending_approvals(owner, venue_id=venue_id)


@router.get("/ledger", response_model=LedgerOut)
async def owner_ledger(
    db: DbSession,
    settings: AppSettings,
    owner: RequireOwner,
    start_date: date,
    end_date: date,
    venue_id: uuid.UUID | None = None,
    court_id: uuid.UUID | None = None,
    method: str | None = None,
    booking_status: str | None = None,
) -> LedgerOut:
    service = OwnerDashboardService(db, settings)
    return await service.ledger(
        owner, start_date, end_date, venue_id=venue_id, court_id=court_id, method=method, booking_status=booking_status
    )


@router.get("/ledger/export")
async def owner_ledger_export(
    db: DbSession,
    settings: AppSettings,
    owner: RequireOwner,
    start_date: date,
    end_date: date,
    venue_id: uuid.UUID | None = None,
    court_id: uuid.UUID | None = None,
    method: str | None = None,
    booking_status: str | None = None,
) -> Response:
    service = OwnerDashboardService(db, settings)
    csv_text = await service.ledger_csv(
        owner, start_date, end_date, venue_id=venue_id, court_id=court_id, method=method, booking_status=booking_status
    )
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=ledger_{start_date}_{end_date}.csv"},
    )


@router.get("/growth", response_model=GrowthOut)
async def owner_growth(
    db: DbSession, settings: AppSettings, owner: RequireOwner, venue_id: uuid.UUID | None = None
) -> GrowthOut:
    service = OwnerDashboardService(db, settings)
    return await service.growth_suggestions(owner, venue_id=venue_id)
