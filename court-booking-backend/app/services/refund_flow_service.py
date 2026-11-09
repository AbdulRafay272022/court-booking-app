"""fix/nov-9 items 9-12: where the refund goes, the venue's proof of sending it, the player's answer, and "Khelo se shikayat".

Flow
- item 10: the player answers "Refund kahan bhejein?" on an owed refund (JazzCash / Easypaisa number, or bank IBAN + account
  title). Stored on the payment_disputes row, the number ENCRYPTED. Masked (****6789) everywhere; the FULL number only for the
  venue that owes this refund, only while it is owed, and every full view is written to audit_log ("payout.viewed").
- item 11: the venue marks the refund sent (POST /owners/refunds/{id}/mark-refunded, unchanged contract) with a screenshot;
  record_transfer() keeps one refund_transfers row per send and reads the screenshot (same vision call as a payment proof):
  amount and receiver (name or number) against the payout details -> match | mismatch | unreadable | no_screenshot. Both sides
  see the result.
- item 12: the player sees the screenshot, amount and check and answers "Mil gaya" / "Nahi mila". "Nahi mila" goes to the
  venue (it can reply); the player can then take it to Khelo.
- item 9: "Khelo se shikayat karein" after the venue kept a no-show, kept a disputed due, or the player did not get a refund.
  The super admin decides player | venue with a note; both sides hear it. What a decision for the player DOES:
    short_payment -> the due is waived (price = what was paid), as the owner's own "waive";
    refund        -> that transfer is taken back: the amount is owed again (the venue has to send it again);
    no_show       -> the venue's "No-show rakho" is undone, so the owner's "Player sahi hai, no-show hatao" (which asks the
                     real price / received / method) is open again; the money is never guessed here.

Every notification here is written in the receiver's language (users.language).
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

import structlog
from fastapi import status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.audit_phase3 import NoShowReply, ShortPaymentClaim
from app.models.booking import Booking
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.refund_flow import Escalation, RefundTransfer
from app.models.user import User, UserRole
from app.models.venue import Venue
from app.services.lang import pick
from app.utils.encryption import ENCRYPTED_MARKER, decrypt_json, encrypt_json
from app.utils.text import fuzzy_name_match
from app.utils.timezone import format_pkr

logger = structlog.get_logger()

PAYOUT_METHODS = ("jazzcash", "easypaisa", "bank")
METHOD_LABEL = {"jazzcash": "JazzCash", "easypaisa": "Easypaisa", "bank": "Bank"}
ESCALATION_KINDS = ("no_show", "short_payment", "refund")
_IBAN_RE = re.compile(r"^PK\d{2}[A-Z]{4}\d{16}$")
_WALLET_RE = re.compile(r"^03\d{9}$")


def _err(http: int, code: str, message: str) -> AppError:
    return AppError(http, code, message)


def short_code(booking_id: uuid.UUID) -> str:
    return "KH-" + booking_id.hex[:8].upper()


# ------------------------------------------------------------------ payout details (item 10)


def normalize_payout(method: str, account: str, title: str, bank: str | None) -> tuple[str, str, str, str | None]:
    """-> (method, account, title, bank). JazzCash / Easypaisa: a Pakistani mobile number, kept as 03XXXXXXXXX. Bank: an IBAN
    (PK + 22), kept upper-case without spaces. Title: the name on the account (2-100 letters)."""
    method = (method or "").strip().lower()
    if method not in PAYOUT_METHODS:
        raise _err(422, ErrorCode.PAYOUT_INVALID, "Choose JazzCash, Easypaisa or Bank.")
    raw = re.sub(r"[\s\-]", "", account or "").upper()
    if method == "bank":
        if not _IBAN_RE.match(raw):
            raise _err(422, ErrorCode.PAYOUT_INVALID, "Enter a full IBAN: PK, 2 digits, 4 letters, 16 digits (24 characters).")
        acct = raw
    else:
        digits = re.sub(r"\D", "", raw)
        if digits.startswith("92") and len(digits) == 12:
            digits = "0" + digits[2:]
        elif digits.startswith("3") and len(digits) == 10:
            digits = "0" + digits
        if not _WALLET_RE.match(digits):
            raise _err(422, ErrorCode.PAYOUT_INVALID, "Enter the mobile number of the account, e.g. 0300 1234567.")
        acct = digits
    name = " ".join((title or "").split())
    if not (2 <= len(name) <= 100) or not re.search(r"[A-Za-z]", name):
        raise _err(422, ErrorCode.PAYOUT_INVALID, "Enter the account title (the name on the account).")
    bank_name = " ".join((bank or "").split())[:60] or None
    return method, acct, name, (bank_name if method == "bank" else None)


def _encrypt(account: str, settings: Settings) -> str:
    """Raises PAYOUT_STORAGE_UNAVAILABLE (503) when the server has no key: the number is never stored in clear."""
    try:
        return encrypt_json({"account": account}, settings)[ENCRYPTED_MARKER]
    except Exception as exc:  # noqa: BLE001 -- e.g. RuntimeError "key not set"
        logger.error("payout.encrypt_failed", error=type(exc).__name__)
        raise _err(status.HTTP_503_SERVICE_UNAVAILABLE, ErrorCode.PAYOUT_STORAGE_UNAVAILABLE,
                   "Refund details can't be saved right now. Please try again later.") from None


def _decrypt(token: str | None, settings: Settings) -> str | None:
    """The stored number, or None when it cannot be read (the key was lost or rotated without keeping the old one in
    BANK_DETAILS_ENCRYPTION_KEYS_OLD). Never raises: an unreadable number only means the player is asked for it again."""
    if not token:
        return None
    try:
        data = decrypt_json({ENCRYPTED_MARKER: token}, settings) or {}
    except Exception as exc:  # noqa: BLE001 -- InvalidToken, or no key at all
        logger.warning("payout.undecryptable", error=type(exc).__name__)
        return None
    return data.get("account")


def payout_readable(dispute: PaymentDispute, settings: Settings) -> bool:
    return bool(dispute.payout_method) and _decrypt(dispute.payout_account_enc, settings) is not None


def masked(last4: str | None) -> str | None:
    return f"****{last4}" if last4 else None


def payout_out(dispute: PaymentDispute, full: str | None = None) -> dict | None:
    """The payout details as every screen shows them: masked. `full` only from reveal_payout()."""
    if not dispute.payout_method:
        return None
    return {
        "method": dispute.payout_method,
        "method_label": METHOD_LABEL.get(dispute.payout_method, dispute.payout_method),
        "account_masked": masked(dispute.payout_account_last4),
        "account": full,
        "title": dispute.payout_title,
        "bank": dispute.payout_bank,
        "set_at": dispute.payout_set_at,
    }


def remaining_of(dispute: PaymentDispute) -> float:
    owed = float(dispute.refund_amount or 0)
    sent = float(dispute.refunded_amount or 0)
    return round(max(owed - sent, 0.0), 2)


def is_owed(dispute: PaymentDispute) -> bool:
    return dispute.refund_status == "owed" and remaining_of(dispute) > 0.009


async def open_dispute_for(db: AsyncSession, booking_id: uuid.UUID) -> PaymentDispute | None:
    rows = (
        await db.execute(
            select(PaymentDispute).where(PaymentDispute.booking_id == booking_id).order_by(PaymentDispute.created_at.desc())
        )
    ).scalars().all()
    for d in rows:
        if is_owed(d):
            return d
    return rows[0] if rows else None


async def _player_booking(db: AsyncSession, player: User, booking_id: uuid.UUID) -> Booking:
    booking = await db.get(Booking, booking_id)
    if booking is None or booking.player_id != player.id:
        raise _err(status.HTTP_404_NOT_FOUND, ErrorCode.BOOKING_NOT_FOUND, "Booking not found")
    return booking


async def _venue_of(db: AsyncSession, booking: Booking) -> tuple[Court | None, Venue | None]:
    court = await db.get(Court, booking.court_id)
    venue = await db.get(Venue, court.venue_id) if court is not None else None
    return court, venue


async def _notify(db: AsyncSession, settings: Settings, user: User | None, event: str, title: tuple[str, str],
                  body: tuple[str, str], *, reference_id: uuid.UUID | None) -> None:
    """Best effort, in the receiver's language: (ru, en) pairs."""
    if user is None:
        return
    try:
        from app.services.notification_service import NotificationService

        await NotificationService(db, settings)._audit_tier(
            user, event, pick(user, *title), pick(user, *body), reference_id=reference_id,
            template_name="generic_notification", template_params=[pick(user, *body)],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("refund_flow.notify_failed", event=event, error=type(exc).__name__)


async def _owner_of(db: AsyncSession, venue: Venue | None) -> User | None:
    return await db.get(User, venue.owner_id) if venue is not None else None


async def set_payout(
    db: AsyncSession, settings: Settings, player: User, booking_id: uuid.UUID, *, method: str | None, account: str | None,
    title: str | None, bank: str | None, use_previous: bool = False,
) -> PaymentDispute:
    booking = await _player_booking(db, player, booking_id)
    dispute = await open_dispute_for(db, booking.id)
    if dispute is None or not is_owed(dispute):
        raise _err(status.HTTP_409_CONFLICT, ErrorCode.REFUND_NOT_OWED, "There is no open refund on this booking.")
    if use_previous:
        prev = (
            await db.execute(
                select(PaymentDispute)
                .join(Booking, Booking.id == PaymentDispute.booking_id)
                .where(Booking.player_id == player.id, PaymentDispute.payout_method.is_not(None), PaymentDispute.id != dispute.id)
                .order_by(PaymentDispute.payout_set_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if prev is None or _decrypt(prev.payout_account_enc, settings) is None:
            raise _err(422, ErrorCode.PAYOUT_INVALID, "No earlier refund account to reuse. Please type the account.")
        dispute.payout_method, dispute.payout_account_enc = prev.payout_method, prev.payout_account_enc
        dispute.payout_account_last4, dispute.payout_title, dispute.payout_bank = (
            prev.payout_account_last4, prev.payout_title, prev.payout_bank,
        )
    else:
        m, acct, name, bank_name = normalize_payout(method or "", account or "", title or "", bank)
        dispute.payout_method, dispute.payout_account_enc = m, _encrypt(acct, settings)
        dispute.payout_account_last4, dispute.payout_title, dispute.payout_bank = acct[-4:], name, bank_name
    first = dispute.payout_set_at is None
    dispute.payout_set_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(dispute)
    court, venue = await _venue_of(db, booking)
    owner = await _owner_of(db, venue)
    code = short_code(booking.id)
    label = f"{METHOD_LABEL[dispute.payout_method]} {masked(dispute.payout_account_last4)}"
    await _notify(
        db, settings, owner, "owner_refund_payout",
        ("Refund ka account mil gaya", "Refund account received"),
        (
            f"Booking {code}: player ne refund ke liye {label} ({dispute.payout_title}) diya{'' if first else ' (badla)'}. "
            f"Wapas dena mein poora number dekhein.",
            f"Booking {code}: the player gave {label} ({dispute.payout_title}) for the refund{'' if first else ' (changed)'}. "
            f"See the full number under Refunds.",
        ),
        reference_id=booking.id,
    )
    return dispute


async def previous_payout(db: AsyncSession, player: User, settings: Settings | None = None) -> dict | None:
    """The account the player used last time (masked), so "Pichla account use karein" can be offered."""
    prev = (
        await db.execute(
            select(PaymentDispute)
            .join(Booking, Booking.id == PaymentDispute.booking_id)
            .where(Booking.player_id == player.id, PaymentDispute.payout_method.is_not(None))
            .order_by(PaymentDispute.payout_set_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if prev is None or (settings is not None and _decrypt(prev.payout_account_enc, settings) is None):
        return None
    return payout_out(prev)


async def reveal_payout(db: AsyncSession, settings: Settings, actor: User, dispute_id: uuid.UUID) -> dict:
    """The FULL number, for the venue that owes this refund, while it is owed. Every call is audited."""
    from app.services.audit_service import AuditService
    from app.services.booking_service import BookingService

    dispute = await db.get(PaymentDispute, dispute_id)
    if dispute is None:
        raise _err(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Refund not found")
    if actor.role == UserRole.ADMIN:
        # Khelo's admin is not the venue that owes the money: masked only (the rule is "only the venue that owes it")
        raise _err(status.HTTP_403_FORBIDDEN, ErrorCode.PAYOUT_NOT_VISIBLE, "Only the venue that owes this refund sees the full number.")
    await BookingService(db, settings).require_accessible_booking(dispute.booking_id, actor, permission="mark_refunds")
    if not dispute.payout_method:
        raise _err(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "The player has not said where to send the refund yet.")
    if not is_owed(dispute):
        raise _err(status.HTTP_403_FORBIDDEN, ErrorCode.PAYOUT_NOT_VISIBLE, "This refund is no longer owed, so the full number is hidden.")
    full = _decrypt(dispute.payout_account_enc, settings)
    if full is None:
        # the key that wrote it is gone: nothing to show; the player's screen asks for the account again
        raise _err(status.HTTP_409_CONFLICT, ErrorCode.PAYOUT_UNREADABLE,
                   "This account number can't be read any more. The player has been asked to enter it again.")
    await AuditService(db).log(
        actor_user_id=actor.id, actor_type=actor.role.value, action="payout.viewed", entity_type="payment_dispute",
        entity_id=dispute.id, new_value={"method": dispute.payout_method, "last4": dispute.payout_account_last4,
                                         "booking_id": str(dispute.booking_id)},
    )
    await db.commit()
    return payout_out(dispute, full) or {}


# ------------------------------------------------------------------ refund sent + OCR (item 11)


def judge_refund_screenshot(
    *, sent: float, ocr_amount: float | None, ocr_receiver: str | None, payout_title: str | None, payout_account: str | None,
    has_screenshot: bool = True,
) -> tuple[str, list[str]]:
    """-> (verdict, reasons). match = the amount AND the receiver (name or the number's last digits) agree with what the player
    gave; mismatch = something visible disagrees; unreadable = not enough could be read to say."""
    if not has_screenshot:
        return "no_screenshot", []
    reasons: list[str] = []
    if ocr_amount is None:
        reasons.append("amount_not_visible")
    elif abs(float(ocr_amount) - float(sent)) > 1:
        reasons.append("amount")
    if not payout_account and not payout_title:
        reasons.append("no_payout_details")
    elif not ocr_receiver:
        reasons.append("receiver_not_visible")
    else:
        name_ok = fuzzy_name_match(ocr_receiver, payout_title)
        digits = re.sub(r"\D", "", ocr_receiver)
        tail = digits[-4:] if len(digits) >= 4 else digits
        number_ok = bool(payout_account) and len(tail) >= 3 and re.sub(r"\D", "", payout_account or "").endswith(tail)
        if not (name_ok or number_ok):
            reasons.append("receiver")
    if ocr_amount is None and not ocr_receiver:
        return "unreadable", reasons
    if "amount" in reasons or "receiver" in reasons:
        return "mismatch", reasons
    if reasons:
        return "unreadable", reasons
    return "match", reasons


VERDICT_TEXT = {
    "match": ("Check: Match", "Check: Match"),
    "mismatch": ("Check: Farq hai", "Check: Doesn't match"),
    "unreadable": ("Check: screenshot parha nahi gaya", "Check: screenshot could not be read"),
    "no_screenshot": ("Screenshot nahi diya", "No screenshot"),
}


async def record_transfer(
    db: AsyncSession, settings: Settings, actor: User, dispute: PaymentDispute, booking: Booking, *, amount: float,
    reference: str | None, screenshot: tuple[bytes, str] | None, screenshot_key: str | None,
) -> RefundTransfer:
    """One row per "Refund bhej diya" (called right after AdminService.mark_refund_paid committed), the OCR check, and the
    player's notice with "Mil gaya / Nahi mila"."""
    ocr_amount = ocr_receiver = None
    if screenshot is not None:
        try:
            from app.services.entitlement_service import EntitlementService
            from app.services.payment_service import PaymentService

            entitled = await EntitlementService(db, settings).court_entitled(booking.court_id, "ocr_verification")
            extraction = await PaymentService(db, settings)._extract_payment_proof(
                screenshot[0], screenshot[1], amount, entitled=entitled
            )
            ocr_amount, ocr_receiver = extraction.amount, extraction.receiver_name
        except Exception as exc:  # noqa: BLE001 -- a vision failure leaves the check "unreadable", never blocks the record
            logger.warning("refund_flow.ocr_failed", error=type(exc).__name__)
    verdict, reasons = judge_refund_screenshot(
        sent=amount, ocr_amount=ocr_amount, ocr_receiver=ocr_receiver, payout_title=dispute.payout_title,
        payout_account=_decrypt(dispute.payout_account_enc, settings), has_screenshot=screenshot is not None,
    )
    transfer = RefundTransfer(
        dispute_id=dispute.id, booking_id=booking.id, amount=round(float(amount), 2), reference=reference,
        screenshot_key=screenshot_key, sent_by=actor.id, ocr_amount=ocr_amount, ocr_receiver=ocr_receiver,
        ocr_verdict=verdict, ocr_reasons=reasons,
    )
    db.add(transfer)
    await db.commit()
    await db.refresh(transfer)
    player = await db.get(User, booking.player_id) if booking.player_id else None
    code = short_code(booking.id)
    v_ru, v_en = VERDICT_TEXT[verdict]
    await _notify(
        db, settings, player, "refund_paid",
        ("Venue ne refund bhej diya", "The venue sent your refund"),
        (
            f"Booking {code}: venue ne refund bhej diya: {format_pkr(amount)}. {v_ru}. Mil gaya ya nahi? App mein batayein.",
            f"Booking {code}: the venue sent your refund: {format_pkr(amount)}. {v_en}. Did you get it? Tell us in the app.",
        ),
        reference_id=booking.id,
    )
    return transfer


def transfer_out(t: RefundTransfer, *, with_screenshot_url: bool = True) -> dict:
    url = None
    if with_screenshot_url and t.screenshot_key:
        try:
            from app.utils.s3 import signed_private_url

            url = signed_private_url(t.screenshot_key)
        except Exception:  # noqa: BLE001
            url = None
    return {
        "id": t.id, "amount": float(t.amount), "reference": t.reference, "sent_at": t.created_at,
        "screenshot_url": url, "ocr_amount": float(t.ocr_amount) if t.ocr_amount is not None else None,
        "ocr_receiver": t.ocr_receiver, "ocr_verdict": t.ocr_verdict, "ocr_reasons": list(t.ocr_reasons or []),
        "player_response": t.player_response, "player_note": t.player_note, "responded_at": t.responded_at,
        "owner_reply": t.owner_reply, "owner_replied_at": t.owner_replied_at,
        "can_answer": (not t.backfilled) and t.player_response != "received",
    }


async def transfers_for(db: AsyncSession, dispute_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[RefundTransfer]]:
    if not dispute_ids:
        return {}
    rows = (
        await db.execute(
            select(RefundTransfer).where(RefundTransfer.dispute_id.in_(dispute_ids)).order_by(RefundTransfer.created_at)
        )
    ).scalars().all()
    out: dict[uuid.UUID, list[RefundTransfer]] = {}
    for r in rows:
        out.setdefault(r.dispute_id, []).append(r)
    return out


# ------------------------------------------------------------------ the player's answer (item 12)


async def answer_transfer(
    db: AsyncSession, settings: Settings, player: User, transfer_id: uuid.UUID, answer: str, note: str | None
) -> RefundTransfer:
    if answer not in ("received", "not_received"):
        raise _err(422, ErrorCode.VALIDATION_ERROR, "Answer received or not_received.")
    t = await db.get(RefundTransfer, transfer_id)
    booking = await db.get(Booking, t.booking_id) if t is not None else None
    if t is None or booking is None or booking.player_id != player.id:
        raise _err(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Not found")
    if t.backfilled or t.player_response == "received":
        raise _err(status.HTTP_409_CONFLICT, ErrorCode.ALREADY_REVIEWED, "You already answered this.")
    if t.player_response == "not_received" and answer == "not_received":
        raise _err(status.HTTP_409_CONFLICT, ErrorCode.ALREADY_REVIEWED, "You already answered this.")
    t.player_response = answer
    t.player_note = (note or "").strip()[:500] or None
    t.responded_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(t)
    court, venue = await _venue_of(db, booking)
    owner = await _owner_of(db, venue)
    code = short_code(booking.id)
    why_ru = f" Player ne likha: {t.player_note}" if t.player_note else ""
    why_en = f" The player wrote: {t.player_note}" if t.player_note else ""
    if answer == "received":
        await _notify(
            db, settings, owner, "owner_refund_received",
            ("Player ko refund mil gaya", "The player got the refund"),
            (f"Booking {code}: player ne {format_pkr(t.amount)} milne ki tasdeeq ki.",
             f"Booking {code}: the player confirmed getting {format_pkr(t.amount)}."),
            reference_id=booking.id,
        )
    else:
        await _notify(
            db, settings, owner, "owner_refund_not_received",
            ("Player ko refund nahi mila", "The player did not get the refund"),
            (f"Booking {code}: player kehta hai {format_pkr(t.amount)} nahi mila.{why_ru} Apni transfer check karke jawab dein.",
             f"Booking {code}: the player says {format_pkr(t.amount)} did not arrive.{why_en} Check your transfer and reply."),
            reference_id=booking.id,
        )
    return t


async def owner_reply_transfer(db: AsyncSession, settings: Settings, actor: User, transfer_id: uuid.UUID, note: str) -> RefundTransfer:
    from app.services.booking_service import BookingService

    t = await db.get(RefundTransfer, transfer_id)
    if t is None:
        raise _err(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Not found")
    booking = await BookingService(db, settings).require_accessible_booking(t.booking_id, actor, permission="mark_refunds")
    if t.player_response != "not_received":
        raise _err(status.HTTP_409_CONFLICT, ErrorCode.INVALID_BOOKING_STATE, "The player has not said the refund is missing.")
    text = " ".join((note or "").split())[:500]
    if not text:
        raise _err(422, ErrorCode.VALIDATION_ERROR, "Write a reply.")
    t.owner_reply = text
    t.owner_replied_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(t)
    player = await db.get(User, booking.player_id) if booking.player_id else None
    code = short_code(booking.id)
    await _notify(
        db, settings, player, "player_refund_reply",
        ("Venue ka jawab", "The venue replied"),
        (f"Booking {code}: venue ne likha: {text}. Ab bhi nahi mila to app se Khelo ko shikayat karein.",
         f"Booking {code}: the venue wrote: {text}. Still missing? Report it to Khelo from the app."),
        reference_id=booking.id,
    )
    return t


# ------------------------------------------------------------------ escalations (items 9 + 12)


async def _escalation_source(db: AsyncSession, booking: Booking, kind: str) -> uuid.UUID | None:
    """The row a player may take to Khelo, or None when there is nothing the venue refused."""
    if kind == "no_show":
        r = (await db.execute(select(NoShowReply).where(NoShowReply.booking_id == booking.id))).scalar_one_or_none()
        return r.id if r is not None and r.owner_decision == "keep" else None
    if kind == "short_payment":
        c = (await db.execute(select(ShortPaymentClaim).where(ShortPaymentClaim.booking_id == booking.id))).scalar_one_or_none()
        ok = c is not None and c.status == "disputed" and c.owner_decision == "collect" and c.resolved_at is None
        return c.id if ok else None
    if kind == "refund":
        t = (
            await db.execute(
                select(RefundTransfer)
                .where(RefundTransfer.booking_id == booking.id, RefundTransfer.player_response == "not_received")
                .order_by(RefundTransfer.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        return t.id if t is not None else None
    return None


async def _admins(db: AsyncSession) -> list[User]:
    return list((await db.execute(select(User).where(User.role == UserRole.ADMIN, User.is_active.is_(True)))).scalars())


KIND_TEXT = {
    "no_show": ("no-show", "no-show"),
    "short_payment": ("baqi raqam", "amount due"),
    "refund": ("refund", "refund"),
}


async def escalate(db: AsyncSession, settings: Settings, player: User, booking_id: uuid.UUID, kind: str, reason: str | None) -> Escalation:
    if kind not in ESCALATION_KINDS:
        raise _err(422, ErrorCode.VALIDATION_ERROR, "Unknown kind.")
    booking = await _player_booking(db, player, booking_id)
    source_id = await _escalation_source(db, booking, kind)
    if source_id is None:
        raise _err(status.HTTP_409_CONFLICT, ErrorCode.ESCALATION_NOT_ALLOWED, "There is nothing here to report to Khelo yet.")
    court, venue = await _venue_of(db, booking)
    esc = Escalation(
        kind=kind, source_id=source_id, booking_id=booking.id, venue_id=venue.id, player_id=player.id,
        reason=" ".join((reason or "").split())[:1000] or None,
    )
    db.add(esc)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _err(status.HTTP_409_CONFLICT, ErrorCode.ALREADY_ESCALATED, "You already reported this to Khelo.") from None
    await db.refresh(esc)
    code = short_code(booking.id)
    k_ru, k_en = KIND_TEXT[kind]
    why_ru = f" Wajah: {esc.reason}" if esc.reason else ""
    why_en = f" Reason: {esc.reason}" if esc.reason else ""
    await _notify(
        db, settings, player, "player_escalated", ("Shikayat Khelo ko bhej di", "Sent to Khelo"),
        (f"Booking {code}: aap ki {k_ru} ki shikayat Khelo ko mil gayi. Faisla hone par aap ko bataya jayega.",
         f"Booking {code}: Khelo has your {k_en} complaint. We will tell you when it is decided."),
        reference_id=booking.id,
    )
    await _notify(
        db, settings, await _owner_of(db, venue), "owner_escalated", ("Player ne Khelo se shikayat ki", "A player reported to Khelo"),
        (f"Booking {code}: player ne {k_ru} par Khelo se shikayat ki.{why_ru} Khelo dono taraf dekh kar faisla karega.",
         f"Booking {code}: the player reported the {k_en} to Khelo.{why_en} Khelo will look at both sides and decide."),
        reference_id=booking.id,
    )
    for admin in await _admins(db):
        await _notify(
            db, settings, admin, "admin_escalation", ("Nayi shikayat", "New complaint"),
            (f"Booking {code} ({venue.name}): {k_ru} ki shikayat.{why_ru}", f"Booking {code} ({venue.name}): {k_en} complaint.{why_en}"),
            reference_id=booking.id,
        )
    return esc


def escalation_out(e: Escalation | None) -> dict | None:
    if e is None:
        return None
    return {
        "id": e.id, "kind": e.kind, "status": e.status, "reason": e.reason, "admin_decision": e.admin_decision,
        "admin_note": e.admin_note, "created_at": e.created_at, "decided_at": e.decided_at,
    }


async def player_escalations(db: AsyncSession, player: User, booking: Booking) -> list[dict]:
    """For the booking screen: per kind, whether "Khelo se shikayat karein" is offered and what happened to it."""
    if booking.player_id != player.id:
        return []
    existing = {
        e.kind: e
        for e in (await db.execute(select(Escalation).where(Escalation.booking_id == booking.id))).scalars()
    }
    out = []
    for kind in ESCALATION_KINDS:
        source = await _escalation_source(db, booking, kind)
        e = existing.get(kind)
        if source is None and e is None:
            continue
        out.append({"kind": kind, "can_escalate": source is not None and (e is None or e.source_id != source),
                    "escalation": escalation_out(e)})
    return out


async def list_escalations(db: AsyncSession, settings: Settings, status_filter: str | None) -> list[dict]:
    q = select(Escalation).order_by(Escalation.created_at.desc()).limit(200)
    if status_filter in ("open", "decided"):
        q = q.where(Escalation.status == status_filter)
    rows = (await db.execute(q)).scalars().all()
    out = []
    for e in rows:
        booking = await db.get(Booking, e.booking_id)
        venue = await db.get(Venue, e.venue_id)
        court = await db.get(Court, booking.court_id) if booking else None
        player = await db.get(User, e.player_id)
        detail: dict = {}
        if e.kind == "no_show":
            r = await db.get(NoShowReply, e.source_id)
            detail = {"player_note": r.note if r else None}
        elif e.kind == "short_payment":
            c = await db.get(ShortPaymentClaim, e.source_id)
            if c is not None:
                detail = {"total_pkr": c.total_pkr, "paid_pkr": c.paid_pkr, "due_pkr": c.due_pkr, "player_note": c.player_reason}
        elif e.kind == "refund":
            t = await db.get(RefundTransfer, e.source_id)
            d = await db.get(PaymentDispute, t.dispute_id) if t else None
            if t is not None:
                detail = {"transfer": transfer_out(t), "payout": payout_out(d) if d else None}
        out.append({
            **(escalation_out(e) or {}), "booking_id": e.booking_id, "booking_code": short_code(e.booking_id),
            "venue_id": e.venue_id, "venue_name": venue.name if venue else "", "court_name": court.name if court else "",
            "starts_at": booking.starts_at if booking else None,
            "price": float(booking.price) if booking else None, "amount_paid": float(booking.amount_paid or 0) if booking else None,
            "player_name": (player.name if player else None) or (booking.player_name if booking else None),
            "player_phone": player.phone if player else None, "detail": detail,
        })
    return out


async def decide_escalation(
    db: AsyncSession, settings: Settings, admin: User, escalation_id: uuid.UUID, decision: str, note: str | None
) -> Escalation:
    from app.services.audit_service import AuditService

    if decision not in ("player", "venue"):
        raise _err(422, ErrorCode.VALIDATION_ERROR, "Decide for the player or the venue.")
    text = " ".join((note or "").split())[:1000]
    if not text:
        raise _err(422, ErrorCode.VALIDATION_ERROR, "Write a one-line reason; both sides see it.")
    e = await db.get(Escalation, escalation_id, with_for_update=True)
    if e is None:
        raise _err(status.HTTP_404_NOT_FOUND, ErrorCode.NOT_FOUND, "Not found")
    if e.status != "open":
        raise _err(status.HTTP_409_CONFLICT, ErrorCode.ALREADY_REVIEWED, "This was already decided.")
    e.status, e.admin_decision, e.admin_note = "decided", decision, text
    e.decided_by, e.decided_at = admin.id, datetime.now(timezone.utc)
    effect: dict = {}
    if decision == "player":
        effect = await _apply_player_win(db, settings, admin, e)
    await AuditService(db).log(
        actor_user_id=admin.id, actor_type=admin.role.value, action="escalation.decided", entity_type="escalation",
        entity_id=e.id, new_value={"kind": e.kind, "decision": decision, "note": text, **effect},
    )
    await db.commit()
    await db.refresh(e)
    booking = await db.get(Booking, e.booking_id)
    venue = await db.get(Venue, e.venue_id)
    player = await db.get(User, e.player_id)
    code = short_code(e.booking_id)
    k_ru, k_en = KIND_TEXT[e.kind]
    if decision == "player":
        p_ru, p_en = "Khelo ne aap ke haq mein faisla kiya", "Khelo decided in your favour"
        o_ru, o_en = {
            "no_show": ("No-show hatana hai: booking kholein, 'Player sahi hai, no-show hatao' dabayein aur hisaab likhein.",
                        "Remove the no-show: open the booking, press 'Player was right, remove no-show' and enter the amounts."),
            "short_payment": ("Baqi raqam maaf kar di gayi.", "The amount due was waived."),
            "refund": (f"Refund dobara bhejna hai: {format_pkr(effect.get('reopened', 0))}.",
                       f"Send the refund again: {format_pkr(effect.get('reopened', 0))}."),
        }[e.kind]
    else:
        p_ru, p_en = "Khelo ne venue ki baat sahi maani", "Khelo agreed with the venue"
        o_ru, o_en = "Aap ki baat sahi maani gayi; kuch karna nahi.", "Khelo agreed with you; nothing to do."
    await _notify(
        db, settings, player, "player_escalation_decided", ("Khelo ka faisla", "Khelo's decision"),
        (f"Booking {code} ({k_ru}): {p_ru}. {text}", f"Booking {code} ({k_en}): {p_en}. {text}"), reference_id=e.booking_id,
    )
    await _notify(
        db, settings, await _owner_of(db, venue), "owner_escalation_decided", ("Khelo ka faisla", "Khelo's decision"),
        (f"Booking {code} ({k_ru}): {'player ke haq mein' if decision == 'player' else 'aap ke haq mein'}. {text} {o_ru}",
         f"Booking {code} ({k_en}): {'for the player' if decision == 'player' else 'for you'}. {text} {o_en}"),
        reference_id=e.booking_id,
    )
    _ = booking
    return e


async def _apply_player_win(db: AsyncSession, settings: Settings, admin: User, e: Escalation) -> dict:
    """What deciding FOR the player changes (see the module docstring). Does not commit; the caller does."""
    if e.kind == "no_show":
        r = await db.get(NoShowReply, e.source_id, with_for_update=True)
        if r is not None and r.owner_decision == "keep":
            r.owner_decision, r.decided_by, r.decided_at = None, None, None
        return {"noshow_reopened": True}
    if e.kind == "short_payment":
        from app.services.payment_ledger_service import recompute_payment_totals

        c = await db.get(ShortPaymentClaim, e.source_id, with_for_update=True)
        if c is None or c.resolved_at is not None:
            return {}
        booking = await db.get(Booking, c.booking_id, with_for_update=True)
        old = float(booking.price)
        booking.price = round(float(booking.amount_paid or 0), 2)
        await recompute_payment_totals(db, booking)
        c.owner_decision, c.decided_by, c.decided_at = "waive", admin.id, datetime.now(timezone.utc)
        c.resolved_at, c.resolution = datetime.now(timezone.utc), "waived"
        if c.penalty_applied and not c.penalty_returned and c.player_id:
            from app.services.phase3_service import add_points

            await add_points(db, c.player_id, c.booking_id, c.penalty_applied, "short_no_reply_returned")
            c.penalty_returned = True
        return {"price_before": old, "price_after": float(booking.price)}
    if e.kind == "refund":
        from app.models.payment_entry import PaymentEntry, PaymentMethod
        from app.services.payment_ledger_service import UNCREDITED_REFUND_REASONS, recompute_payment_totals

        t = await db.get(RefundTransfer, e.source_id, with_for_update=True)
        d = await db.get(PaymentDispute, t.dispute_id, with_for_update=True) if t is not None else None
        if t is None or d is None:
            return {}
        amount = float(t.amount)
        d.refunded_amount = round(max(float(d.refunded_amount or 0) - amount, 0.0), 2)
        d.refund_status, d.resolved = "owed", False
        if d.reason not in UNCREDITED_REFUND_REASONS:
            booking = await db.get(Booking, d.booking_id, with_for_update=True)
            db.add(PaymentEntry(
                booking_id=booking.id, amount_pkr=int(round(amount)), method=PaymentMethod.OTHER, recorded_by=admin.id,
                note=f"Refund taken back by Khelo: the player did not receive it (escalation {short_code(e.id)})",
            ))
            await db.flush()
            await recompute_payment_totals(db, booking)
        return {"reopened": amount}
    return {}
