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
from app.models.payment import Payment
from app.models.user import User
from app.models.venue import Venue
from app.schemas.payment import PaymentCheckOut, PaymentChecksOut
from app.services.ai.base import PaymentExtraction
from app.services.ai.factory import UnconfiguredProviderError, get_vision_provider
from app.services.ai.schemas import PaymentExtractionValidationError
from app.services.ai.usage import log_ai_usage
from app.services.audit_service import AuditService
from app.services.booking_service import BookingService, recompute_reliability
from app.services.feature_flag_service import flag_on
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


def build_payment_checks(payment: Payment, booking: Booking, account_name: str | None) -> PaymentChecksOut:
    """Pure, no I/O -- the five plain-language checks for the owner's
    approval card (Section 32 Part 7), built from verdicts already computed
    and stored on `payment` at submission time. Every sentence is
    ready-made here, never hand-rolled by the frontend -- the same "hand it
    a ready-made string" convention this codebase already uses for money
    and time in the AI chat's tool results.

    Deliberately does NOT change how much a booking is credited for
    (`booking.amount_paid`/`balance_due` come from the existing
    `confirm_booking` flow, unchanged by this Part) -- an overpayment is
    only *described* here ("PKR 50 more than expected"), not yet credited
    beyond the fixed advance. Crediting the real paid amount belongs to
    Section 32 Part 5's `payment_entries` ledger (built independently,
    unmerged as of this Part); wiring the two together is a batch-merge
    step, not something to guess at here."""
    payer_name = payment.ocr_payer_name

    if payment.name_match_verdict == "match":
        name = PaymentCheckOut(
            verdict="match", text=f"Name on screenshot: {payer_name}. App account: {account_name}. Matched."
        )
    elif payment.name_match_verdict == "mismatch":
        name = PaymentCheckOut(
            verdict="mismatch", text=f"Name on screenshot: {payer_name}. App account: {account_name}. Not matched."
        )
    elif not payer_name:
        name = PaymentCheckOut(verdict="not_available", text="Name not visible on the screenshot.")
    else:
        name = PaymentCheckOut(verdict="not_available", text=f"Name on screenshot: {payer_name}.")

    total = float(booking.price)
    paid_so_far = float(booking.amount_paid)
    balance_due = float(booking.balance_due)
    balance_text = (
        f"Total {format_pkr(total)}. Paid so far {format_pkr(paid_so_far)}. "
        f"Balance due at the venue: {format_pkr(balance_due)}."
    )
    ocr_amount = float(payment.ocr_amount) if payment.ocr_amount is not None else None
    expected = float(payment.amount_claimed) if payment.amount_claimed is not None else None
    if ocr_amount is None:
        amount = PaymentCheckOut(verdict="not_available", text="Amount not visible on the screenshot.")
    elif payment.ocr_verdict == "match":
        amount = PaymentCheckOut(
            verdict="match",
            text=f"Screenshot shows {format_pkr(ocr_amount)}. Expected now: {format_pkr(expected or 0)}. Matched.",
        )
    elif expected is not None and ocr_amount < expected:
        amount = PaymentCheckOut(
            verdict="mismatch",
            text=f"Screenshot shows {format_pkr(ocr_amount)} -- {format_pkr(expected - ocr_amount)} less than expected.",
        )
    elif expected is not None and ocr_amount > expected:
        amount = PaymentCheckOut(
            verdict="mismatch",
            text=f"Screenshot shows {format_pkr(ocr_amount)} -- {format_pkr(ocr_amount - expected)} more than expected.",
        )
    else:
        amount = PaymentCheckOut(
            verdict="mismatch",
            text=f"Screenshot shows {format_pkr(ocr_amount)}. Expected now: {format_pkr(expected or 0)}.",
        )

    if payment.time_check_verdict == "within_timer":
        # `booking.held_until` is cleared to None once the booking leaves
        # HELD (mark_payment_submitted/confirm_booking both null it out) --
        # by the time this card is rendered the booking has almost always
        # already moved past HELD, so the verdict itself (computed and
        # stored once, at submission time, before it was cleared) is the
        # source of truth here, not whatever held_until reads *now*. Show
        # the fuller sentence when it's still available, a shorter but
        # still correct one otherwise -- never downgrade the verdict itself.
        if payment.ocr_timestamp and booking.held_until:
            time_check = PaymentCheckOut(
                verdict="match",
                text=(
                    f"Paid {format_time(payment.ocr_timestamp)}. Booking started {format_time(booking.created_at)}. "
                    f"Timer ended {format_time(booking.held_until)}. Within the timer."
                ),
            )
        elif payment.ocr_timestamp:
            time_check = PaymentCheckOut(verdict="match", text=f"Paid {format_time(payment.ocr_timestamp)}. Within the timer.")
        else:
            time_check = PaymentCheckOut(verdict="match", text="Within the timer.")
    elif payment.time_check_verdict == "before_hold":
        time_check = PaymentCheckOut(verdict="warning", text="Paid before the booking started.")
    elif payment.time_check_verdict == "after_timer":
        time_check = PaymentCheckOut(verdict="warning", text="Paid after the timer ended.")
    else:
        time_check = PaymentCheckOut(verdict="warning", text="Time not visible.")

    bank_label = payment.ocr_bank or "an unknown bank/wallet"
    if payment.receiver_match_verdict == "match":
        bank = PaymentCheckOut(verdict="match", text=f"Paid via {bank_label}. Receiver matches the venue's saved bank details.")
    elif payment.receiver_match_verdict == "mismatch":
        bank = PaymentCheckOut(
            verdict="mismatch", text=f"Paid via {bank_label}. Receiver does not match the venue's saved bank details."
        )
    elif payment.receiver_match_verdict == "not_configured":
        bank = PaymentCheckOut(
            verdict="not_configured", text=f"Paid via {bank_label}. The venue hasn't saved bank details to check against."
        )
    else:
        bank = PaymentCheckOut(verdict="not_available", text=f"Paid via {bank_label}. Receiver name not visible.")

    if payment.is_duplicate:
        duplicate = PaymentCheckOut(
            verdict="mismatch", text="This screenshot (or transaction reference) matches a payment already on file."
        )
    else:
        duplicate = PaymentCheckOut(verdict="match", text="No duplicate found.")

    return PaymentChecksOut(name=name, amount=amount, balance_text=balance_text, time=time_check, bank=bank, duplicate=duplicate)


