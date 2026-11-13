import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.payment_entry import PaymentMethod


class PaymentEntryIn(BaseModel):
    amount_pkr: int = Field(gt=0)
    method: PaymentMethod
    note: str | None = Field(default=None, max_length=500)
    # ledger v2 (contract 2.1 / 2.4 / 2.8)
    business_date: date | None = None
    excess_choice: Literal["refund", "credit"] | None = None
    confirm_duplicate: bool = False


class PaymentEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    booking_id: uuid.UUID
    amount_pkr: int
    method: PaymentMethod
    recorded_by: uuid.UUID | None
    note: str | None
    reverses_entry_id: uuid.UUID | None
    created_at: datetime
    kind: str = "payment"
    money_business_date: date | None = None


class PaymentEntryResponse(BaseModel):
    entry: PaymentEntryOut
    amount_paid: float
    balance_due: float


class PaymentEntryReverseIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
