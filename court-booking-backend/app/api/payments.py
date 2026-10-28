import uuid

from fastapi import APIRouter, Depends, File, UploadFile, status

from app.dependencies import AppSettings, CurrentUser, DbSession, RequireStaffCapable, require_feature
from app.errors import AppError, ErrorCode
from app.models.court import Court
from app.models.payment_entry import PaymentEntry
from app.models.user import User
from app.models.venue import Venue
from app.schemas.booking import BookingOut
from app.schemas.payment import AcknowledgeIn, AcknowledgeOut, PaymentApproveIn, PaymentOut, PaymentRejectIn, PaymentSubmitResponse, ProofUrlOut
from app.schemas.payment_entry import PaymentEntryIn, PaymentEntryOut, PaymentEntryResponse, PaymentEntryReverseIn
from app.services.booking_service import BookingService
from app.services.notification_service import NotificationService
from app.services.payment_ledger_service import PaymentLedgerService
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
    if booking.status.value == "booked":
        await _after_money(db, settings, booking)

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
                reference_id=booking.id,
            )

    return PaymentSubmitResponse(payment=_payment_out(payment), booking=BookingOut.model_validate(booking))


async def _after_money(db, settings, booking) -> None:
    """audit 2026-10-28 Phase 3: money landed on a booking -- 50 points if it is now fully paid by transfer (flag
    player_points), and a carried due is settled once the balance reaches 0. Best effort, never fails the approval."""
    from app.services.phase3_service import maybe_award_transfer_points, sync_claim_after_payment

    try:
        await maybe_award_transfer_points(db, settings, booking)
        await sync_claim_after_payment(db, settings, booking)
        await db.refresh(booking)
    except Exception:  # noqa: BLE001
        import structlog

        structlog.get_logger().warning("phase3.after_money_failed", exc_info=True)


async def _receipt_whatsapp(db, settings, booking, credited: int) -> None:
    """audit Phase 3 item 8: khelo_payment_receipt (+ khelo_balance_payment when money is still due) on WhatsApp, only with the
    whatsapp_templates flag on; the app's own push already says the booking is confirmed."""
    if credited <= 0 or booking.player_id is None:
        return
    from app.services.owner_overview_service import short_code
    from app.utils.timezone import format_pkr

    player = await db.get(User, booking.player_id)
    if player is None:
        return
    code = short_code(booking.id)
    notifications = NotificationService(db, settings)
    paid, due = float(booking.amount_paid or 0), float(booking.balance_due or 0)
    await notifications.send_khelo_whatsapp(
        player, "payment_receipt_wa",
        f"Booking {code}: {format_pkr(credited)} mil gaye. Kul ada {format_pkr(paid)}, baqi {format_pkr(due)}. Shukriya!",
        template_name="khelo_payment_receipt",
        template_params=[code, format_pkr(credited), format_pkr(paid), format_pkr(due)],
        reference_id=None,
    )
    if due > 0:
        court = await db.get(Court, booking.court_id)
        venue = await db.get(Venue, court.venue_id) if court else None
        bank = (VenueService(db, settings).decrypted_bank_details(venue) or {}) if venue else {}
        account = " / ".join(x for x in (bank.get("bank"), bank.get("account_title"), bank.get("iban") or bank.get("account_number")) if x)
        if account:
            await notifications.send_khelo_whatsapp(
                player, "balance_payment_wa",
                f"Booking {code}: baqi {format_pkr(due)}. Transfer se dena ho to is account mein bhejein: {account}.",
                template_name="khelo_balance_payment", template_params=[code, format_pkr(due), account], reference_id=booking.id,
            )


@router.post("/payments/{payment_id}/approve", response_model=PaymentSubmitResponse)
async def approve_payment(
    payment_id: uuid.UUID,
    db: DbSession,
    settings: AppSettings,
    owner: RequireStaffCapable,
    payload: PaymentApproveIn | None = None,
) -> PaymentSubmitResponse:
    payment_service = PaymentService(db, settings)
    payment = await payment_service.get_payment(payment_id)
    booking_service = BookingService(db, settings)
    booking = await booking_service.require_accessible_booking(
        payment.booking_id, owner, permission="approve_payments"
    )
    payment_service.require_awaiting(payment, booking)
    await payment_service.require_duplicate_confirmed(payment, bool(payload and payload.confirm_duplicate))
    paid_before = int(round(float(booking.amount_paid or 0)))

    payment = await payment_service.approve_payment(
        payment,
        booking,
        owner,
        amount_pkr=payload.amount_pkr if payload else None,
        accept_mode=payload.accept_mode if payload else None,
    )
    await db.refresh(booking)
    await _after_money(db, settings, booking)
    await _receipt_whatsapp(db, settings, booking, int(round(float(booking.amount_paid or 0))) - paid_before)

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
            reference_id=booking.id,
        )

    return PaymentSubmitResponse(payment=_payment_out(payment), booking=BookingOut.model_validate(booking))


