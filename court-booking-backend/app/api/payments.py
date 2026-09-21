import uuid

from fastapi import APIRouter, File, UploadFile, status

from app.dependencies import AppSettings, CurrentUser, DbSession, RequireOwner
from app.errors import AppError, ErrorCode
from app.models.court import Court
from app.models.user import User
from app.models.venue import Venue
from app.schemas.booking import BookingOut
from app.schemas.payment import PaymentOut, PaymentRejectIn, PaymentSubmitResponse, ProofUrlOut
from app.services.booking_service import BookingService
from app.services.notification_service import NotificationService
from app.services.payment_service import PaymentService
from app.services.venue_service import VenueService
from app.utils.image import InvalidImageError, validate_image

router = APIRouter(tags=["payments"])

MAX_PROOF_BYTES = 10 * 1024 * 1024
ALLOWED_PROOF_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _payment_out(payment) -> PaymentOut:
    out = PaymentOut.model_validate(payment)
    out.proof_url = PaymentService.proof_url(payment)
    out.expected_amount = float(payment.amount_claimed) if payment.amount_claimed is not None else None
    return out


async def _venue_for_court(db: DbSession, court_id: uuid.UUID) -> Venue | None:
    court = await db.get(Court, court_id)
    if court is None:
        return None
    return await db.get(Venue, court.venue_id)


@router.post(
    "/bookings/{booking_id}/payment-proof",
    response_model=PaymentSubmitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_payment_proof(
    booking_id: uuid.UUID,
    db: DbSession,
    settings: AppSettings,
    user: CurrentUser,
    image: UploadFile = File(...),
) -> PaymentSubmitResponse:
    booking_service = BookingService(db, settings)
    booking = await booking_service.require_accessible_booking(booking_id, user)
    if booking.player_id != user.id:
        raise AppError(status.HTTP_403_FORBIDDEN, ErrorCode.NOT_YOUR_BOOKING, "Not your booking")

    if image.content_type not in ALLOWED_PROOF_TYPES:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_IMAGE_FORMAT, "Unsupported proof type")
    proof_bytes = await image.read()
    if len(proof_bytes) > MAX_PROOF_BYTES:
        raise AppError(status.HTTP_400_BAD_REQUEST, ErrorCode.PROOF_TOO_LARGE, "Proof image too large")
    try:
        validate_image(proof_bytes)
    except InvalidImageError as exc:
        raise AppError(
            status.HTTP_400_BAD_REQUEST, ErrorCode.INVALID_IMAGE_FORMAT, str(exc)
        ) from exc

    payment_service = PaymentService(db, settings)
    payment = await payment_service.submit_payment(
        booking, proof_bytes=proof_bytes, filename=image.filename or "proof.jpg", content_type=image.content_type
    )
    await db.refresh(booking)

    if booking.status.value == "payment_submitted":
        venue = await _venue_for_court(db, booking.court_id)
        court = await db.get(Court, booking.court_id)
        if venue is not None and court is not None:
            owner = await db.get(User, venue.owner_id)
            if owner is not None:
                await NotificationService(db, settings).notify_payment_submitted(
                    owner=owner,
                    court_name=court.name,
                    amount=float(payment.amount_claimed or 0),
                    booking_id=booking.id,
                    ocr_verdict=payment.ocr_verdict,
                )
    elif booking.player_id is not None:
        court = await db.get(Court, booking.court_id)
        player = await db.get(User, booking.player_id)
        if court is not None and player is not None:
            venue = await db.get(Venue, court.venue_id)
            await NotificationService(db, settings).notify_booking_confirmed(
                user=player,
                court_name=court.name,
                venue_name=venue.name if venue else "",
                starts_at=booking.starts_at,
                ends_at=booking.ends_at,
                amount_paid=float(booking.amount_paid),
            )

    return PaymentSubmitResponse(payment=_payment_out(payment), booking=BookingOut.model_validate(booking))


@router.post("/payments/{payment_id}/approve", response_model=PaymentSubmitResponse)
async def approve_payment(
    payment_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> PaymentSubmitResponse:
    payment_service = PaymentService(db, settings)
    payment = await payment_service.get_payment(payment_id)
    booking_service = BookingService(db, settings)
    booking = await booking_service.require_accessible_booking(payment.booking_id, owner)

    payment = await payment_service.approve_payment(payment, booking, owner)
    await db.refresh(booking)

    court = await db.get(Court, booking.court_id)
    player = await db.get(User, booking.player_id) if booking.player_id else None
    if court is not None and player is not None:
        venue = await db.get(Venue, court.venue_id)
        await NotificationService(db, settings).notify_booking_confirmed(
            user=player,
            court_name=court.name,
            venue_name=venue.name if venue else "",
            starts_at=booking.starts_at,
            ends_at=booking.ends_at,
            amount_paid=float(booking.amount_paid),
        )

    return PaymentSubmitResponse(payment=_payment_out(payment), booking=BookingOut.model_validate(booking))


@router.post("/payments/{payment_id}/reject", response_model=PaymentSubmitResponse)
async def reject_payment(
    payment_id: uuid.UUID, payload: PaymentRejectIn, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> PaymentSubmitResponse:
    payment_service = PaymentService(db, settings)
    payment = await payment_service.get_payment(payment_id)
    booking_service = BookingService(db, settings)
    booking = await booking_service.require_accessible_booking(payment.booking_id, owner)

    payment = await payment_service.reject_payment(payment, booking, owner, payload.reason)
    await db.refresh(booking)

    court = await db.get(Court, booking.court_id)
    player = await db.get(User, booking.player_id) if booking.player_id else None
    if court is not None and player is not None:
        await NotificationService(db, settings).notify_payment_rejected(
            user=player, court_name=court.name, reason=payload.reason
        )

    return PaymentSubmitResponse(payment=_payment_out(payment), booking=BookingOut.model_validate(booking))


@router.get("/payments/{payment_id}/proof-url", response_model=ProofUrlOut)
async def get_proof_url(
    payment_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireOwner
) -> ProofUrlOut:
    payment_service = PaymentService(db, settings)
    payment = await payment_service.get_payment(payment_id)
    # require_accessible_booking already enforces that `owner` owns the venue
    # this booking's court belongs to (or is an admin) -- a different venue's
    # owner gets a 403 here, not a leaked URL.
    booking_service = BookingService(db, settings)
    await booking_service.require_accessible_booking(payment.booking_id, owner)

    url = PaymentService.proof_url(payment, expires_in=300)
    if url is None:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "No proof uploaded")
    return ProofUrlOut(url=url, expires_in=300)


@router.get("/bookings/{booking_id}/payments", response_model=list[PaymentOut])
async def list_payments_for_booking(
    booking_id: uuid.UUID, db: DbSession, settings: AppSettings, user: CurrentUser
) -> list[PaymentOut]:
    booking_service = BookingService(db, settings)
    await booking_service.require_accessible_booking(booking_id, user)
    payment_service = PaymentService(db, settings)
    payments = await payment_service.list_for_booking(booking_id)
    return [_payment_out(p) for p in payments]
