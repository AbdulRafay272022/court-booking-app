import hashlib
import hmac
import uuid
from datetime import datetime

import structlog
from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.dependencies import AppSettings, DbSession
from app.models.booking import Booking, BookingStatus
from app.models.court import Court
from app.models.message import Message
from app.models.user import User
from app.models.venue import Venue
from app.services.ai_chat_service import AIChatService
from app.services.booking_service import BookingService
from app.services.notification_service import NotificationService
from app.services.payment_service import PaymentService
from app.services.whatsapp_service import WhatsAppService

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _verify_whatsapp_signature(settings: AppSettings, raw_body: bytes, signature_header: str | None) -> bool:
    """Verifies Meta's X-Hub-Signature-256: HMAC-SHA256 of the raw request
    body, keyed with the app secret, compared constant-time. Without this,
    the POST handler has zero authentication of the sender -- anyone who
    finds the (predictable) webhook URL can forge a Meta-shaped payload
    claiming to be from any phone number (AUDIT_FINDINGS.md finding #1).

    No WHATSAPP_APP_SECRET configured: skip verification in DEBUG (local
    dev has no real Meta app to sign with) but refuse everything otherwise
    -- an unconfigured secret must never silently mean "accept anything" in
    anything resembling production."""
    if not settings.WHATSAPP_APP_SECRET:
        if settings.DEBUG:
            logger.warning("webhooks.whatsapp.signature_check_skipped_no_secret")
            return True
        return False
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(settings.WHATSAPP_APP_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    provided = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, provided)


@router.get("/whatsapp")
async def verify_whatsapp_webhook(request: Request, settings: AppSettings) -> Response:
    mode = request.query_params.get("hub.mode", "")
    token = request.query_params.get("hub.verify_token", "")
    challenge = request.query_params.get("hub.challenge", "")

    result = WhatsAppService(settings).verify_webhook_challenge(mode, token, challenge)
    if result is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verification failed")
    return Response(content=result, media_type="text/plain")


async def _find_or_create_guest(db: DbSession, phone: str) -> User:
    """WhatsApp is the identity: a phone number that owns the number it's
    messaging from is treated as verified, so there's no OTP step here --
    same convention as section 9.1 ("guest booking: phone is identity")."""
    user = await db.scalar(select(User).where(User.phone == phone))
    if user is None:
        user = User(phone=phone)
        db.add(user)
        await db.flush()
    return user


async def _record_message(
    db: DbSession,
    *,
    user: User,
    sender_type: str,
    content: str,
    message_type: str = "text",
    whatsapp_msg_id: str | None = None,
    meta: dict | None = None,
) -> Message | None:
    """Returns None (without raising) if whatsapp_msg_id has already been
    recorded -- the unique index on messages.whatsapp_msg_id is what actually
    guards against a webhook delivering the same message twice, not an
    application-level check."""
    record = Message(
        sender_id=user.id,
        sender_type=sender_type,
        channel="whatsapp",
        content=content,
        message_type=message_type,
        whatsapp_msg_id=whatsapp_msg_id,
        meta=meta,
    )
    db.add(record)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return None
    return record


