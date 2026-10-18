import uuid

import structlog

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import (
    AppSettings,
    CurrentUser,
    DbSession,
    PageParams,
    RequireStaffCapable,
    require_feature,
)
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
from app.services import slot_compat
from app.services.player_name import clean_player_name
from app.services.slot_compat import LegacySlotUnits
from app.services.venue_service import VenueService
from app.services.waitlist_service import WaitlistService

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.post("/hold", response_model=BookingHoldResponse, status_code=status.HTTP_201_CREATED)
async def hold_booking(
    payload: BookingHoldIn, db: DbSession, settings: AppSettings, user: CurrentUser, legacy: LegacySlotUnits
) -> BookingHoldResponse:
    service = BookingService(db, settings)
    named_court = await db.get(Court, payload.court_id)
    # TRANSITION (delete with slot_compat.py): a request without `X-Slot-Grid: 30` is an app build from before the 30-minute
    # grid; its `slot_count` counts slots of the court's own length (omitted = 1), so convert it before the one real code path.
    slot_count = payload.slot_count
    if legacy and named_court is not None:
        slot_count = slot_compat.to_new_slot_count(named_court, payload.slot_count)
    # The name the player gave in the chat (same rule as the AI tools and the WhatsApp path); a court/venue/sport word
    # or a blank is dropped and the account's own name is used.
    player_name = None
    if payload.player_name and named_court is not None:
        player_name = await clean_player_name(db, named_court, payload.player_name)
    # `name_is_own` only has effect together with a name that survived cleaning; the account name is saved inside create_hold,
    # in the same transaction as the hold (never for a proposal alone, never over an existing name).
    booking = await service.create_hold(
        user, payload.court_id, payload.starts_at, slot_count, player_name,
        legacy_units=legacy, name_is_own=payload.name_is_own,
    )

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
                    owner=owner, court_name=court.name, starts_at=booking.starts_at, ends_at=booking.ends_at,
                    reference_id=booking.id,
                )

    return BookingHoldResponse(booking=BookingOut.model_validate(booking), payment_instructions=payment_instructions)


@router.post("/walkin", response_model=BookingResponse, status_code=status.HTTP_201_CREATED)
async def create_walkin_booking(
    payload: WalkInBookingIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable, legacy: LegacySlotUnits
) -> BookingResponse:
    """Owner/staff records a booking made by phone or at the counter -- cash
    already collected, so it's booked immediately with no hold or proof. A start whose 30-minute slot has already ended is
    refused (WALKIN_IN_PAST); the slot in progress is allowed. TRANSITION: a legacy request counts `slot_count` in the
    court's own slot length (omitted = 1)."""
    court = await db.get(Court, payload.court_id)
    if court is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Court not found")
    venue_service = VenueService(db, settings)
    await venue_service.require_owned_venue(court.venue_id, owner, permission="walkin")

    service = BookingService(db, settings)
    booking = await service.create_walkin(
        court_id=payload.court_id,
        starts_at=payload.starts_at,
        player_name=payload.player_name,
        player_phone=payload.player_phone,
        amount_paid=payload.amount_paid,
        recorded_by=owner,
        method=payload.method,
        slot_count=slot_compat.to_new_slot_count(court, payload.slot_count) if legacy else payload.slot_count,
        legacy_units=legacy,
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
    # Player cancels their own booking; an owner or a staff member with the
    # cancel_booking permission cancels one at their venue.
    booking = await service.require_accessible_booking(booking_id, user, permission="cancel_booking")
    court = await db.get(Court, booking.court_id)
    was_already_cancelled = booking.status == BookingStatus.CANCELLED
    was_awaiting_approval = booking.status == BookingStatus.PAYMENT_SUBMITTED

    cancelled_by = CancelledBy.PLAYER if booking.player_id == user.id else CancelledBy.OWNER
    booking = await service.cancel_booking(booking, cancelled_by, payload.reason)
    response = BookingResponse(booking=BookingOut.model_validate(booking))

    # cancel_booking is idempotent (a no-op on an already-cancelled
    # booking) -- skip re-notifying/re-waking the waitlist on a repeat call.
    if court is not None and not was_already_cancelled:
        notifications = NotificationService(db, settings)
        if booking.player_id is not None:
            player = await db.get(User, booking.player_id)
            if player is not None:
                await notifications.notify_booking_cancelled(
                    user=player, court_name=court.name, starts_at=booking.starts_at, ends_at=booking.ends_at,
                    reference_id=booking.id,
                )
        waitlist_service = WaitlistService(db, settings)
        await waitlist_service.notify_matching_entries(court, booking.starts_at, booking.ends_at)
        # Owner Round 2 (A5): the player cancelled while the payment screenshot waited for approval -- a bell row for
        # the owner (the approvals card turns grey on its own). Best effort, never fails the cancel.
        if cancelled_by == CancelledBy.PLAYER and was_awaiting_approval and booking.status == BookingStatus.CANCELLED:
            try:
                venue = await db.get(Venue, court.venue_id)
                venue_owner = await db.get(User, venue.owner_id) if venue is not None else None
                if venue_owner is not None:
                    await notifications.notify_owner_player_cancelled(
                        owner=venue_owner, court_name=court.name, booking_id=booking.id,
                        starts_at=booking.starts_at, ends_at=booking.ends_at,
                    )
            except Exception as exc:  # noqa: BLE001
                logger.warning("booking.cancel.owner_player_cancelled_notification_failed", error=type(exc).__name__)
        # Owner Overview (spec 5.3): a PLAYER cancelling a booking that was paid for means a refund is now owed, so
        # tell the venue owner too. Strictly best effort: a notification problem must never fail the cancel.
        if (
            cancelled_by == CancelledBy.PLAYER
            and float(booking.amount_paid or 0) > 0
            and booking.status == BookingStatus.CANCELLED
        ):
            try:
                venue = await db.get(Venue, court.venue_id)
                venue_owner = await db.get(User, venue.owner_id) if venue is not None else None
                if venue_owner is not None:
                    await notifications.notify_owner_refund_owed(
                        owner=venue_owner,
                        booking_id=booking.id,
                        court_name=court.name,
                        starts_at=booking.starts_at,
                        ends_at=booking.ends_at,
                        amount=float(booking.amount_paid),
                        player_name=booking.player_name or user.name,
                    )
            except Exception as exc:  # noqa: BLE001 -- see comment above
                logger.warning("booking.cancel.owner_refund_notification_failed", error=type(exc).__name__)

    return response


@router.post("/{booking_id}/checkin", response_model=BookingResponse)
async def check_in_booking(
    booking_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> BookingResponse:
    service = BookingService(db, settings)
    booking = await service.require_accessible_booking(booking_id, owner, permission="check_in")
    booking = await service.check_in(booking)
    return BookingResponse(booking=BookingOut.model_validate(booking))


@router.post("/{booking_id}/no-show", response_model=BookingResponse)
async def mark_booking_no_show(
    booking_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> BookingResponse:
    """Section 32 Part 9: manual counterpart to the automatic no-show job --
    lets an owner (or staff with check_in) flag a no-show as soon as the grace
    window has passed, instead of waiting on the job's next tick."""
    service = BookingService(db, settings)
    booking = await service.require_accessible_booking(booking_id, owner, permission="check_in")
    booking = await service.owner_mark_no_show(booking)
    return BookingResponse(booking=BookingOut.model_validate(booking))


@router.post(
    "/{booking_id}/checkin/self",
    response_model=BookingResponse,
    dependencies=[Depends(require_feature("qr_checkin"))],
)
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
