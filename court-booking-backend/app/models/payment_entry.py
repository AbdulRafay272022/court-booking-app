import enum
import uuid

from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPkMixin, pg_enum


class PaymentMethod(str, enum.Enum):
    BANK_TRANSFER_PROOF = "bank_transfer_proof"
    CASH_AT_VENUE = "cash_at_venue"
    OTHER = "other"


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

    booking: Mapped["Booking"] = relationship()  # noqa: F821
