import hashlib
import hmac
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.dependencies import AppSettings, DbSession
from app.models.booking import Booking, BookingSource, BookingStatus, CancelledBy
from app.models.court import Court
from app.models.message import Message
from app.models.user import User
from app.models.venue import Venue
from app.services.ai_chat_service import AIChatService, explicit_proposal_data, is_plain_affirmative
from app.errors import AppError, ErrorCode
from app.services.booking_service import BookingService, booking_source_ctx
from app.services.venue_timers import hold_minutes_for
from app.services.chat_fallbacks import MUTATING_TOOLS, newer_text_exists, player_language, run_turn
from app.services.chat_lock import ConversationBusy, conversation_locks
from app.services.entitlement_service import EntitlementService
from app.services.notification_service import NotificationService
from app.services.payment_service import PaymentService
from app.services.chat_language import Lang
from app.services.reply_text import (
    BANK_LABELS,
    busy_message,
    declined_message,
    decline_button_title,
    generic_failure,
    held_message,
    held_where,
    hold_failed_message,
    image_download_failed_message,
    late_payment_proof_message,
    no_pending_booking_message,
    payment_proof_reply,
)
from app.services.venue_service import VenueService
from app.services.whatsapp_service import WhatsAppService, mask_phone
from app.utils.timezone import format_pkt_slot

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
        # Two first messages from a new number can arrive together (a webhook retry, or the player typing fast): the
        # unique phone constraint decides who creates the row; the loser reads it instead of failing the whole delivery.
        try:
            async with db.begin_nested():
                user = User(phone=phone)
                db.add(user)
                await db.flush()
        except IntegrityError:
            user = await db.scalar(select(User).where(User.phone == phone))
            if user is None:
                raise
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


