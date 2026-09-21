import uuid

from fastapi import APIRouter, HTTPException, Query, status

from app.dependencies import AppSettings, CurrentUser, DbSession, PageParams, RequireOwner
from app.errors import AppError, ErrorCode
from app.models.booking import BookingStatus, CancelledBy
from app.models.court import Court
from app.models.user import User
from app.models.venue import Venue
from app.schemas.booking import (
    BookingCancelIn,
    BookingHoldIn,
    BookingHoldResponse,
    BookingOut,
    BookingResponse,
    BookingSelfCheckinIn,
    PaymentInstructionsOut,
    WalkInBookingIn,
)
from app.services.booking_service import BookingService
from app.services.notification_service import NotificationService
from app.services.venue_service import VenueService
from app.services.waitlist_service import WaitlistService

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.post("/hold", response_model=BookingHoldResponse, status_code=status.HTTP_201_CREATED)
async def hold_booking(
    payload: BookingHoldIn, db: DbSession, settings: AppSettings, user: CurrentUser
) -> BookingHoldResponse:
    service = BookingService(db, settings)
    booking = await service.create_hold(user, payload.court_id, payload.starts_at, payload.slot_count)

    court = await db.get(Court, booking.court_id)
    payment_instructions = None
    if court is not None:
        venue = await db.get(Venue, court.venue_id)
        if venue is not None:
            venue_service = VenueService(db, settings)
            bank_details = venue_service.decrypted_bank_details(venue) or {}
            payment_instructions = PaymentInstructionsOut(
                bank=bank_details.get("bank"),
                account_title=bank_details.get("account_title"),
                account_number=bank_details.get("account_number"),
                iban=bank_details.get("iban"),
                amount=float(booking.advance_amount),
            )
            owner = await db.get(User, venue.owner_id)
            if owner is not None:
                await NotificationService(db, settings).notify_owner_new_booking(
                    owner=owner, court_name=court.name, starts_at=booking.starts_at, ends_at=booking.ends_at
                )

    return BookingHoldResponse(booking=BookingOut.model_validate(booking), payment_instructions=payment_instructions)


@router.post("/walkin", response_model=BookingResponse, status_code=status.HTTP_201_CREATED)
async def create_walkin_booking(
    payload: WalkInBookingIn, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> BookingResponse:
    """Owner/staff records a booking made by phone or at the counter -- cash
    already collected, so it's booked immediately with no hold or proof."""
    court = await db.get(Court, payload.court_id)
    if court is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Court not found")
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(court.venue_id, owner)

    service = BookingService(db, settings)
    booking = await service.create_walkin(
        court_id=payload.court_id,
        starts_at=payload.starts_at,
        player_name=payload.player_name,
        player_phone=payload.player_phone,
        amount_paid=payload.amount_paid,
        recorded_by=owner,
    )
    return BookingResponse(booking=BookingOut.model_validate(booking))


@router.get("/mine", response_model=list[BookingOut])
async def list_my_bookings(
    db: DbSession,
    settings: AppSettings,
    user: CurrentUser,
    page: PageParams,
    status_filter: str = Query("all", alias="status", pattern="^(upcoming|past|all)$"),
) -> list[BookingOut]:
    service = BookingService(db, settings)
    bookings = await service.list_for_player(
        user.id, when=status_filter, offset=page.offset, limit=page.page_size
    )
    return [BookingOut.model_validate(b) for b in bookings]


@router.get("/{booking_id}", response_model=BookingOut)
async def get_booking(
    booking_id: uuid.UUID, db: DbSession, settings: AppSettings, user: CurrentUser
) -> BookingOut:
    service = BookingService(db, settings)
    booking = await service.require_accessible_booking(booking_id, user)
    return BookingOut.model_validate(booking)


@router.post("/{booking_id}/cancel", response_model=BookingResponse)
async def cancel_booking(
    booking_id: uuid.UUID,
    payload: BookingCancelIn,
    db: DbSession,
    settings: AppSettings,
    user: CurrentUser,
) -> BookingResponse:
    service = BookingService(db, settings)
    booking = await service.require_accessible_booking(booking_id, user)
    court = await db.get(Court, booking.court_id)
    was_already_cancelled = booking.status == BookingStatus.CANCELLED

    cancelled_by = CancelledBy.PLAYER if booking.player_id == user.id else CancelledBy.OWNER
    booking = await service.cancel_booking(booking, cancelled_by, payload.reason)

    # cancel_booking is idempotent (a no-op on an already-cancelled
    # booking) -- skip re-notifying/re-waking the waitlist on a repeat call.
    if court is not None and not was_already_cancelled:
        notifications = NotificationService(db, settings)
        if booking.player_id is not None:
            player = await db.get(User, booking.player_id)
            if player is not None:
                await notifications.notify_booking_cancelled(
                    user=player, court_name=court.name, starts_at=booking.starts_at, ends_at=booking.ends_at
                )
        waitlist_service = WaitlistService(db, settings)
        await waitlist_service.notify_matching_entries(court, booking.starts_at)

    return BookingResponse(booking=BookingOut.model_validate(booking))


@router.post("/{booking_id}/checkin", response_model=BookingResponse)
async def check_in_booking(
    booking_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> BookingResponse:
    service = BookingService(db, settings)
    booking = await service.require_accessible_booking(booking_id, owner)
    booking = await service.check_in(booking)
    return BookingResponse(booking=BookingOut.model_validate(booking))


@router.post("/{booking_id}/checkin/self", response_model=BookingResponse)
async def check_in_booking_self(
    booking_id: uuid.UUID, payload: BookingSelfCheckinIn, db: DbSession, settings: AppSettings, user: CurrentUser
) -> BookingResponse:
    """Player-initiated alternative to the owner-scan checkin above --
    requires a QR token physically posted at the venue, so it still
    requires the player's own physical presence. See finding #17 in
    AUDIT_FINDINGS.md."""
    service = BookingService(db, settings)
    booking = await service.require_accessible_booking(booking_id, user)
    if booking.player_id != user.id:
        raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_YOUR_BOOKING, "Not your booking")
    booking = await service.check_in_self(booking, payload.venue_qr_token)
    return BookingResponse(booking=BookingOut.model_validate(booking))
