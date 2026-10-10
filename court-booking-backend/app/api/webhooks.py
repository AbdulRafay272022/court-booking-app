import hashlib
import hmac
import re
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.dependencies import AppSettings, DbSession
from app.models.booking import Booking, BookingSource, BookingStatus
from app.models.court import Court
from app.models.message import Message
from app.models.user import User
from app.models.venue import Venue
from app.services.ai_chat_service import AIChatService, explicit_proposal_data, is_plain_affirmative
from app.services.booking_service import BookingService, booking_source_ctx
from app.services.notification_service import NotificationService
from app.services.payment_service import PaymentService
from app.services.reply_text import looks_like_roman_urdu, payment_proof_reply
from app.services.venue_service import VenueService
from app.services.whatsapp_service import WhatsAppService, mask_phone
from app.utils.timezone import format_duration, format_pkr, format_pkt_slot

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


# A bare "yes" only confirms a proposal made in the message right before it, that stated the exact slot, and only for
# PROPOSAL_MAX_AGE (see ai_chat_service.explicit_proposal_data); the plain-affirmative test is shared with the in-app chat.
_is_plain_affirmative = is_plain_affirmative


def _confirm_button_id(court_id: str, starts_at: str, slot_count: int = 1) -> str:
    """`confirm:<court_id>:<starts_at>` (one slot) or `confirm:<court_id>:<starts_at>|x<slot_count>`. The
    suffix is only added for a longer booking so buttons already in players' chats keep working."""
    base = f"confirm:{court_id}:{starts_at}"
    return base if slot_count == 1 else f"{base}|x{slot_count}"


async def _pending_confirmation(db: DbSession, user: User) -> tuple[str, str, int] | None:
    """(court_id, starts_at, slot_count) if the assistant's immediately preceding message proposed a booking
    (its `confirm_booking` action is stored in the message's metadata) and the player has said
    nothing since except the message being handled now. WhatsApp never renders the assistant's
    buttons as text, so a typed "yes" is the normal way to answer -- and the model itself cannot
    resolve it: chat history is plain text, so it has no memory of WHICH slot was proposed."""
    rows = (
        (
            await db.execute(
                select(Message)
                .where(Message.sender_id == user.id, Message.channel == "whatsapp")
                .order_by(Message.created_at.desc())
                .limit(2)
            )
        )
        .scalars()
        .all()
    )
    if len(rows) < 2 or rows[0].sender_type != "player" or rows[1].sender_type != "ai":
        return None
    # Only a proposal whose own text stated the exact slot (label), and that is still recent, may be booked by a bare
    # "yes"; anything else (older, unstated, no label stored) goes to the assistant to re-state the exact time.
    data = explicit_proposal_data(rows[1])
    if data is not None:
        return data["court_id"], data["starts_at"], int(data.get("slot_count") or 1)
    return None


