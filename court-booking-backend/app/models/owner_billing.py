"""Owner premium billing (per owner, per feature, à la carte). Five tables:

- premium_features   the price list (seeded with the six sellable features; a price of 0 / not sellable until set)
- owner_features     what each owner has switched on: status, paid-through date, the price they signed up at, auto-renew
- owner_invoices     one invoice per owner per billing cycle (covers all of the owner's venues)
- owner_invoice_lines  one line per feature on an invoice, price copied in so later price changes never rewrite history
- owner_payments     what the owner paid the platform; amounts never change after insert (a correction is a negative
                     reversing row), same discipline as the player-side payment_entries ledger

All money is whole PKR. Nothing here touches an existing table.
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import CreatedAtMixin, TimestampMixin, UUIDPkMixin


class PremiumFeatureKey(str, enum.Enum):
    """The global flags an owner can buy (their keys are the same strings as `feature_flags.key`)."""

    AI_CHAT_BOOKING = "ai_chat_booking"
    AUTO_APPROVE = "auto_approve"
    DIGEST_REMINDERS = "digest_reminders"
    GROWTH_SUGGESTIONS = "growth_suggestions"
    MARKETING_ANNOUNCEMENTS = "marketing_announcements"
    OCR_VERIFICATION = "ocr_verification"


class OwnerFeatureStatus(str, enum.Enum):
    ACTIVE = "active"  # paid through `paid_through`
    PAST_DUE = "past_due"  # period ended, still inside the grace window (the feature still works)
    LAPSED = "lapsed"  # grace over: the feature is off for this owner (nothing is deleted)
    CANCELLED = "cancelled"  # owner chose not to renew; works until `paid_through`


class InvoiceStatus(str, enum.Enum):
    ISSUED = "issued"
    PROOF_SUBMITTED = "proof_submitted"
    PAID = "paid"
    VOID = "void"
    EXPIRED = "expired"


class OwnerPaymentStatus(str, enum.Enum):
    SUBMITTED = "submitted"  # proof uploaded, waiting for the admin
    APPROVED = "approved"
    REJECTED = "rejected"
    REVERSAL = "reversal"  # an admin correction: a negative amount pointing at the row it reverses


def _in(column: str, enum_cls: type[enum.Enum]) -> str:
    return f"{column} IN ({', '.join(repr(e.value) for e in enum_cls)})"


class PremiumFeature(TimestampMixin, Base):
    __tablename__ = "premium_features"
    __table_args__ = (CheckConstraint("monthly_price_pkr >= 0", name="premium_price_not_negative"),)

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(300), nullable=True)
    monthly_price_pkr: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    # Not offered to owners until an admin sets a price and turns this on.
    is_sellable: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"), nullable=False)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class OwnerFeature(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "owner_features"
    __table_args__ = (
        UniqueConstraint("owner_id", "feature_key", name="uq_owner_feature"),
        CheckConstraint(_in("status", OwnerFeatureStatus), name="owner_feature_status_valid"),
        CheckConstraint("price_pkr >= 0", name="owner_feature_price_not_negative"),
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    feature_key: Mapped[str] = mapped_column(String(50), ForeignKey("premium_features.key"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default=text("'active'"), nullable=False)
    # Last day (Pakistan calendar) the owner has paid for, inclusive. NULL until a first payment is approved.
    paid_through: Mapped[date | None] = mapped_column(Date, nullable=True)
    # The monthly price this owner signed up at; a later change to the price list applies from their next invoice.
    price_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), nullable=False)
    enabled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OwnerInvoice(UUIDPkMixin, TimestampMixin, Base):
    __tablename__ = "owner_invoices"
    __table_args__ = (
        CheckConstraint(_in("status", InvoiceStatus), name="owner_invoice_status_valid"),
        CheckConstraint("total_pkr >= 0", name="owner_invoice_total_not_negative"),
        CheckConstraint("period_end >= period_start", name="owner_invoice_period_valid"),
        # One live invoice per owner per cycle: a void one can be re-issued, nothing else can be duplicated.
        Index(
            "uq_owner_invoice_cycle",
            "owner_id",
            "period_start",
            unique=True,
            postgresql_where=text("status <> 'void'"),
        ),
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    total_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="issued", server_default=text("'issued'"), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class OwnerInvoiceLine(UUIDPkMixin, CreatedAtMixin, Base):
    __tablename__ = "owner_invoice_lines"
    __table_args__ = (CheckConstraint("amount_pkr >= 0", name="owner_invoice_line_not_negative"),)

    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    feature_key: Mapped[str] = mapped_column(String(50), ForeignKey("premium_features.key"), nullable=False)
    amount_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    # Set when the first invoice for a feature added mid-cycle is prorated: how many days of the cycle it covers.
    prorated_days: Mapped[int | None] = mapped_column(Integer, nullable=True)


class OwnerPayment(UUIDPkMixin, CreatedAtMixin, Base):
    __tablename__ = "owner_payments"
    __table_args__ = (
        CheckConstraint(_in("status", OwnerPaymentStatus), name="owner_payment_status_valid"),
        # Only a reversal may be negative; every ordinary payment is positive.
        CheckConstraint(
            "(status = 'reversal' AND amount_pkr < 0) OR (status <> 'reversal' AND amount_pkr > 0)",
            name="owner_payment_sign_matches_status",
        ),
        # A reversal says which payment it reverses, and no other row does.
        CheckConstraint(
            "(status = 'reversal') = (reverses_payment_id IS NOT NULL)", name="owner_payment_reversal_points_at_a_payment"
        ),
        # Double-submission guard, same idea as one_pending_payment_per_booking: one unreviewed proof per invoice.
        Index(
            "one_pending_owner_payment_per_invoice",
            "invoice_id",
            unique=True,
            postgresql_where=text("status = 'submitted'"),
        ),
    )

    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_invoices.id"), nullable=False, index=True
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    amount_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    method: Mapped[str] = mapped_column(
        String(30), default="bank_transfer_proof", server_default=text("'bank_transfer_proof'"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), default="submitted", server_default=text("'submitted'"), nullable=False)
    proof_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    proof_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reverses_payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("owner_payments.id"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
