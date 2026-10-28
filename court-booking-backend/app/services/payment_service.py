import uuid
from datetime import datetime, timedelta, timezone

import httpx
import imagehash
import structlog
from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.booking import Booking, BookingStatus, CancelledBy
from app.models.court import Court
from app.models.dispute import PaymentDispute
from app.models.payment import Payment
from app.models.payment_entry import PaymentMethod
from app.models.user import User
from app.models.venue import Venue
from app.schemas.payment import PaymentCheckOut, PaymentChecksOut
from app.services.ai.base import PaymentExtraction
from app.services.ai.factory import UnconfiguredProviderError, get_vision_provider
from app.services.ai.schemas import PaymentExtractionValidationError
from app.services.ai.usage import log_ai_usage
from app.services.audit_service import AuditService
from app.services.booking_service import BookingService, recompute_reliability
from app.services.entitlement_service import EntitlementService
from app.services.feature_flag_service import flag_on
from app.services.payment_ledger_service import UNCREDITED_REFUND_REASONS  # noqa: F401 (re-exported)
from app.services.waitlist_service import WaitlistService
from app.utils.encryption import decrypt_json
from app.utils.image import perceptual_hash
from app.utils.s3 import signed_private_url, upload_private_proof
from app.utils.text import fuzzy_name_match
from app.utils.timezone import format_pkr, format_time, naive_pkt_to_utc

logger = structlog.get_logger(__name__)

_UNCONFIGURED_EXTRACTION = PaymentExtraction(
    amount=None, reference=None, timestamp=None, confidence=None, raw_response={}
)


def compute_name_match(payer_name: str | None, account_name: str | None) -> str:
    """"match" / "mismatch" / "unavailable" -- Section 32 Part 7. Never a
    signal to auto-reject; a mismatch is a warning the owner sees, nothing
    more, since people legitimately pay from a relative's account."""
    if not payer_name or not account_name:
        return "unavailable"
    return "match" if fuzzy_name_match(payer_name, account_name) else "mismatch"


BALANCE_PURPOSE = "balance"


def is_balance_proof(payment: Payment | None) -> bool:
    """audit 2026-10-28 Phase 3 item 2: a screenshot for the BALANCE of a booked booking (marked at submit, in ocr_raw)."""
    return payment is not None and isinstance(payment.ocr_raw, dict) and payment.ocr_raw.get("purpose") == BALANCE_PURPOSE


def compute_balance_time_check(ocr_timestamp: datetime | None, booking: Booking) -> str:
    """A balance transfer is plausible from the hold until 3 hours after the slot ends (2-minute clock tolerance)."""
    if ocr_timestamp is None:
        return "not_visible"
    tolerance = timedelta(minutes=2)
    if ocr_timestamp < booking.created_at - tolerance:
        return "before_hold"
    if ocr_timestamp > booking.ends_at + timedelta(hours=3) + tolerance:
        return "after_timer"
    return "within_timer"


def compute_time_check(ocr_timestamp: datetime | None, booking: Booking) -> str:
    """"within_timer" / "before_hold" / "after_timer" / "not_visible" --
    the payment time must be after the hold was created and before
    held_until, with a 2-minute clock tolerance either side (Section 32
    Part 7). Blocks auto-approve when not "within_timer", but never
    auto-rejects -- the owner can still approve manually."""
    if ocr_timestamp is None:
        return "not_visible"
    tolerance = timedelta(minutes=2)
    if ocr_timestamp < booking.created_at - tolerance:
        return "before_hold"
    if booking.held_until is not None and ocr_timestamp > booking.held_until + tolerance:
        return "after_timer"
    return "within_timer"


def compute_receiver_match(receiver_name: str | None, venue: Venue | None, settings: Settings) -> str:
    """"match" / "mismatch" / "not_configured" / "unavailable" -- compares
    the OCR-extracted receiver against the venue's own saved bank details
    (Section 32 Part 7). "not_configured" (no saved bank details to compare
    against) does not block auto-approve; a genuine "mismatch" does."""
    if venue is None or not venue.bank_details:
        return "not_configured"
    bank_details = decrypt_json(venue.bank_details, settings)
    account_title = (bank_details or {}).get("account_title") if isinstance(bank_details, dict) else None
    if not account_title:
        return "not_configured"
    if not receiver_name:
        return "unavailable"
    return "match" if fuzzy_name_match(receiver_name, account_title) else "mismatch"


def default_credit_amount(payment: Payment, booking: Booking) -> int:
    """What an approval credits when the owner doesn't type an amount: the amount the screenshot actually
    showed when OCR read one, else the expected advance (full price for a full-payment flow, where
    advance_amount == price)."""
    if payment.ocr_amount is not None and float(payment.ocr_amount) > 0:
        return int(round(float(payment.ocr_amount)))
    return int(round(float(booking.advance_amount)))



# The approvals-queue state of an unreviewed payment, from its booking (docs/round2-contract.md A1/A5).
AWAITING_STATES = (BookingStatus.HELD, BookingStatus.PAYMENT_SUBMITTED)


def approval_state(booking: Booking, payment: "Payment | None" = None) -> str:
    """"awaiting" (the owner can approve/reject) | "cancelled_by_player" | "cancelled_by_owner" | "expired".
    A booking that left the pending states any other way (system cancel, or confirmed/completed through another
    path while this proof stayed unreviewed) is "expired": the proof can only be acknowledged now.
    audit 2026-10-28 Phase 3 item 2: a BALANCE screenshot on a booked booking is awaiting too."""
    if booking.status in AWAITING_STATES:
        return "awaiting"
    if booking.status == BookingStatus.BOOKED and is_balance_proof(payment):
        return "awaiting"
    if booking.status == BookingStatus.CANCELLED:
        if booking.cancelled_by == CancelledBy.PLAYER:
            return "cancelled_by_player"
        if booking.cancelled_by == CancelledBy.OWNER:
            return "cancelled_by_owner"
    return "expired"


