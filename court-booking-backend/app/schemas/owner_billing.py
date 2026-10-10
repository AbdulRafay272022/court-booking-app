import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field


class PremiumFeatureOut(BaseModel):
    model_config = {"from_attributes": True}

    key: str
    label: str
    description: str | None
    monthly_price_pkr: int
    is_sellable: bool
    updated_at: datetime


class PremiumFeatureUpdateIn(BaseModel):
    # whole PKR a month; both fields optional so a price and the on/off can change independently
    monthly_price_pkr: int | None = Field(default=None, ge=0, le=10_000_000)
    is_sellable: bool | None = None


class InvoiceLineOut(BaseModel):
    model_config = {"from_attributes": True}

    feature_key: str
    description: str | None
    amount_pkr: int
    period_start: date
    period_end: date
    prorated_days: int | None


class InvoiceOut(BaseModel):
    id: uuid.UUID
    period_start: date
    period_end: date
    total_pkr: int
    status: str
    due_date: date
    created_at: datetime
    lines: list[InvoiceLineOut]


class OwnerFeatureOut(BaseModel):
    key: str
    label: str
    description: str | None
    monthly_price_pkr: int  # today's list price
    enabled: bool  # the owner has it switched on (cancelled or never enabled = false)
    your_price_pkr: int | None  # the price locked in when they enabled it
    entitled: bool  # it works for them right now
    state: str  # entitlement reason: not_enforced / trial / paid / grace / lapsed / unpaid / not_purchased / not_billed
    trial_ends_on: date | None
    paid_through: date | None
    cancelled: bool  # switched off, but may still work until the end of what is already paid or the trial


class OwnerPremiumOut(BaseModel):
    enforced: bool  # false: every feature is free for everyone right now and nothing is charged
    trial_days: int
    grace_days: int
    features: list[OwnerFeatureOut]
    monthly_total_pkr: int
    invoices: list[InvoiceOut]


class SelectionIn(BaseModel):
    # The complete set of premium features the owner wants ON. Anything enabled and left out is cancelled.
    feature_keys: list[str] = Field(default_factory=list, max_length=20)