async def _proposed_player_name(
    db: DbSession, user: User, court_id: str, starts_at: str
) -> tuple[str | None, bool]:
    """(name, name_is_players_own) the player gave for the slot the assistant proposed (its `confirm_booking` action carries
    `player_name` and `name_is_players_own`), found by court + start among the most recent assistant messages -- the Yes
    button id itself only holds the slot. (None, False) when no name was given, so the hold uses the account's own name.
    The proposal only RECORDS the intent; the name is saved on the account when the hold is created (create_hold)."""
    rows = (
        (
            await db.execute(
                select(Message)
                .where(Message.sender_id == user.id, Message.channel == "whatsapp", Message.sender_type == "ai")
                .order_by(Message.created_at.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    try:
        wanted = datetime.fromisoformat(starts_at)
    except ValueError:
        return None, False
    for row in rows:
        for action in (row.meta or {}).get("actions") or []:
            data = action.get("data") or {}
            if action.get("type") != "confirm_booking" or data.get("court_id") != court_id:
                continue
            try:
                if datetime.fromisoformat(data["starts_at"]) == wanted:
                    name = data.get("player_name") or None
                    return name, bool(name and data.get("name_is_players_own"))
            except (KeyError, ValueError):
                continue
    return None, False


async def _handle_text(db: DbSession, settings: AppSettings, user: User, text: str) -> None:
    if _is_plain_affirmative(text):
        pending = await _pending_confirmation(db, user)
        if pending is not None:
            court_id, starts_at, slot_count = pending
            await _handle_button_reply(db, settings, user, _confirm_button_id(court_id, starts_at, slot_count))
            return

    chat_service = AIChatService(db, settings)
    history = await chat_service.load_history(user, "whatsapp")
    result = await chat_service.process_message(user=user, message=text, history=history, channel="whatsapp")

    whatsapp = WhatsAppService(settings)
    # A direct reply to an inbound message is always inside the 24h window by
    # definition, so this is always free text / buttons, never a template.
    sent = None
    confirm = next((a for a in result.actions if a.type == "confirm_booking"), None)
    if confirm is not None:
        # The assistant proposed a booking: send real Yes/No buttons. These were always meant to
        # exist (system prompt rule 1) but this handler used to send only `result.reply` as plain
        # text, so players saw a question with nothing to tap and typed "yes" into a void.
        try:
            sent = await whatsapp.send_buttons(
                user.phone,
                result.reply,
                [
                    (
                        _confirm_button_id(confirm.data["court_id"], confirm.data["starts_at"], int(confirm.data.get("slot_count") or 1)),
                        confirm.label,
                    ),
                    ("decline", "No, thanks"),
                ],
            )
        except Exception:  # noqa: BLE001 -- fall back to plain text; a typed "yes" still works
            logger.warning("webhooks.whatsapp.buttons_failed", exc_info=True)
    if sent is None:
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

    recent_player_texts = (
        await db.scalars(
            select(Message.content)
            .where(Message.sender_id == user.id, Message.channel == "whatsapp", Message.sender_type == "player", Message.message_type == "text")
            .order_by(Message.created_at.desc())
            .limit(6)
        )
    ).all()
    reply = payment_proof_reply(
        payment.ocr_verdict, booked=booking.status == BookingStatus.BOOKED, roman_urdu=looks_like_roman_urdu(list(recent_player_texts))
    )

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
            slot_count: int | None = None  # no suffix = the court's minimum booking (30-minute grid, Part 4c)
            if "|x" in starts_at_str:
                starts_at_str, count_str = starts_at_str.rsplit("|x", 1)
                slot_count = int(count_str)
            booking_service = BookingService(db, settings)
            proposed_name, name_is_own = await _proposed_player_name(db, user, court_id_str, starts_at_str)
            booking = await booking_service.create_hold(
                user,
                uuid.UUID(court_id_str),
                datetime.fromisoformat(starts_at_str),
                slot_count,
                proposed_name,
                name_is_own=name_is_own,
            )
            court = await db.get(Court, booking.court_id)
            venue = await db.get(Venue, court.venue_id) if court else None
            where = f"{court.name} at {venue.name}, " if court and venue else ""
            lines = [
                f"Held! {where}{format_pkt_slot(booking.starts_at, booking.ends_at)} (Pakistan time).",
                f"Total {format_pkr(float(booking.price))} for "
                f"{format_duration(int((booking.ends_at - booking.starts_at).total_seconds() // 60))}.",
                f"Please pay {format_pkr(float(booking.advance_amount))} within "
                f"{settings.BOOKING_HOLD_MINUTES} minutes to confirm:",
            ]
            # Say WHERE to pay: this reply used to stop at "send your payment screenshot" with no bank.
            bank = VenueService(db, settings).decrypted_bank_details(venue) if venue else None
            for label, key in (("Bank", "bank"), ("Account title", "account_title"), ("Account number", "account_number"), ("IBAN", "iban")):
                if bank and bank.get(key):
                    lines.append(f"{label}: {bank[key]}")
            lines.append("Then send your payment screenshot here.")
            reply = "\n".join(lines)
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

    # Delivery-status callbacks for messages we sent. Logged only (no DB
    # write, no behavior change): this is where a send that Meta accepted
    # with HTTP 200 later turns out to have failed (e.g. 131047, window
    # closed) -- previously these were dropped on the floor, which is why an
    # OTP that never arrived left no trace.
    for update in WhatsAppService.parse_status_updates(payload):
        log = logger.warning if update["status"] == "failed" else logger.info
        log(
            "whatsapp.status",
            wamid=update["message_id"],
            status=update["status"],
            to=mask_phone(update["recipient"]),
            errors=update["errors"] or None,
        )

    messages = WhatsAppService.parse_inbound_messages(payload)
    # Every hold made while handling a WhatsApp message (button reply or the AI's hold tool) is recorded as
    # source=whatsapp, so the owner can see how a booking was made.
    source_token = booking_source_ctx.set(BookingSource.WHATSAPP)
    try:
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
    finally:
        booking_source_ctx.reset(source_token)

    return {"status": "received"}