def is_expired_hold(booking: Booking) -> bool:
    return (
        booking.status == BookingStatus.CANCELLED
        and booking.cancelled_by == CancelledBy.SYSTEM
        and booking.cancellation_reason == "hold_expired"
    )


LATE_PROOF_MESSAGE = (
    "Your booking time ran out before this screenshot arrived, so the slot was released. "
    "We have sent your screenshot to the venue; they will check it and contact you (a refund if the money reached them)."
)


def overpayment_of(payment: Payment, booking: Booking) -> dict | None:
    """{expected, ocr_amount, excess} when the screenshot shows more than the expected advance, else None."""
    if payment.ocr_amount is None:
        return None
    expected = int(round(float(booking.advance_amount)))
    ocr = int(round(float(payment.ocr_amount)))
    if ocr <= expected:
        return None
    return {"expected": expected, "ocr_amount": ocr, "excess": ocr - expected}


def build_payment_summary(payment: Payment, booking: Booking) -> tuple[str, str, int, int, int, int]:
    """(status, text, paid, expected, total_after, balance_after) for the approval card: compares the paid amount
    (screenshot amount, else the expected one) with the expected amount for this booking's flow, and says what the
    booking will look like once approved at that amount (credit capped at the price)."""
    expected = int(round(float(booking.advance_amount)))
    if is_balance_proof(payment) and payment.amount_claimed is not None:
        expected = int(round(float(payment.amount_claimed)))  # Phase 3 item 2: a balance screenshot is measured against the balance
    paid = default_credit_amount(payment, booking)
    price = int(round(float(booking.price)))
    credited = min(paid, price)
    already = int(round(float(booking.amount_paid)))
    total_after = already + credited
    balance_after = max(price - total_after, 0)
    if paid == expected:
        status_, text = "paid_in_full", "Paid in full"
    elif paid > expected:
        status_, text = "overpaid", f"Overpaid by {format_pkr(paid - expected)}"
    else:
        status_, text = "underpaid", f"Underpaid by {format_pkr(expected - paid)}"
    return status_, text, paid, expected, total_after, balance_after


def build_payment_checks(payment: Payment, booking: Booking, account_name: str | None) -> PaymentChecksOut:
    """Pure, no I/O -- the five plain-language checks for the owner's
    approval card (Section 32 Part 7), built from verdicts already computed
    and stored on `payment` at submission time. Every sentence is
    ready-made here, never hand-rolled by the frontend -- the same "hand it
    a ready-made string" convention this codebase already uses for money
    and time in the AI chat's tool results.

    Money-correctness fix: approval now credits the REAL paid amount (see
    `default_credit_amount` / `confirm_booking`), so `balance_text` and the
    summary fields describe what the booking will look like AFTER approval
    at that amount, not just the current state."""
    payer_name = payment.ocr_payer_name

    def chk(verdict: str, en: str, ru: str) -> PaymentCheckOut:
        # audit 2026-10-28 item 12: every sentence in English AND Roman Urdu; the owner screens pick by their language
        return PaymentCheckOut(verdict=verdict, text=en, text_ru=ru)

    if payment.name_match_verdict == "not_checked":
        # Phase 3 item 2: a friend often pays the balance, so the sender's name is not compared (the receiver account is)
        name = chk(
            "not_available",
            f"Balance payment: the sender's name is not checked{f' (screenshot: {payer_name})' if payer_name else ''}.",
            f"Baqi raqam: bhejne wale ka naam check nahi hota{f' (screenshot: {payer_name})' if payer_name else ''}.",
        )
    elif payment.name_match_verdict == "match":
        name = chk(
            "match",
            f"Name on screenshot: {payer_name}. App account: {account_name}. Matched.",
            f"Screenshot par naam: {payer_name}. App account: {account_name}. Mil gaya.",
        )
    elif payment.name_match_verdict == "mismatch":
        name = chk(
            "mismatch",
            f"Name on screenshot: {payer_name}. App account: {account_name}. Not matched.",
            f"Screenshot par naam: {payer_name}. App account: {account_name}. Nahi mila.",
        )
    elif not payer_name:
        name = chk("not_available", "Name not visible on the screenshot.", "Screenshot par naam nazar nahi aa raha.")
    else:
        name = chk("not_available", f"Name on screenshot: {payer_name}.", f"Screenshot par naam: {payer_name}.")

    total = float(booking.price)
    summary_status, summary_text, paid_amt, expected_amt, total_after, balance_after = build_payment_summary(
        payment, booking
    )
    balance_text = (
        f"Total {format_pkr(total)}. Paid after approval {format_pkr(total_after)}. "
        f"Balance due at the venue: {format_pkr(balance_after)}."
    )
    balance_text_ru = (
        f"Kul {format_pkr(total)}. Approve ke baad mila: {format_pkr(total_after)}. "
        f"Venue par baqi: {format_pkr(balance_after)}."
    )
    ocr_amount = float(payment.ocr_amount) if payment.ocr_amount is not None else None
    expected = float(payment.amount_claimed) if payment.amount_claimed is not None else None
    if ocr_amount is None:
        amount = chk("not_available", "Amount not visible on the screenshot.", "Screenshot par raqam nazar nahi aa rahi.")
    elif payment.ocr_verdict == "match":
        amount = chk(
            "match",
            f"Screenshot shows {format_pkr(ocr_amount)}. Expected now: {format_pkr(expected or 0)}. Matched.",
            f"Screenshot par {format_pkr(ocr_amount)}. Abhi aana tha: {format_pkr(expected or 0)}. Mil gaya.",
        )
    elif expected is not None and ocr_amount < expected:
        amount = chk(
            "mismatch",
            f"Screenshot shows {format_pkr(ocr_amount)} -- {format_pkr(expected - ocr_amount)} less than expected.",
            f"Screenshot par {format_pkr(ocr_amount)}: {format_pkr(expected - ocr_amount)} kam.",
        )
    elif expected is not None and ocr_amount > expected:
        amount = chk(
            "mismatch",
            f"Screenshot shows {format_pkr(ocr_amount)} -- {format_pkr(ocr_amount - expected)} more than expected.",
            f"Screenshot par {format_pkr(ocr_amount)}: {format_pkr(ocr_amount - expected)} zyada.",
        )
    else:
        amount = chk(
            "mismatch",
            f"Screenshot shows {format_pkr(ocr_amount)}. Expected now: {format_pkr(expected or 0)}.",
            f"Screenshot par {format_pkr(ocr_amount)}. Abhi aana tha: {format_pkr(expected or 0)}.",
        )

    if payment.time_check_verdict == "within_timer":
        # `booking.held_until` is cleared to None once the booking leaves HELD, so the stored verdict (computed at
        # submission time) is the source of truth; show the fuller sentence only when the times are still there.
        if payment.ocr_timestamp and booking.held_until:
            time_check = chk(
                "match",
                f"Paid {format_time(payment.ocr_timestamp)}. Booking started {format_time(booking.created_at)}. "
                f"Timer ended {format_time(booking.held_until)}. Within the timer.",
                f"Payment {format_time(payment.ocr_timestamp)} par hui. Booking {format_time(booking.created_at)} par shuru hui. "
                f"Timer {format_time(booking.held_until)} par khatam. Waqt ke andar.",
            )
        elif payment.ocr_timestamp:
            time_check = chk(
                "match",
                f"Paid {format_time(payment.ocr_timestamp)}. Within the timer.",
                f"Payment {format_time(payment.ocr_timestamp)} par hui. Waqt ke andar.",
            )
        else:
            time_check = chk("match", "Within the timer.", "Waqt ke andar.")
    elif payment.time_check_verdict == "before_hold":
        time_check = chk("warning", "Paid before the booking started.", "Payment booking shuru hone se pehle ki hai.")
    elif payment.time_check_verdict == "after_timer":
        time_check = chk("warning", "Paid after the timer ended.", "Payment timer khatam hone ke baad hui.")
    else:
        time_check = chk("warning", "Time not visible.", "Waqt nazar nahi aa raha.")

    bank_en = payment.ocr_bank or "an unknown bank/wallet"
    bank_ru = payment.ocr_bank or "na-maloom bank/wallet"
    if payment.receiver_match_verdict == "match":
        bank = chk(
            "match",
            f"Paid via {bank_en}. Receiver matches the venue's saved bank details.",
            f"{bank_ru} se payment. Paane wala venue ki bank details se mil gaya.",
        )
    elif payment.receiver_match_verdict == "mismatch":
        bank = chk(
            "mismatch",
            f"Paid via {bank_en}. Receiver does not match the venue's saved bank details.",
            f"{bank_ru} se payment. Paane wala venue ki bank details se NAHI mila.",
        )
    elif payment.receiver_match_verdict == "not_configured":
        bank = chk(
            "not_configured",
            f"Paid via {bank_en}. The venue hasn't saved bank details to check against.",
            f"{bank_ru} se payment. Venue ki bank details save nahi, is liye check nahi ho saka.",
        )
    else:
        bank = chk(
            "not_available",
            f"Paid via {bank_en}. Receiver name not visible.",
            f"{bank_ru} se payment. Paane wale ka naam nazar nahi aa raha.",
        )

    if payment.is_duplicate:
        duplicate = chk(
            "mismatch",
            "This screenshot (or transaction reference) matches a payment already on file.",
            "Ye screenshot (ya transaction number) pehle bhi kisi payment mein aa chuka hai.",
        )
    else:
        duplicate = chk("match", "No duplicate found.", "Koi duplicate nahi mila.")

    return PaymentChecksOut(
        name=name,
        amount=amount,
        balance_text=balance_text,
        balance_text_ru=balance_text_ru,
        time=time_check,
        bank=bank,
        duplicate=duplicate,
        paid_amount=paid_amt,
        expected_amount=expected_amt,
        payment_status=summary_status,
        payment_status_text=summary_text,
        total_after_approval=total_after,
        balance_after_approval=balance_after,
    )