async def _most_recent_held_booking(db: DbSession, user: User) -> Booking | None:
    result = await db.execute(
        select(Booking)
        .where(Booking.player_id == user.id, Booking.status == BookingStatus.HELD)
        .order_by(Booking.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _handle_text(db: DbSession, settings: AppSettings, user: User, text: str) -> None:
    chat_service = AIChatService(db, settings)
    history = await chat_service.load_history(user, "whatsapp")
    result = await chat_service.process_message(user=user, message=text, history=history)

    whatsapp = WhatsAppService(settings)
    # A direct reply to an inbound message is always inside the 24h window by
    # definition, so this is always free text, never a template.
    sent = await whatsapp.send_text(user.phone, result.reply)
    await _record_message(
        db,
        user=user,
        sender_type="ai",
        content=result.reply,
        whatsapp_msg_id=(sent.get("messages") or [{}])[0].get("id"),
        meta={
            "model": result.model,
            "tool_calls": result.tool_calls,
            "actions": [a.__dict__ for a in result.actions],
        },
    )
    await db.commit()


async def _handle_image(db: DbSession, settings: AppSettings, user: User, image_id: str, mime_type: str | None) -> None:
    whatsapp = WhatsAppService(settings)
    booking = await _most_recent_held_booking(db, user)
    if booking is None:
        reply = "I don't see a pending booking waiting for payment. Hold a slot first, then send your payment screenshot here."
        sent = await whatsapp.send_text(user.phone, reply)
        await _record_message(db, user=user, sender_type="ai", content=reply, whatsapp_msg_id=(sent.get("messages") or [{}])[0].get("id"))
        await db.commit()
        return

    media = await whatsapp.download_media(image_id)
    if media is None:
        reply = "I couldn't download that image -- could you try sending it again?"
        sent = await whatsapp.send_text(user.phone, reply)
        await _record_message(db, user=user, sender_type="ai", content=reply, whatsapp_msg_id=(sent.get("messages") or [{}])[0].get("id"))
        await db.commit()
        return

    proof_bytes, content_type = media
    payment_service = PaymentService(db, settings)
    payment = await payment_service.submit_payment(
        booking, proof_bytes=proof_bytes, filename="whatsapp-proof.jpg", content_type=content_type or mime_type or "image/jpeg"
    )
    await db.refresh(booking)

    if booking.status == BookingStatus.PAYMENT_SUBMITTED:
        # Mirrors what POST /bookings/{id}/payment-proof does -- this webhook
        # path calls payment_service directly, bypassing that HTTP handler.
        court = await db.get(Court, booking.court_id)
        if court is not None:
            venue = await db.get(Venue, court.venue_id)
            owner = await db.get(User, venue.owner_id) if venue else None
            if owner is not None:
                await NotificationService(db, settings).notify_payment_submitted(
                    owner=owner,
                    court_name=court.name,
                    amount=float(payment.amount_claimed or 0),
                    booking_id=booking.id,
                    ocr_verdict=payment.ocr_verdict,
                )

    verdict_text = {
        "match": "✅ The amount matches what's expected.",
        "mismatch": "⚠️ The amount doesn't quite match what's expected -- the owner will take a closer look.",
        "unreadable": "I couldn't read the amount clearly, but I've passed it to the venue owner to verify.",
    }.get(payment.ocr_verdict, "")
    if booking.status == BookingStatus.BOOKED:
        reply = f"Got it, thanks! {verdict_text} Your booking is confirmed. \U0001f389"
    else:
        reply = f"Got it, thanks! {verdict_text} The venue owner will review and confirm shortly."

    sent = await whatsapp.send_text(user.phone, reply)
    await _record_message(
        db,
        user=user,
        sender_type="ai",
        content=reply,
        whatsapp_msg_id=(sent.get("messages") or [{}])[0].get("id"),
        meta={"payment_id": str(payment.id), "ocr_verdict": payment.ocr_verdict},
    )
    await db.commit()


async def _handle_button_reply(db: DbSession, settings: AppSettings, user: User, button_id: str | None) -> None:
    """Handles a tap on a `propose_booking_confirmation` action surfaced in a
    prior AI reply. Button IDs are `confirm:<court_id>:<starts_at>` or
    `decline`, matching what the in-app/WhatsApp client is given back in
    `actions` (Section 10.3)."""
    whatsapp = WhatsAppService(settings)

    if not button_id or button_id == "decline":
        reply = "No problem, let me know if you'd like to look at other times."
        sent = await whatsapp.send_text(user.phone, reply)
        await _record_message(db, user=user, sender_type="ai", content=reply, whatsapp_msg_id=(sent.get("messages") or [{}])[0].get("id"))
        await db.commit()
        return

    if button_id.startswith("confirm:"):
        try:
            _prefix, court_id_str, starts_at_str = button_id.split(":", 2)
            booking_service = BookingService(db, settings)
            booking = await booking_service.create_hold(
                user, uuid.UUID(court_id_str), datetime.fromisoformat(starts_at_str)
            )
            reply = (
                f"Held! PKR {float(booking.advance_amount):,.0f} advance is due within "
                f"{settings.BOOKING_HOLD_MINUTES} minutes to confirm -- send your payment screenshot here."
            )
        except (ValueError, HTTPException) as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else "that slot"
            reply = f"Sorry, I couldn't hold that slot ({detail}). Want to try another time?"
        sent = await whatsapp.send_text(user.phone, reply)
        await _record_message(db, user=user, sender_type="ai", content=reply, whatsapp_msg_id=(sent.get("messages") or [{}])[0].get("id"))
        await db.commit()


@router.post("/whatsapp", status_code=status.HTTP_200_OK)
async def receive_whatsapp_webhook(request: Request, db: DbSession, settings: AppSettings) -> dict:
    raw_body = await request.body()
    if not _verify_whatsapp_signature(settings, raw_body, request.headers.get("x-hub-signature-256")):
        logger.warning("webhooks.whatsapp.signature_verification_failed")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid signature")

    payload = await request.json()
    messages = WhatsAppService.parse_inbound_messages(payload)

    for msg in messages:
        user = await _find_or_create_guest(db, msg["phone_number"])

        inbound_content = msg["text"] or msg.get("button_text") or f"[{msg['type']}]"
        recorded = await _record_message(
            db,
            user=user,
            sender_type="player",
            content=inbound_content,
            message_type=msg["type"] or "text",
            whatsapp_msg_id=msg["message_id"],
        )
        await db.commit()
        if recorded is None:
            # Duplicate delivery (webhook retry) -- already processed.
            continue

        if msg["type"] == "text" and msg["text"]:
            await _handle_text(db, settings, user, msg["text"])
        elif msg["type"] == "image" and msg.get("image_id"):
            await _handle_image(db, settings, user, msg["image_id"], msg.get("image_mime_type"))
        elif msg["type"] in ("interactive", "button"):
            await _handle_button_reply(db, settings, user, msg.get("button_id"))

    return {"status": "received"}
