import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.booking import BookingOut


class PaymentRejectIn(BaseModel):
    # Optional in the schema only so a reject on a cancelled/expired booking reaches the 409 BOOKING_NO_LONGER_PENDING
    # check (Owner Round 2, A5); a normal rejection without a reason is still refused (422) by the endpoint.
    reason: str | None = None


class AcknowledgeIn(BaseModel):
    money_received: bool


class AcknowledgeOut(BaseModel):
    ok: bool = True
    refund_dispute_id: uuid.UUID | None = None


class PaymentApproveIn(BaseModel):
    """Optional body for POST /payments/{id}/approve. `amount_pkr` is the amount the owner confirms the player
    really paid; omitted = the screenshot amount (else the expected advance)."""

    amount_pkr: int | None = Field(default=None, gt=0)
    # Owner Round 2 (A10.3): "advance_only" = credit only the expected advance, the rest becomes a refund owed
    # (overpayment_excess); "full" / omitted = today's behaviour (credit up to the price).
    accept_mode: Literal["advance_only", "full"] | None = None


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    booking_id: uuid.UUID
    proof_url: str | None = None
    proof_hash: str | None
    expected_amount: float | None = None
    ocr_amount: float | None
    ocr_ref: str | None
    ocr_verdict: str | None
    ocr_confidence: float | None
    # Section 32 Part 7
    ocr_payer_name: str | None = None
    ocr_bank: str | None = None
    ocr_receiver: str | None = None
    ocr_flags: list[str] | None = None
    name_match_verdict: str | None = None
    time_check_verdict: str | None = None
    receiver_match_verdict: str | None = None
    is_duplicate: bool
    duplicate_of: uuid.UUID | None
    review_verdict: str | None
    rejection_reason: str | None
    reviewed_at: datetime | None
    auto_approved: bool
    created_at: datetime


class PaymentCheckOut(BaseModel):
    """One plain-language check for the owner's approval card -- `verdict`
    drives the tick/warning/cross icon, `text` is the ready-made sentence to
    display (never hand-rolled client-side, same "hand it a ready-made
    string" convention this codebase already uses for money/time in the AI
    chat)."""

    verdict: str  # "match" | "mismatch" | "warning" | "not_available" | "not_configured"
    text: str


class PaymentChecksOut(BaseModel):
    """Section 32 Part 7: the five plain-language checks shown on the
    owner's approval card. Auto-approve requires name/amount/time/receiver
    all "match" (or receiver "not_configured", see build_payment_checks) and
    no duplicate -- but this object itself is purely informational; nothing
    here auto-rejects anything, the owner always makes the final call."""

    name: PaymentCheckOut
    amount: PaymentCheckOut
    balance_text: str
    time: PaymentCheckOut
    bank: PaymentCheckOut
    duplicate: PaymentCheckOut
    # Money-correctness fix: what the player paid vs what this booking's flow expected (advance, or the full
    # price for a full-payment flow), in plain words, plus the booking's position once approved at that amount.
    paid_amount: int = 0  # screenshot amount (expected amount when unreadable) -- the editable default
    expected_amount: int = 0
    payment_status: str = "paid_in_full"  # "paid_in_full" | "overpaid" | "underpaid"
    payment_status_text: str = ""  # "Paid in full" / "Overpaid by PKR X" / "Underpaid by PKR X"
    total_after_approval: int = 0  # amount paid on the booking after approval (credit capped at the price)
    balance_after_approval: int = 0


class PaymentSubmitResponse(BaseModel):
    payment: PaymentOut
    booking: BookingOut


class ProofUrlOut(BaseModel):
    url: str
    expires_in: int
