import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.owner_billing import InvoiceLineOut


class MonthCollectedOut(BaseModel):
    month: str  # "2026-10" (a Pakistan calendar month)
    collected_pkr: int


class InvoiceTotalsOut(BaseModel):
    count: int
    total_pkr: int


class FeatureRevenueOut(BaseModel):
    key: str
    label: str
    list_price_pkr: int
    is_sellable: bool
    owners_on: int  # owners who have it switched on and renewing
    on_trial: int
    paying: int
    overdue: int  # paid period over, still inside the grace days (it still works)
    off: int  # trial over and unpaid, or lapsed past the grace days (it does not work)
    recurring_pkr: int  # monthly value of paying + overdue owners at the price each signed up at


class OwnerCountsOut(BaseModel):
    with_premium: int  # owners with at least one feature switched on and renewing
    on_trial_only: int  # every feature they have is still in its free trial
    paying: int  # at least one feature paid for and in date
    overdue: int  # at least one feature past its paid date, inside grace
    off: int  # at least one feature switched off for non-payment


class BillingSummaryOut(BaseModel):
    generated_at: datetime
    enforced: bool  # false: nothing is charged yet, every figure below is what WOULD be billed
    collected_this_month_pkr: int
    collected_last_month_pkr: int
    collected_all_time_pkr: int
    months: list[MonthCollectedOut]  # oldest first, the last 6 months including this one
    recurring_pkr: int  # monthly value of everything currently paid for (paying + overdue)
    trial_value_pkr: int  # monthly value of features still in free trial: not revenue yet
    at_risk_pkr: int  # monthly value of features that are switched off for non-payment
    outstanding: InvoiceTotalsOut  # issued + proof_submitted invoices
    overdue: InvoiceTotalsOut  # the part of that whose due date has passed
    screenshots_to_check: int
    owners: OwnerCountsOut
    by_feature: list[FeatureRevenueOut]
    notes: list[str]


class OwnerBillingRowOut(BaseModel):
    owner_id: uuid.UUID
    name: str | None
    phone: str
    features_on: int
    monthly_pkr: int  # what they are billed per month right now
    state: str  # worst of their features: off | overdue | trial | paying | none
    outstanding_pkr: int
    collected_pkr: int
    last_payment_at: datetime | None
    next_due: date | None  # earliest date one of their features stops being covered


class OwnerFeatureBillingOut(BaseModel):
    key: str
    label: str
    price_pkr: int  # the price the owner signed up at
    state: str  # trial | paid | grace | lapsed | unpaid
    entitled: bool
    status: str  # owner_features.status as stored
    renewing: bool
    enabled_at: datetime
    trial_ends_on: date
    paid_through: date | None
    works_until: date | None


class OwnerPaymentRowOut(BaseModel):
    id: uuid.UUID
    amount_pkr: int
    method: str
    status: str
    note: str | None
    reference: str | None
    rejection_reason: str | None
    created_at: datetime
    reviewed_at: datetime | None


class OwnerInvoiceDetailOut(BaseModel):
    id: uuid.UUID
    period_start: date
    period_end: date
    total_pkr: int
    status: str
    due_date: date
    paid_at: datetime | None
    created_at: datetime
    lines: list[InvoiceLineOut]
    payments: list[OwnerPaymentRowOut]


class OwnerBillingDetailOut(BaseModel):
    owner_id: uuid.UUID
    name: str | None
    phone: str
    email: str | None
    enforced: bool
    monthly_pkr: int
    outstanding_pkr: int
    collected_pkr: int
    features: list[OwnerFeatureBillingOut]
    invoices: list[OwnerInvoiceDetailOut]