@router.post("/payments/{payment_id}/reject", response_model=PaymentSubmitResponse)
async def reject_payment(
    payment_id: uuid.UUID, payload: PaymentRejectIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> PaymentSubmitResponse:
    payment_service = PaymentService(db, settings)
    payment = await payment_service.get_payment(payment_id)
    booking_service = BookingService(db, settings)
    booking = await booking_service.require_accessible_booking(
        payment.booking_id, owner, permission="approve_payments"
    )
    # Owner Round 2 (A5): a cancelled/expired booking gets 409 BOOKING_NO_LONGER_PENDING before any reason check, and
    # the player is never messaged. A reason is still required for a normal (awaiting) rejection.
    payment_service.require_awaiting(payment, booking)
    if payload.reason is None:
        raise AppError(
            status.HTTP_422_UNPROCESSABLE_ENTITY, ErrorCode.VALIDATION_ERROR, "A reason is required to reject a payment"
        )

    payment = await payment_service.reject_payment(payment, booking, owner, payload.reason)
    await db.refresh(booking)

    court = await db.get(Court, booking.court_id)
    player = await db.get(User, booking.player_id) if booking.player_id else None
    if court is not None and player is not None:
        await NotificationService(db, settings).notify_payment_rejected(
            user=player, court_name=court.name, reason=payload.reason, reference_id=booking.id
        )

    return PaymentSubmitResponse(payment=_payment_out(payment), booking=BookingOut.model_validate(booking))


@router.post("/owners/payments/{payment_id}/acknowledge", response_model=AcknowledgeOut)
async def acknowledge_cancelled_payment(
    payment_id: uuid.UUID, payload: AcknowledgeIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> AcknowledgeOut:
    """Owner Round 2 (A5): "Theek hai" on a payment whose booking the player cancelled / that expired. Same
    permission as approve (owner, or staff with approve_payments). Never messages the player."""
    payment_service = PaymentService(db, settings)
    payment = await payment_service.get_payment(payment_id)
    booking_service = BookingService(db, settings)
    booking = await booking_service.require_accessible_booking(
        payment.booking_id, owner, permission="approve_payments"
    )
    dispute = await payment_service.acknowledge_payment(payment, booking, owner, money_received=payload.money_received)
    return AcknowledgeOut(ok=True, refund_dispute_id=dispute.id if dispute is not None else None)


@router.get("/payments/{payment_id}/proof-url", response_model=ProofUrlOut)
async def get_proof_url(
    payment_id: uuid.UUID, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> ProofUrlOut:
    payment_service = PaymentService(db, settings)
    payment = await payment_service.get_payment(payment_id)
    # require_accessible_booking already enforces that `owner` owns the venue
    # this booking's court belongs to (or is an admin, or a staff member with the
    # approve_payments permission) -- a different venue's owner gets a 403 here,
    # not a leaked URL.
    booking_service = BookingService(db, settings)
    await booking_service.require_accessible_booking(payment.booking_id, owner, permission="approve_payments")

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


@router.post(
    "/bookings/{booking_id}/payment-entries",
    response_model=PaymentEntryResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_feature("split_payments"))],
)
async def record_payment_entry(
    booking_id: uuid.UUID, payload: PaymentEntryIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> PaymentEntryResponse:
    """Section 32 Part 5: the owner (or admin, or a staff member with record_payments) records money
    actually received against a booking -- typically the balance paid in cash at the venue, or a bank
    transfer that didn't go through the app's payment-proof flow. Refuses to record more than the balance
    due. Blocked (403 FEATURE_DISABLED) when the split-payments flag is off."""
    booking_service = BookingService(db, settings)
    booking = await booking_service.require_accessible_booking(booking_id, owner, permission="record_payments")

    ledger = PaymentLedgerService(db)
    entry = await ledger.record_entry(
        booking.id,
        amount_pkr=payload.amount_pkr,
        method=payload.method,
        recorded_by=owner,
        note=payload.note,
    )
    await db.refresh(booking)
    return PaymentEntryResponse(
        entry=PaymentEntryOut.model_validate(entry),
        amount_paid=float(booking.amount_paid),
        balance_due=float(booking.balance_due),
    )


@router.get("/bookings/{booking_id}/payment-entries", response_model=list[PaymentEntryOut])
async def list_payment_entries(
    booking_id: uuid.UUID, db: DbSession, settings: AppSettings, user: CurrentUser
) -> list[PaymentEntryOut]:
    booking_service = BookingService(db, settings)
    await booking_service.require_accessible_booking(booking_id, user)
    ledger = PaymentLedgerService(db)
    entries = await ledger.list_for_booking(booking_id)
    return [PaymentEntryOut.model_validate(e) for e in entries]


@router.post(
    "/payment-entries/{entry_id}/reverse",
    response_model=PaymentEntryOut,
    dependencies=[Depends(require_feature("split_payments"))],
)
async def reverse_payment_entry(
    entry_id: uuid.UUID, payload: PaymentEntryReverseIn, db: DbSession, settings: AppSettings, owner: RequireStaffCapable
) -> PaymentEntryOut:
    """Section 32 Part 5: correct a mistaken payment entry. Same accessibility rule as recording one -- a
    venue owner can correct entries on their own bookings only, an admin can correct any -- checked the same
    way `record_payment_entry` above does, via `require_accessible_booking`. Never edits or deletes the
    original row: inserts a reversing entry (see `PaymentLedgerService.reverse_entry`)."""
    entry = await db.get(PaymentEntry, entry_id)
    if entry is None:
        raise AppError(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Payment entry not found")
    booking_service = BookingService(db, settings)
    await booking_service.require_accessible_booking(entry.booking_id, owner, permission="record_payments")

    ledger = PaymentLedgerService(db)
    reversal = await ledger.reverse_entry(entry_id, actor=owner, reason=payload.reason)
    return PaymentEntryOut.model_validate(reversal)
