import enum
import uuid
from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPkMixin, pg_enum


class PaymentMethod(str, enum.Enum):
    BANK_TRANSFER_PROOF = "bank_transfer_proof"
    CASH_AT_VENUE = "cash_at_venue"
    OTHER = "other"


class EntryKind:
    PAYMENT = "payment"
    REFUND = "refund"
    CORRECTION = "correction"
    CREDIT_IN = "credit_in"
    CREDIT_OUT = "credit_out"
    ALL = ("payment", "refund", "correction", "credit_in", "credit_out")


class PaymentEntry(UUIDPkMixin, CreatedAtMixin, Base):
    """Section 32 Part 5: the append-only ledger of real money recorded against a booking -- separate from
    `payments` (OCR payment-PROOF review). One row per amount recorded: the advance once a proof is approved,
    each balance payment the owner records, a walk-in's amount_paid, and any admin correction (a reversing
    entry, never an edit or delete of an existing row). `bookings.amount_paid`/`balance_due` are always
    recomputed from the sum of a booking's entries (see `payment_ledger_service.recompute_payment_totals`) --
    nothing else may set them directly."""

    __tablename__ = "payment_entries"

    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True
    )
    # Whole PKR, never a float (Section 32 Part 5's own money rule). Negative for a reversing/correction entry.
    amount_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    method: Mapped[PaymentMethod] = mapped_column(pg_enum(PaymentMethod, "payment_method"), nullable=False)
    # Who recorded it: the owner/admin that took the action. Null means the system recorded it (an
    # auto-approved advance payment has no human on the other end of the click).
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Set only on a correction entry: points at the entry it reverses. Never set on an ordinary payment.
    reverses_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payment_entries.id"), nullable=True
    )
    # Ledger v2 (migration e6b2d4f8a913): what the row IS, instead of guessing from its sign and note. A correction keeps its
    # own sign (a reversal of a payment is negative, of a refund positive). credit_in = the player's credit spent on this
    # booking (+); credit_out = money moved from this booking into the player's credit (-). Credit rows use method 'other'.
    kind: Mapped[str] = mapped_column(String(12), nullable=False, default=EntryKind.PAYMENT, server_default="payment")
    # The venue's business day this money belongs to (Mon 6 PM - Tue 4 AM = Monday). NULL only on rows from before the
    # backfill; created_at stays the real moment it was recorded.
    money_business_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # A refund: the payment it returns, its payment_disputes workflow row and (when sent as a transfer) its refund_transfers row.
    refund_of_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payment_entries.id"), nullable=True
    )
    dispute_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("payment_disputes.id"), nullable=True)
    refund_transfer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("refund_transfers.id"), nullable=True, unique=True
    )
    backfilled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))

    booking: Mapped["Booking"] = relationship()  # noqa: F821

    __table_args__ = (
        CheckConstraint(
            "kind IN ('payment', 'refund', 'correction', 'credit_in', 'credit_out')", name="ck_payment_entries_kind"
        ),
        Index("ix_payment_entries_dispute_id", "dispute_id"),
        Index("ix_payment_entries_business_date", "money_business_date"),
    )
