"""fix/nov-9 items 9-12: refund payout details, refund transfers, escalations."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class PayoutIn(BaseModel):
    method: Literal["jazzcash", "easypaisa", "bank"] | None = None
    account: str | None = Field(default=None, max_length=40)  # mobile number or IBAN
    title: str | None = Field(default=None, max_length=100)
    bank: str | None = Field(default=None, max_length=60)
    use_previous: bool = False  # reuse the account given on the player's last refund


class PayoutOut(BaseModel):
    method: str
    method_label: str
    account_masked: str | None
    account: str | None = None  # the FULL number: only from GET /owners/refunds/{id}/payout (audited)
    title: str | None
    bank: str | None
    set_at: datetime | None


class RefundTransferOut(BaseModel):
    id: uuid.UUID
    amount: float
    reference: str | None
    sent_at: datetime
    screenshot_url: str | None
    ocr_amount: float | None
    ocr_receiver: str | None
    ocr_verdict: str  # match | mismatch | unreadable | no_screenshot
    ocr_reasons: list[str]
    player_response: str | None  # received | not_received
    player_note: str | None
    responded_at: datetime | None
    owner_reply: str | None
    owner_replied_at: datetime | None
    can_answer: bool


class EscalationOut(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    reason: str | None
    admin_decision: str | None
    admin_note: str | None
    created_at: datetime
    decided_at: datetime | None


class EscalationStateOut(BaseModel):
    kind: str  # no_show | short_payment | refund
    can_escalate: bool
    escalation: EscalationOut | None


class PlayerRefundStateOut(BaseModel):
    dispute_id: uuid.UUID
    amount: float
    sent: float
    remaining: float
    status: str  # owed | refunded
    needs_payout: bool  # owed and the player has not said where to send it
    payout: PayoutOut | None
    previous_payout: PayoutOut | None  # the account used last time (masked), for "Pichla account use karein"
    transfers: list[RefundTransferOut]


class BookingDisputesOut(BaseModel):
    refund: PlayerRefundStateOut | None
    escalations: list[EscalationStateOut]


class TransferAnswerIn(BaseModel):
    answer: Literal["received", "not_received"]
    note: str | None = Field(default=None, max_length=500)


class OwnerTransferReplyIn(BaseModel):
    note: str = Field(min_length=1, max_length=500)


class EscalateIn(BaseModel):
    kind: Literal["no_show", "short_payment", "refund"]
    reason: str | None = Field(default=None, max_length=1000)


class EscalationDecideIn(BaseModel):
    decision: Literal["player", "venue"]
    note: str = Field(min_length=1, max_length=1000)


class AdminEscalationOut(EscalationOut):
    booking_id: uuid.UUID
    booking_code: str
    venue_id: uuid.UUID
    venue_name: str
    court_name: str
    starts_at: datetime | None
    price: float | None
    amount_paid: float | None
    player_name: str | None
    player_phone: str | None
    detail: dict
