import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.booking import BookingOut


class PaymentRejectIn(BaseModel):
    reason: str


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
    is_duplicate: bool
    duplicate_of: uuid.UUID | None
    review_verdict: str | None
    rejection_reason: str | None
    reviewed_at: datetime | None
    auto_approved: bool
    created_at: datetime


class PaymentSubmitResponse(BaseModel):
    payment: PaymentOut
    booking: BookingOut


class ProofUrlOut(BaseModel):
    url: str
    expires_in: int