class PaymentService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.audit = AuditService(db)
        self.booking_service = BookingService(db, settings)
        self.waitlist_service = WaitlistService(db, settings)
        self.entitlements = EntitlementService(db, settings)

    @staticmethod
    def _parse_ocr_timestamp(raw: str | None) -> datetime | None:
        """Parse the payment time the vision model read off the screenshot into
        a UTC-aware datetime for the time check (Section 32 Part 7).

        Real JazzCash/Easypaisa receipts print a human, Pakistan-local time
        ("24 Sep 2026, 07:12 PM"), and the vision model returns it verbatim --
        NOT ISO 8601 -- so ISO-only parsing returned None on essentially every
        real screenshot, silently making the time check always "not visible"
        and always blocking auto-approve. Accept ISO too (some inputs/tests use
        it). A value that carries no offset is a Pakistan wall-clock reading, so
        it is interpreted as PKT (assuming UTC would be 5 hours off)."""
        if not raw:
            return None
        parsed = None
        try:
            parsed = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
        except ValueError:
            cleaned = " ".join(raw.strip().replace(",", " ").split()).upper()
            for fmt in (
                "%d %b %Y %I:%M %p",   # 24 Sep 2026 07:12 PM
                "%d %B %Y %I:%M %p",   # 24 September 2026 07:12 PM
                "%d %b %Y %I:%M:%S %p",
                "%Y-%m-%d %I:%M %p",   # 2026-09-24 07:12 PM
                "%Y-%m-%d %H:%M:%S",   # 2026-09-24 19:12:00
                "%Y-%m-%d %H:%M",
                "%d/%m/%Y %I:%M %p",   # 24/09/2026 07:12 PM
                "%d-%m-%Y %I:%M %p",
                "%b %d %Y %I:%M %p",   # Sep 24 2026 07:12 PM
            ):
                try:
                    parsed = datetime.strptime(cleaned, fmt)
                    break
                except ValueError:
                    continue
        if parsed is None:
            return None
        if parsed.tzinfo:
            return parsed.astimezone(timezone.utc)
        # No offset on the receipt = a Pakistan-local wall-clock reading.
        return naive_pkt_to_utc(parsed)

    async def _extract_payment_proof(
        self, proof_bytes: bytes, content_type: str, expected_amount: float, *, entitled: bool = True
    ) -> PaymentExtraction:
        """Vision call via whichever provider AI_VISION_PROVIDER (or
        AI_PROVIDER) selects -- Section 21. Mirrors the pre-Section-21
        behavior of `OCRService`, which no-op'd (empty result) rather than
        erroring when no API key was configured."""
        # Admin global kill switch (Section 32 Part 12). OFF => skip the billed
        # vision call and return the all-null extraction, exactly as an
        # unconfigured provider does: the payment gets ocr_verdict="unreadable",
        # auto-approve is blocked, and the owner reviews the screenshot by eye --
        # the pre-Part-7 behavior.
        if not await flag_on(self.db, "ocr_verification"):
            return _UNCONFIGURED_EXTRACTION
        # Owner premium billing: a venue whose owner has not got "AI payment verification" gets the same manual-review
        # fallback as the global switch being off (no billed vision call). `entitled` is False only for a player-side
        # proof at such a venue; the platform's own owner-billing proofs always read.
        if not entitled:
            return _UNCONFIGURED_EXTRACTION
        try:
            vision = get_vision_provider(self.settings)
        except UnconfiguredProviderError:
            return _UNCONFIGURED_EXTRACTION

        try:
            extraction = await vision.extract_payment_proof(proof_bytes, content_type, expected_amount)
        except PaymentExtractionValidationError as exc:
            # The provider's structured-output response didn't match the
            # expected shape at all -- distinct from a legitimate all-null
            # "couldn't read this screenshot" response (which validates
            # fine and never raises). Logged loudly so this is visible and
            # distinguishable from a real "unreadable" verdict, but still
            # falls back to one so a vendor-side glitch doesn't block the
            # player's payment submission -- the owner can still review the
            # proof manually.
            logger.error("payment_service.ocr_validation_failed", provider=self.settings.AI_VISION_PROVIDER or self.settings.AI_PROVIDER, error=str(exc))
            return _UNCONFIGURED_EXTRACTION
        except httpx.HTTPError as exc:
            # A genuine vendor outage/timeout/5xx (post_json's own retries
            # already exhausted, reraise=True) -- this is not the provider
            # responding with a malformed shape, it's the provider not
            # responding usefully at all. Same graceful degradation as
            # above: route to manual owner review instead of 500ing the
            # player's payment submission (see finding #7 in
            # AUDIT_FINDINGS.md -- this project's own Gemini model churn is
            # exactly the kind of vendor instability this guards against).
            logger.error("payment_service.ocr_provider_unavailable", provider=self.settings.AI_VISION_PROVIDER or self.settings.AI_PROVIDER, error=str(exc))
            return _UNCONFIGURED_EXTRACTION
        await log_ai_usage(
            self.db,
            provider=self.settings.AI_VISION_PROVIDER or self.settings.AI_PROVIDER,
            model=extraction.model_used,
            purpose="vision",
            raw_usage=extraction.raw_usage,
        )
        return extraction

    async def _find_duplicate(
        self, proof_hash: str | None, ocr_ref: str | None, exclude_booking_id: uuid.UUID
    ) -> Payment | None:
        """Two independent duplicate signals, either one enough to flag:

        1. A near-match perceptual hash (small Hamming distance), not just a
           byte-identical hash -- a screenshot forwarded twice is rarely
           byte-identical after going through WhatsApp/S3, but its
           perceptual hash barely moves.
        2. A reused OCR-extracted transaction reference (finding #16 in
           AUDIT_FINDINGS.md) -- the perceptual hash alone can't catch a
           "trusted" repeat player submitting a screenshot of *someone
           else's real transfer* to the same venue: a visually different
           image, so the hash never matches, but the extracted `ocr_ref`
           would be identical to a payment already on file. Checked first
           since it doesn't need a decodable image at all.
        """
        window_start = datetime.now(timezone.utc) - timedelta(days=self.settings.DUPLICATE_LOOKBACK_DAYS)
        if ocr_ref:
            ref_match = await self.db.scalar(
                select(Payment)
                .where(
                    Payment.ocr_ref == ocr_ref,
                    Payment.booking_id != exclude_booking_id,
                    Payment.created_at >= window_start,
                )
                .limit(1)
            )
            if ref_match is not None:
                return ref_match

        if proof_hash is None:
            return None
        result = await self.db.execute(
            select(Payment).where(
                Payment.proof_hash.is_not(None),
                Payment.booking_id != exclude_booking_id,
                Payment.created_at >= window_start,
            )
        )
        candidate_hash = imagehash.hex_to_hash(proof_hash)
        for payment in result.scalars().all():
            try:
                distance = candidate_hash - imagehash.hex_to_hash(payment.proof_hash)
            except (TypeError, ValueError):
                continue
            if distance <= self.settings.DUPLICATE_HASH_DISTANCE:
                return payment
        return None

    async def submit_payment(
        self, booking: Booking, *, proof_bytes: bytes, filename: str, content_type: str
    ) -> Payment:
        # Owner Round 2 (B1): the hold time is enforced the moment it runs out, not when the expiry job next runs.
        if (
            booking.status == BookingStatus.HELD
            and booking.held_until is not None
            and booking.held_until <= datetime.now(timezone.utc)
        ):
            if await self.booking_service.expire_hold_now(booking):
                court = await self.db.get(Court, booking.court_id)
                if court is not None:
                    await self.waitlist_service.notify_matching_entries(court, booking.starts_at, booking.ends_at)
        if is_expired_hold(booking):
            await self._record_late_proof(booking, proof_bytes=proof_bytes, filename=filename, content_type=content_type)
        # audit 2026-10-28 Phase 3 item 2 (flag balance_proof, default OFF): a booked booking with money still due accepts
        # a screenshot for the BALANCE, with the same checks as the advance.
        balance = (
            booking.status == BookingStatus.BOOKED
            and float(booking.balance_due or 0) > 0
            and await flag_on(self.db, "balance_proof")
        )
        if booking.status != BookingStatus.HELD and not balance:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Booking is not awaiting a payment proof",
            )

        expected_amount = float(booking.balance_due) if balance else float(booking.advance_amount)
        proof_key = await upload_private_proof(proof_bytes, filename, content_type)
        proof_hash = perceptual_hash(proof_bytes)

        extraction = await self._extract_payment_proof(
            proof_bytes,
            content_type,
            expected_amount,
            entitled=await self.entitlements.court_entitled(booking.court_id, "ocr_verification"),
        )
        ocr_amount = extraction.amount
        if ocr_amount is None:
            ocr_verdict = "unreadable"
        elif expected_amount > 0 and (
            abs(float(ocr_amount) - expected_amount) / expected_amount * 100
            <= self.settings.OCR_MATCH_TOLERANCE_PERCENT
        ):
            ocr_verdict = "match"
        else:
            ocr_verdict = "mismatch"

        # a balance screenshot is also checked against THIS booking's earlier proofs (re-sending the advance receipt)
        duplicate = await self._find_duplicate(proof_hash, extraction.reference, uuid.uuid4() if balance else booking.id)
        ocr_timestamp = self._parse_ocr_timestamp(extraction.timestamp)

        venue = await self._venue_for_booking(booking)
        account_name = await self._resolve_player_account_name(booking)
        # the balance check does NOT compare the sender's name (a friend often pays the balance); everything else is the same
        name_match_verdict = "not_checked" if balance else compute_name_match(extraction.payer_name, account_name)
        time_check_verdict = compute_balance_time_check(ocr_timestamp, booking) if balance else compute_time_check(ocr_timestamp, booking)
        receiver_match_verdict = compute_receiver_match(extraction.receiver_name, venue, self.settings)

        payment = Payment(
            booking_id=booking.id,
            proof_key=proof_key,
            proof_hash=proof_hash,
            amount_claimed=expected_amount,
            ocr_amount=ocr_amount,
            ocr_ref=extraction.reference,
            ocr_timestamp=ocr_timestamp,
            ocr_verdict=ocr_verdict,
            ocr_confidence=extraction.confidence,
            ocr_raw=({**(extraction.raw_response or {}), "purpose": BALANCE_PURPOSE} if balance else extraction.raw_response),
            ocr_payer_name=extraction.payer_name,
            ocr_bank=extraction.bank_name,
            ocr_receiver=extraction.receiver_name,
            ocr_flags=extraction.flags or None,
            name_match_verdict=name_match_verdict,
            time_check_verdict=time_check_verdict,
            receiver_match_verdict=receiver_match_verdict,
            is_duplicate=duplicate is not None,
            duplicate_of=duplicate.id if duplicate else None,
        )
        self.db.add(payment)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            await self.db.rollback()
            if "one_pending_payment_per_booking" in str(exc.orig):
                # A concurrent submit_payment for the same booking (e.g. two
                # rapid taps of "upload proof" on a slow connection) already
                # holds the one allowed pending-review row -- this one loses
                # outright rather than both racing through OCR/auto-approve.
                raise AppError(
                    status.HTTP_409_CONFLICT,
                    ErrorCode.PAYMENT_ALREADY_SUBMITTED,
                    "A payment proof for this booking is already awaiting review",
                ) from exc
            raise

        if balance:
            # the owner always looks at a balance screenshot (nothing is auto-approved); the booking stays booked
            auto_approved = False
        else:
            auto_approved = await self._maybe_auto_approve(payment, booking, ocr_verdict, duplicate is not None)
            if not auto_approved:
                await self.booking_service.mark_payment_submitted(booking)

        await self.audit.log(
            actor_user_id=booking.player_id,
            actor_type="player",
            action="payment.submitted",
            entity_type="payment",
            entity_id=payment.id,
            new_value={"ocr_verdict": ocr_verdict, "is_duplicate": payment.is_duplicate, "purpose": "balance" if balance else "advance"},
        )
        await self.db.commit()
        await self.db.refresh(payment)
        return payment

    async def _record_late_proof(
        self, booking: Booking, *, proof_bytes: bytes, filename: str, content_type: str
    ) -> None:
        """Owner Round 2 (B1): a payment screenshot for a hold that already expired is never silently lost. It is
        stored as an unreviewed payment on the (cancelled) booking -- so it shows in the owner's approvals queue as
        an "expired" card the owner can acknowledge ("money received -> refund") -- the owner gets a bell row
        (`late_payment_proof`), and the player gets a clear 409 HOLD_EXPIRED. Always raises."""
        existing = await self.db.scalar(
            select(Payment).where(Payment.booking_id == booking.id, Payment.review_verdict.is_(None)).limit(1)
        )
        payment = existing
        if existing is None:
            expected_amount = float(booking.advance_amount)
            proof_key = await upload_private_proof(proof_bytes, filename, content_type)
            extraction = await self._extract_payment_proof(
                proof_bytes,
                content_type,
                expected_amount,
                entitled=await self.entitlements.court_entitled(booking.court_id, "ocr_verification"),
            )
            ocr_amount = extraction.amount
            if ocr_amount is None:
                ocr_verdict = "unreadable"
            elif expected_amount > 0 and (
                abs(float(ocr_amount) - expected_amount) / expected_amount * 100
                <= self.settings.OCR_MATCH_TOLERANCE_PERCENT
            ):
                ocr_verdict = "match"
            else:
                ocr_verdict = "mismatch"
            payment = Payment(
                booking_id=booking.id,
                proof_key=proof_key,
                proof_hash=perceptual_hash(proof_bytes),
                amount_claimed=expected_amount,
                ocr_amount=ocr_amount,
                ocr_ref=extraction.reference,
                ocr_timestamp=self._parse_ocr_timestamp(extraction.timestamp),
                ocr_verdict=ocr_verdict,
                ocr_confidence=extraction.confidence,
                ocr_raw=extraction.raw_response,
                ocr_payer_name=extraction.payer_name,
                ocr_bank=extraction.bank_name,
                ocr_receiver=extraction.receiver_name,
                ocr_flags=extraction.flags or None,
                time_check_verdict="after_timer",
            )
            self.db.add(payment)
            try:
                await self.db.flush()
            except IntegrityError:
                await self.db.rollback()
                payment = await self.db.scalar(
                    select(Payment).where(Payment.booking_id == booking.id, Payment.review_verdict.is_(None)).limit(1)
                )
            else:
                await self.audit.log(
                    actor_user_id=booking.player_id,
                    actor_type="player",
                    action="payment.late_submitted",
                    entity_type="payment",
                    entity_id=payment.id,
                    new_value={"booking_id": str(booking.id), "ocr_verdict": ocr_verdict},
                )
                await self.db.commit()

                from app.services.notification_service import NotificationService

                court = await self.db.get(Court, booking.court_id)
                venue = await self.db.get(Venue, court.venue_id) if court is not None else None
                owner = await self.db.get(User, venue.owner_id) if venue is not None else None
                if owner is not None:
                    try:
                        await NotificationService(self.db, self.settings).notify_owner_late_payment_proof(
                            owner=owner, court_name=court.name, booking_id=booking.id,
                            starts_at=booking.starts_at, ends_at=booking.ends_at,
                        )
                    except Exception:  # noqa: BLE001 -- the stored proof is what matters; never lose it to a send error
                        logger.warning("payment_service.late_proof_notify_failed", booking_id=str(booking.id), exc_info=True)
        raise AppError(
            status.HTTP_409_CONFLICT,
            ErrorCode.HOLD_EXPIRED,
            LATE_PROOF_MESSAGE,
            details={"booking_id": str(booking.id), "payment_id": str(payment.id) if payment else None},
        )

    async def _venue_scoped_stats(self, player_id: uuid.UUID, venue_id: uuid.UUID) -> tuple[int, int]:
        """(booking_count, rejection_count) for this player at this venue only
        -- auto-approve is scoped per-venue, not the player's global record."""
        court_ids_result = await self.db.execute(select(Court.id).where(Court.venue_id == venue_id))
        court_ids = [row[0] for row in court_ids_result.all()]
        if not court_ids:
            return 0, 0

        booking_count = await self.db.scalar(
            select(func.count(Booking.id)).where(
                Booking.court_id.in_(court_ids),
                Booking.player_id == player_id,
                Booking.status.in_((BookingStatus.BOOKED, BookingStatus.COMPLETED)),
            )
        )
        rejection_count = await self.db.scalar(
            select(func.count(Payment.id))
            .join(Booking, Booking.id == Payment.booking_id)
            .where(
                Booking.court_id.in_(court_ids),
                Booking.player_id == player_id,
                Payment.review_verdict == "rejected",
            )
        )
        return booking_count or 0, rejection_count or 0

    async def _maybe_auto_approve(
        self, payment: Payment, booking: Booking, ocr_verdict: str, is_duplicate: bool
    ) -> bool:
        # Admin global kill switch (Section 32 Part 12; was GLOBAL_AUTO_APPROVE_ENABLED).
        # OFF forces every payment to manual owner review regardless of any venue's
        # own auto_approve_enabled setting.
        if not await flag_on(self.db, "auto_approve"):
            return False
        # Owner premium billing: no "Auto-approve payments" for this venue's owner => every payment is reviewed by hand.
        if not await self.entitlements.court_entitled(booking.court_id, "auto_approve"):
            return False
        if ocr_verdict != "match" or is_duplicate or booking.player_id is None:
            return False
        # Section 32 Part 7: auto-approve additionally requires the name and
        # time checks to have genuinely matched/passed, and the receiver
        # check to either match or have nothing to compare against
        # ("not_configured" -- a venue that hasn't entered bank details
        # yet). Anything uncertain (unavailable/not_visible) or a genuine
        # mismatch routes to manual review instead -- never to an
        # auto-reject; the owner always makes the final call on anything
        # that isn't a clean five-for-five match.
        if payment.name_match_verdict != "match":
            return False
        if payment.time_check_verdict != "within_timer":
            return False
        if payment.receiver_match_verdict not in ("match", "not_configured"):
            return False
        venue = await self._venue_for_booking(booking)
        if venue is None or not venue.auto_approve_enabled:
            return False

        booking_count, rejection_count = await self._venue_scoped_stats(booking.player_id, venue.id)
        if booking_count < venue.auto_approve_min_bookings or rejection_count > 0:
            return False

        payment.review_verdict = "approved"
        payment.reviewed_at = datetime.now(timezone.utc)
        payment.auto_approved = True
        try:
            await self.booking_service.confirm_booking(
                booking, amount_pkr=default_credit_amount(payment, booking), payment=payment
            )
        except AppError:
            # Lost a race with something else that moved the booking off
            # HELD/PAYMENT_SUBMITTED between this payment being inserted and
            # this auto-approve check running (e.g. a concurrent duplicate
            # submission that landed first -- the partial unique index on
            # payments makes this vanishingly rare, not impossible). Undo the
            # in-memory verdict so this payment falls through to the normal
            # mark_payment_submitted/manual-review path instead of claiming
            # an approval that never actually took effect on the booking.
            payment.review_verdict = None
            payment.reviewed_at = None
            payment.auto_approved = False
            return False
        return True

    async def _venue_for_booking(self, booking: Booking) -> Venue | None:
        court = await self.db.get(Court, booking.court_id)
        if court is None:
            return None
        return await self.db.get(Venue, court.venue_id)

    async def _resolve_player_account_name(self, booking: Booking) -> str | None:
        """The name-match check needs the player's REAL account name, not
        `booking.player_name` (only ever set for walk-ins) -- for an app
        booking, resolve it via `player_id`. Falls back to
        `booking.player_name` when there's no linked account (a walk-in
        that was never matched to a registered user)."""
        if booking.player_id is not None:
            player = await self.db.get(User, booking.player_id)
            if player is not None and player.name:
                return player.name
        return booking.player_name

    async def get_payment(self, payment_id: uuid.UUID) -> Payment:
        payment = await self.db.get(Payment, payment_id)
        if payment is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
        return payment

    async def list_for_booking(self, booking_id: uuid.UUID) -> list[Payment]:
        result = await self.db.execute(
            select(Payment).where(Payment.booking_id == booking_id).order_by(Payment.created_at.desc())
        )
        return list(result.scalars().all())

    async def _claim_review(self, payment: Payment, verdict: str, **extra_values) -> bool:
        """Atomically claim the right to review `payment` -- a conditional
        UPDATE ... WHERE review_verdict IS NULL, the same pattern
        booking_service._atomic_transition uses for bookings. Without this,
        a double-tap Approve or two staff devices racing to approve/reject
        the same payment would both read review_verdict=None in Python and
        both proceed, one silently clobbering the other's write. Returns
        False (row untouched) if the payment was already reviewed by the
        time this ran; refreshes `payment` in place on success."""
        result = await self.db.execute(
            update(Payment)
            .where(Payment.id == payment.id, Payment.review_verdict.is_(None))
            .values(review_verdict=verdict, **extra_values)
            .returning(Payment.id)
        )
        if result.first() is None:
            return False
        await self.db.refresh(payment)
        return True

    @staticmethod
    def _no_longer_pending(booking: Booking) -> AppError:
        state = approval_state(booking)
        return AppError(
            status.HTTP_409_CONFLICT,
            ErrorCode.BOOKING_NO_LONGER_PENDING,
            "This booking is no longer waiting for approval"
            + (" -- the player cancelled it." if state == "cancelled_by_player" else "."),
            details={"state": state},
        )

    def require_awaiting(self, payment: Payment, booking: Booking) -> None:
        """Owner Round 2 (A5): approve/reject on an unreviewed payment whose booking was cancelled or expired gets a
        clear 409 BOOKING_NO_LONGER_PENDING {state} up front (no reason asked, nobody messaged). An already-reviewed
        payment falls through to the claim's own PAYMENT_ALREADY_REVIEWED."""
        if payment.review_verdict is None and approval_state(booking, payment) != "awaiting":
            raise self._no_longer_pending(booking)

    async def require_duplicate_confirmed(self, payment: Payment, confirmed: bool) -> None:
        """Round 2 Stage 2 (spec B.a): a screenshot flagged as a duplicate (`is_duplicate`, any player) may only be
        approved with an explicit `confirm_duplicate: true`; otherwise 409 DUPLICATE_PROOF_CONFIRM_REQUIRED with
        `used_on_bookings` = how many OTHER bookings this image was already credited on."""
        if not payment.is_duplicate or confirmed or payment.review_verdict is not None:
            return
        from app.services.duplicate_proof import used_on_bookings

        n = await used_on_bookings(self.db, payment)
        raise AppError(
            status.HTTP_409_CONFLICT,
            ErrorCode.DUPLICATE_PROOF_CONFIRM_REQUIRED,
            f"This screenshot was already used on {n} other booking(s). Confirm to approve it anyway.",
            details={"used_on_bookings": n},
        )

    async def acknowledge_payment(
        self, payment: Payment, booking: Booking, actor: User, *, money_received: bool
    ) -> PaymentDispute | None:
        """Owner Round 2 (A5): the owner/staff saw the grey "player cancelled / expired" card and pressed "Theek hai".
        The payment leaves the queue and the badge (verdict "acknowledged", reviewed_by/at), audit_log
        `payment.cancelled_acknowledged`. `money_received=True` ("Paisa aa gaya - Refund banayein") queues a refund
        owed in payment_disputes -- the same table and Refunds screen as every other refund -- for the amount the
        screenshot showed (`ocr_amount` when OCR read one, else `amount_claimed`, the advance the player was asked
        for). That money was never credited to the ledger, so its reason `cancelled_payment_received` is one of
        UNCREDITED_REFUND_REASONS (no negative entry when it is paid out). The player is never messaged here."""
        if payment.review_verdict is None and approval_state(booking, payment) == "awaiting":
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.PAYMENT_STILL_PENDING,
                "This payment is still waiting for approval -- approve or reject it instead.",
                details={"state": "awaiting"},
            )
        claimed = await self._claim_review(
            payment, "acknowledged", reviewed_by=actor.id, reviewed_at=datetime.now(timezone.utc)
        )
        if not claimed:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.PAYMENT_ALREADY_REVIEWED,
                "This payment was already reviewed by another request",
            )
        dispute = None
        amount = 0.0
        if money_received:
            if payment.ocr_amount is not None and float(payment.ocr_amount) > 0:
                amount = float(payment.ocr_amount)
            else:
                amount = float(payment.amount_claimed or 0)
            dispute = PaymentDispute(
                booking_id=booking.id,
                payment_id=payment.id,
                player_id=booking.player_id,
                reason="cancelled_payment_received",
                refund_amount=round(amount, 2),
            )
            self.db.add(dispute)
            await self.db.flush()
        await self.audit.log(
            actor_user_id=actor.id,
            actor_type=actor.role.value,
            action="payment.cancelled_acknowledged",
            entity_type="payment",
            entity_id=payment.id,
            new_value={
                "booking_id": str(booking.id),
                "state": approval_state(booking),
                "money_received": money_received,
                "refund_amount": amount if money_received else None,
                "refund_dispute_id": str(dispute.id) if dispute is not None else None,
            },
        )
        await self.db.commit()
        return dispute

    async def approve_payment(
        self,
        payment: Payment,
        booking: Booking,
        approved_by: User,
        amount_pkr: int | None = None,
        accept_mode: str | None = None,
    ) -> Payment:
        """No upfront `if booking.status != PAYMENT_SUBMITTED` / `if
        payment.review_verdict is not None` pre-check here on purpose: a
        plain Python read of either would itself be the exact read-then-
        mutate race this method exists to close. _claim_review (payment)
        and confirm_booking (booking) are each a single conditional UPDATE
        that re-checks the real DB state at write time and raise a clean,
        specific AppError if it's no longer what's expected -- covering
        both the legitimate "already actioned" case and the genuine
        concurrent race with the same code path."""
        claimed = await self._claim_review(
            payment, "approved", reviewed_by=approved_by.id, reviewed_at=datetime.now(timezone.utc)
        )
        if not claimed:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.PAYMENT_ALREADY_REVIEWED,
                "This payment was already reviewed by another request",
            )
        await self.audit.log(
            actor_user_id=approved_by.id,
            actor_type=approved_by.role.value,
            action="payment.approved",
            entity_type="payment",
            entity_id=payment.id,
        )
        if is_balance_proof(payment) and booking.status == BookingStatus.BOOKED:
            # audit 2026-10-28 Phase 3 item 2: a balance transfer is a ledger entry on the booked booking (never past what is
            # still due); the booking itself is already confirmed.
            from app.services.payment_ledger_service import PaymentLedgerService

            amount = amount_pkr if amount_pkr is not None else int(round(float(payment.ocr_amount or payment.amount_claimed or 0)))
            amount = max(0, min(amount, int(round(float(booking.balance_due or 0)))))
            if amount > 0:
                await PaymentLedgerService(self.db).record_entry(
                    booking.id, amount_pkr=amount, method=PaymentMethod.BANK_TRANSFER_PROOF, recorded_by=approved_by,
                    note="Balance by transfer (screenshot approved)",
                )
            await self.db.commit()
            await self.db.refresh(payment)
            return payment
        # Credit the amount the owner confirmed, defaulting to what the screenshot showed (else the expected
        # advance) -- never blindly the advance (money-correctness fix).
        credit = amount_pkr if amount_pkr is not None else default_credit_amount(payment, booking)
        # Owner Round 2 (A10.3): accept_mode "advance_only" credits only the expected advance and queues the rest as
        # an `overpayment_excess` refund owed (existing columns). "full"/None = the behaviour above: everything up to
        # the price is credited, only money above the price becomes a refund (inside confirm_booking).
        advance_excess = 0
        if accept_mode == "advance_only":
            expected = int(round(float(booking.advance_amount)))
            if credit > expected:
                advance_excess = credit - expected
                credit = expected
        try:
            await self.booking_service.confirm_booking(
                booking, recorded_by=approved_by, amount_pkr=credit, payment=payment
            )
        except AppError as exc:
            if exc.code != ErrorCode.BOOKING_ALREADY_CANCELLED:
                raise
            # Lost a race with a cancel: undo the claimed verdict and say clearly what happened.
            await self.db.rollback()
            await self.db.refresh(booking)
            raise self._no_longer_pending(booking) from exc
        if advance_excess > 0:
            self.db.add(
                PaymentDispute(
                    booking_id=booking.id,
                    payment_id=payment.id,
                    player_id=booking.player_id,
                    reason="overpayment_excess",
                    refund_amount=advance_excess,
                )
            )
            await self.audit.log(
                actor_user_id=approved_by.id,
                actor_type=approved_by.role.value,
                action="payment.overpayment_queued",
                entity_type="payment",
                entity_id=payment.id,
                new_value={"accept_mode": accept_mode, "credited": credit, "refund_owed": advance_excess},
            )
        await self.db.commit()
        await self.db.refresh(payment)
        return payment

    async def reject_payment(self, payment: Payment, booking: Booking, rejected_by: User, reason: str) -> Payment:
        """See approve_payment's docstring for why there's no upfront
        plain-Python status pre-check here."""
        claimed = await self._claim_review(
            payment,
            "rejected",
            reviewed_by=rejected_by.id,
            reviewed_at=datetime.now(timezone.utc),
            rejection_reason=reason,
        )
        if not claimed:
            raise AppError(
                status.HTTP_409_CONFLICT,
                ErrorCode.PAYMENT_ALREADY_REVIEWED,
                "This payment was already reviewed by another request",
            )
        await self.audit.log(
            actor_user_id=rejected_by.id,
            actor_type=rejected_by.role.value,
            action="payment.rejected",
            entity_type="payment",
            entity_id=payment.id,
            new_value={"reason": reason},
        )

        # A rejected ADVANCE releases the slot entirely (not back to "held") -- the player starts over with a fresh hold.
        # audit 2026-10-28 Phase 3 item 1: a rejected BALANCE screenshot (or any proof on a booking that is already booked /
        # completed) only rejects that screenshot; the booking stays. It used to cancel a paid booking.
        if booking.status in AWAITING_STATES:
            await self.booking_service.cancel_booking(booking, CancelledBy.OWNER, reason, actor=rejected_by)

        # Safety net: the owner rejected the proof, but "rejected" does not prove no money moved (the transfer may have
        # been real and the rejection for another reason -- wrong amount, wrong account, a stale screenshot). Leave a
        # trail in the same queue as an expired review so an admin can chase it. Refund owed is 0 for the same reason as
        # `payment_review_expired`: nothing was ever recorded as paid in this app. A duplicate of an earlier receipt is
        # not flagged -- that image's money is already accounted for on the earlier payment.
        if not payment.is_duplicate:
            self.db.add(
                PaymentDispute(
                    booking_id=booking.id,
                    payment_id=payment.id,
                    player_id=booking.player_id,
                    reason="payment_rejected",
                    refund_amount=0,
                )
            )

        if booking.player_id is not None:
            player = await self.db.get(User, booking.player_id)
            if player is not None:
                player.total_rejections += 1
                recompute_reliability(player)

        court = await self.db.get(Court, booking.court_id)
        if court is not None:
            await self.waitlist_service.notify_matching_entries(court, booking.starts_at, booking.ends_at)

        await self.db.commit()
        await self.db.refresh(payment)
        return payment

    @staticmethod
    def proof_url(payment: Payment, expires_in: int = 300) -> str | None:
        if not payment.proof_key:
            return None
        return signed_private_url(payment.proof_key, expires_in)