async def _recently_expired_hold(db: DbSession, user: User) -> Booking | None:
    """Owner Round 2 (B1): the player's most recent hold that the system released because its time ran out, within
    the last 2 hours -- a screenshot sent for it now is a LATE proof (kept for the owner, player told), not lost."""
    since = datetime.now(timezone.utc) - timedelta(hours=2)
    result = await db.execute(
        select(Booking)
        .where(
            Booking.player_id == user.id,
            Booking.status == BookingStatus.CANCELLED,
            Booking.cancelled_by == CancelledBy.SYSTEM,
            Booking.cancellation_reason == "hold_expired",
            Booking.updated_at >= since,
        )
        .order_by(Booking.updated_at.desc())
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


@dataclass(frozen=True)
class _Inbound:
    """The player's message being handled, as recorded: used to tell whether a newer text arrived while we worked."""

    id: uuid.UUID
    created_at: datetime


async def _reply_text(db: DbSession, whatsapp: WhatsAppService, user: User, phone: str, text: str, meta: dict | None = None) -> None:
    """Send a plain text reply and record it."""
    sent = await whatsapp.send_text(phone, text)
    await _record_message(db, user=user, sender_type="ai", content=text, whatsapp_msg_id=(sent.get("messages") or [{}])[0].get("id"), meta=meta)
    await db.commit()


async def _held_reply(db: DbSession, settings: AppSettings, booking: Booking, lang: Lang) -> str:
    """The "Held!" message for a booking just held: venue, court, slot, total, what to pay within how long, and WHERE to pay."""
    court = await db.get(Court, booking.court_id)
    venue = await db.get(Venue, court.venue_id) if court else None
    bank = VenueService(db, settings).decrypted_bank_details(venue) if venue else None
    return held_message(
        lang,
        where=held_where(lang, court.name if court else None, venue.name if venue else None),
        slot_label=format_pkt_slot(booking.starts_at, booking.ends_at),
        total=float(booking.price),
        duration_minutes=int((booking.ends_at - booking.starts_at).total_seconds() // 60),
        advance=float(booking.advance_amount),
        hold_minutes=hold_minutes_for(venue),  # Round 2 Stage 2: the venue's own hold length
        bank_lines=[(label, str(bank[key])) for label, key in BANK_LABELS if bank and bank.get(key)],
    )


async def _booking_held_since(db: DbSession, user_id: uuid.UUID, since: datetime) -> Booking | None:
    """A hold this player got after `since` (database clock): if a turn failed after the hold tool ran, the player must still be told."""
    return (
        await db.execute(
            select(Booking)
            .where(Booking.player_id == user_id, Booking.status == BookingStatus.HELD, Booking.created_at >= since)
            .order_by(Booking.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _handle_text(db: DbSession, settings: AppSettings, user: User, text: str, inbound: _Inbound | None = None) -> None:
    # Captured now: after a failed turn the session is rolled back and `user`'s attributes must be refreshed before use.
    user_id, phone = user.id, user.phone
    lang = await player_language(db, user_id, "whatsapp")

    if _is_plain_affirmative(text):
        pending = await _pending_confirmation(db, user)
        if pending is not None:
            court_id, starts_at, slot_count = pending
            await _handle_button_reply(db, settings, user, _confirm_button_id(court_id, starts_at, slot_count))
            return

    chat_service = AIChatService(db, settings)
    history = await chat_service.load_history(user, "whatsapp")
    # The message being answered was recorded before this turn, so history already ends with it and process_message adds it again.
    if history and history[-1] == {"role": "user", "content": text}:
        history = history[:-1]
    # now() is this transaction's start on the database clock: any hold made during the turn has a created_at at or after it
    # (a hold made in an earlier, already committed transaction is older), and it is the same clock bookings are stamped with.
    turn_started = await db.scalar(select(func.now()))
    outcome = await run_turn(chat_service, db, user=user, message=text, history=history, channel="whatsapp", lang=lang)
    result = outcome.result
    mutated = any(t in MUTATING_TOOLS for t in (getattr(result, "tool_calls", None) or []))

    if outcome.failed:
        try:
            await db.refresh(user)
        except Exception:  # noqa: BLE001
            logger.warning("webhooks.whatsapp.user_refresh_failed", exc_info=True)
        # The model or a tool failed. If it got as far as holding a slot, the player must hear about the hold, not "try again".
        held = await _booking_held_since(db, user_id, turn_started) if turn_started else None
        if held is not None:
            mutated = True
            result = type(result)(reply=await _held_reply(db, settings, held, lang), model=None)

    # A newer text from the same player means this answer is about stale words: the newer message is answered (with this one
    # in its history) instead. Never drop an answer that carries a change (a hold or a cancellation).
    if inbound is not None and not mutated and await newer_text_exists(db, user_id, "whatsapp", inbound.created_at):
        logger.info("webhooks.whatsapp.stale_reply_dropped", inbound_id=str(inbound.id), failed=outcome.failed)
        return

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
                phone,
                result.reply,
                [
                    (
                        _confirm_button_id(confirm.data["court_id"], confirm.data["starts_at"], int(confirm.data.get("slot_count") or 1)),
                        confirm.label,
                    ),
                    ("decline", decline_button_title(lang)),
                ],
            )
        except Exception:  # noqa: BLE001 -- fall back to plain text; a typed "yes" still works
            logger.warning("webhooks.whatsapp.buttons_failed", exc_info=True)
    if sent is None:
        sent = await whatsapp.send_text(phone, result.reply)
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
            **({"fallback": True} if outcome.failed else {}),
            **(getattr(result, "meta", None) or {}),  # why the reply check rejected or repaired a draft (meta.validator)
        },
    )
    await db.commit()


async def _handle_image(db: DbSession, settings: AppSettings, user: User, image_id: str, mime_type: str | None) -> None:
    whatsapp = WhatsAppService(settings)
    phone = user.phone
    lang = await player_language(db, user.id, "whatsapp")
    booking = await _most_recent_held_booking(db, user) or await _recently_expired_hold(db, user)
    if booking is None:
        await _reply_text(db, whatsapp, user, phone, no_pending_booking_message(lang))
        return

    media = await whatsapp.download_media(image_id)
    if media is None:
        await _reply_text(db, whatsapp, user, phone, image_download_failed_message(lang))
        return

    proof_bytes, content_type = media
    payment_service = PaymentService(db, settings)
    try:
        payment = await payment_service.submit_payment(
            booking, proof_bytes=proof_bytes, filename="whatsapp-proof.jpg", content_type=content_type or mime_type or "image/jpeg"
        )
    except AppError as exc:
        if exc.code != ErrorCode.HOLD_EXPIRED:
            raise
        await _reply_text(db, whatsapp, user, phone, late_payment_proof_message(lang))
        return
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

    reply = payment_proof_reply(payment.ocr_verdict, booked=booking.status == BookingStatus.BOOKED, roman_urdu=lang == "ru")
    await _reply_text(db, whatsapp, user, phone, reply, meta={"payment_id": str(payment.id), "ocr_verdict": payment.ocr_verdict})


async def _handle_phase3_button(db: DbSession, settings: AppSettings, user: User, button_id: str, lang: str) -> None:
    """audit 2026-10-28 Phase 3 item 8: quick-reply buttons on the khelo_* templates / in-window messages.
    `short:<claim_id>:yes|no` answers "Total X, diye Y, baqi Z"; `noshow:<booking_id>` is "Main aaya tha"."""
    from app.services import phase3_service as p3

    whatsapp = WhatsAppService(settings)
    ru = lang == "ru"
    try:
        if button_id.startswith("short:"):
            _p, claim_id, answer = button_id.split(":", 2)
            await p3.reply_short(db, settings, user, uuid.UUID(claim_id), "yes" if answer == "yes" else "no", None)
            text = (
                ("Shukriya! Jawab mil gaya, 5 points mile." if answer == "yes" else
                 "Shukriya! Aap ka jawab venue ko bhej diya. Wajah likhni ho to app mein booking kholein. 5 points mile.")
                if ru else
                ("Thanks! Got it, 5 points added." if answer == "yes" else
                 "Thanks! We sent your answer to the venue. To add a reason, open the booking in the app. 5 points added.")
            )
        else:
            _p, booking_id = button_id.split(":", 1)
            await p3.reply_noshow(db, settings, user, uuid.UUID(booking_id), None)
            text = "Shukriya! Venue ko bata diya ke aap aaye the." if ru else "Thanks! We told the venue you were there."
    except AppError as exc:
        await db.rollback()
        text = str(exc.detail)
    except ValueError:
        text = generic_failure(lang)
    await _reply_text(db, whatsapp, user, user.phone, text)


async def _handle_button_reply(db: DbSession, settings: AppSettings, user: User, button_id: str | None) -> None:
    """Handles a tap on a `propose_booking_confirmation` action surfaced in a
    prior AI reply. Button IDs are `confirm:<court_id>:<starts_at>` or
    `decline`, matching what the in-app/WhatsApp client is given back in
    `actions` (Section 10.3)."""
    whatsapp = WhatsAppService(settings)
    phone = user.phone
    lang = await player_language(db, user.id, "whatsapp")

    if not button_id or button_id == "decline":
        await _reply_text(db, whatsapp, user, phone, declined_message(lang))
        return

    if button_id.startswith(("short:", "noshow:")):
        await _handle_phase3_button(db, settings, user, button_id, lang)
        return

    if not button_id.startswith("confirm:"):
        # An id this build never made (an old or foreign button): say something, never go silent.
        logger.warning("webhooks.whatsapp.unknown_button", button_id=button_id[:80])
        await _reply_text(db, whatsapp, user, phone, generic_failure(lang))
        return

    try:
        _prefix, court_id_str, starts_at_str = button_id.split(":", 2)
        slot_count: int | None = None  # no suffix = the court's minimum booking (30-minute grid, Part 4c)
        if "|x" in starts_at_str:
            starts_at_str, count_str = starts_at_str.rsplit("|x", 1)
            slot_count = int(count_str)
        booking_service = BookingService(db, settings)
        if not await EntitlementService(db, settings).court_entitled(uuid.UUID(court_id_str), "ai_chat_booking"):
            raise AppError(
                status.HTTP_403_FORBIDDEN,
                ErrorCode.PREMIUM_FEATURE_REQUIRED,
                "booking through chat is not available for this venue, please book it in the Khelo app",
            )
        proposed_name, name_is_own = await _proposed_player_name(db, user, court_id_str, starts_at_str)
        booking = await booking_service.create_hold(
            user,
            uuid.UUID(court_id_str),
            datetime.fromisoformat(starts_at_str),
            slot_count,
            proposed_name,
            name_is_own=name_is_own,
        )
        reply = await _held_reply(db, settings, booking, lang)
    except (ValueError, HTTPException) as exc:
        # The code (not the exception's English text) picks the localized wording.
        reply = hold_failed_message(lang, getattr(exc, "code", None))
    except Exception:  # noqa: BLE001 -- a bug or a database error while holding must not become silence or a stack trace
        logger.error("webhooks.whatsapp.hold_failed", exc_info=True)
        await db.rollback()
        await db.refresh(user)
        reply = hold_failed_message(lang)
    await _reply_text(db, whatsapp, user, phone, reply)


async def _process_inbound(db: DbSession, settings: AppSettings, msg: dict) -> None:
    """One inbound WhatsApp message, exactly once and in order.

    1. The message row is inserted and committed FIRST. The unique index on `messages.whatsapp_msg_id` makes a second delivery of
       the same message id (Meta retries, even while the first is still being processed) fail its insert, and that delivery stops.
    2. Then it waits for its turn in the player's conversation (`chat_lock`, in-process: single uvicorn worker, see that module).
    3. A text that has been overtaken by a newer text while it waited is not answered on its own: the newer one is, with this one
       in its history. Buttons and images are never skipped.
    Any failure after step 1 gives the player a short localized message and still returns normally (a 500 would make Meta
    retry, and the retry would be dropped as a duplicate anyway)."""
    user = await _find_or_create_guest(db, msg["phone_number"])
    user_id, phone = user.id, user.phone

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
        # Duplicate delivery (webhook retry) -- already processed or being processed by the first delivery.
        logger.info("webhooks.whatsapp.duplicate_delivery_skipped", wamid=msg["message_id"])
        return

    created_at = await db.scalar(select(Message.created_at).where(Message.id == recorded.id))
    inbound = _Inbound(id=recorded.id, created_at=created_at)
    is_text = msg["type"] == "text" and bool(msg["text"])

    try:
        async with conversation_locks.hold(("whatsapp", user_id)):
            if is_text and await newer_text_exists(db, user_id, "whatsapp", inbound.created_at):
                logger.info("webhooks.whatsapp.superseded_text_skipped", inbound_id=str(inbound.id))
                return
            if is_text:
                await _handle_text(db, settings, user, msg["text"], inbound)
            elif msg["type"] == "image" and msg.get("image_id"):
                await _handle_image(db, settings, user, msg["image_id"], msg.get("image_mime_type"))
            elif msg["type"] in ("interactive", "button"):
                await _handle_button_reply(db, settings, user, msg.get("button_id"))
    except ConversationBusy:
        await _best_effort_notice(db, settings, user_id, phone, busy_message)
    except Exception:  # noqa: BLE001 -- the player must hear something, and Meta must get its 200
        logger.error("webhooks.whatsapp.message_failed", wamid=msg["message_id"], exc_info=True)
        await _best_effort_notice(db, settings, user_id, phone, generic_failure)


async def _best_effort_notice(db: DbSession, settings: AppSettings, user_id: uuid.UUID, phone: str, template) -> None:
    """Send a short fixed notice after something went wrong; never raises."""
    try:
        await db.rollback()
        lang = await player_language(db, user_id, "whatsapp")
        text = template(lang)
        sent = await WhatsAppService(settings).send_text(phone, text)
        db.add(
            Message(
                sender_id=user_id,
                sender_type="ai",
                channel="whatsapp",
                content=text,
                whatsapp_msg_id=(sent.get("messages") or [{}])[0].get("id"),
                meta={"fallback": True},
            )
        )
        await db.commit()
    except Exception:  # noqa: BLE001
        logger.error("webhooks.whatsapp.notice_failed", exc_info=True)


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
            await _process_inbound(db, settings, msg)
    finally:
        booking_source_ctx.reset(source_token)

    return {"status": "received"}