class PaymentService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self.audit = AuditService(db)
        self.booking_service = BookingService(db, settings)
        self.waitlist_service = WaitlistService(db, settings)

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
        self, proof_bytes: bytes, content_type: str, expected_amount: float
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
        if booking.status != BookingStatus.HELD:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Booking is not awaiting a payment proof",
            )

        expected_amount = float(booking.advance_amount)
        proof_key = await upload_private_proof(proof_bytes, filename, content_type)
        proof_hash = perceptual_hash(proof_bytes)

        extraction = await self._extract_payment_proof(proof_bytes, content_type, expected_amount)
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

        duplicate = await self._find_duplicate(proof_hash, extraction.reference, booking.id)
        ocr_timestamp = self._parse_ocr_timestamp(extraction.timestamp)

        venue = await self._venue_for_booking(booking)
        account_name = await self._resolve_player_account_name(booking)
        name_match_verdict = compute_name_match(extraction.payer_name, account_name)
        time_check_verdict = compute_time_check(ocr_timestamp, booking)
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
            ocr_raw=extraction.raw_response,
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

        auto_approved = await self._maybe_auto_approve(payment, booking, ocr_verdict, duplicate is not None)
        if not auto_approved:
            await self.booking_service.mark_payment_submitted(booking)

        await self.audit.log(
            actor_user_id=booking.player_id,
            actor_type="player",
            action="payment.submitted",
            entity_type="payment",
            entity_id=payment.id,
            new_value={"ocr_verdict": ocr_verdict, "is_duplicate": payment.is_duplicate},
        )
        await self.db.commit()
        await self.db.refresh(payment)
        return payment

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
            await self.booking_service.confirm_booking(booking)
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

    async def approve_payment(self, payment: Payment, booking: Booking, approved_by: User) -> Payment:
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
            actor_type="owner",
            action="payment.approved",
            entity_type="payment",
            entity_id=payment.id,
        )
        await self.booking_service.confirm_booking(booking, recorded_by=approved_by)
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
            actor_type="owner",
            action="payment.rejected",
            entity_type="payment",
            entity_id=payment.id,
            new_value={"reason": reason},
        )

        # A rejected payment releases the slot entirely (not back to "held") --
        # the player starts over with a fresh hold if they want to try again.
        await self.booking_service.cancel_booking(booking, CancelledBy.OWNER, reason)

        if booking.player_id is not None:
            player = await self.db.get(User, booking.player_id)
            if player is not None:
                player.total_rejections += 1
                recompute_reliability(player)

        court = await self.db.get(Court, booking.court_id)
        if court is not None:
            await self.waitlist_service.notify_matching_entries(court, booking.starts_at)

        await self.db.commit()
        await self.db.refresh(payment)
        return payment

    @staticmethod
    def proof_url(payment: Payment, expires_in: int = 300) -> str | None:
        if not payment.proof_key:
            return None
        return signed_private_url(payment.proof_key, expires_in)
