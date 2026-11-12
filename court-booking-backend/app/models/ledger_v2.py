"""Ledger v2 tables (docs/design/LEDGER-V2-CONTRACT.md 3.1): booking adjustments and player credit."""

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.mixins import CreatedAtMixin, UUIDPkMixin


class AdjustmentKind:
    POINTS = "points"
    NO_SHOW = "no_show"
    CANCELLATION = "cancellation"
    PRICE_REDUCED = "price_reduced"
    WAIVED = "waived"
    # Final = base_price - these. A waiver is NOT one of them (Balance = Final - Net - Waived).
    DEDUCTIONS = ("points", "no_show", "cancellation", "price_reduced")
    ALL = ("points", "no_show", "cancellation", "price_reduced", "waived")


class BookingAdjustment(UUIDPkMixin, CreatedAtMixin, Base):
    """A change to what a booking costs (a deduction) or to what is still asked of the player (a waiver). Append-only: a wrong
    one is undone by a reversing row (reverses_adjustment_id); a reversed row and its reversal both stop counting."""

    __tablename__ = "booking_adjustments"

    booking_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    amount_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reverses_adjustment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("booking_adjustments.id"), nullable=True, unique=True
    )
    short_claim_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("short_payment_claims.id"), nullable=True
    )
    backfilled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))

    __table_args__ = (
        CheckConstraint("amount_pkr > 0", name="ck_booking_adjustments_positive"),
        CheckConstraint(
            "kind IN ('points', 'no_show', 'cancellation', 'price_reduced', 'waived')", name="ck_booking_adjustments_kind"
        ),
    )


class PlayerCredit(UUIDPkMixin, CreatedAtMixin, Base):
    """The player's credit ("jama") at one venue: + when money moves into it (a credit_out entry on a booking), - when it is
    spent (a credit_in entry). Keyed by the account, or by the phone when the player has no account (a walk-in); a later
    account with that phone owns it (balance query: player_id = X OR phone = the account's phone)."""

    __tablename__ = "player_credits"

    venue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("venues.id"), nullable=False, index=True)
    player_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    delta_pkr: Mapped[int] = mapped_column(Integer, nullable=False)
    booking_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings.id"), nullable=False)
    entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payment_entries.id"), nullable=False, unique=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("player_id IS NOT NULL OR phone IS NOT NULL", name="ck_player_credits_key"),
        CheckConstraint("delta_pkr <> 0", name="ck_player_credits_nonzero"),
    )
