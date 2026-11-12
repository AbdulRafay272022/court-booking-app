"""Ledger v2 (docs/design/LEDGER-V2-CONTRACT.md section 3.1): booking adjustments, entry kinds + business day, player credit

All additive; nothing existing is rewritten here. The data backfill (kinds, business days, adjustments from the audit log,
uncredited refunds) is a separate, idempotent script (scripts/ledger_v2_backfill.py) run after this, with its own report.

- bookings.base_price: the booking's original amount. Final = base_price - active deductions = bookings.price (never minus
  a waiver). NULL until the backfill fills it; new code writes it together with price.
- booking_adjustments: points | no_show | cancellation | price_reduced (deductions) and waived (NOT a deduction; Balance =
  Final - Net - Waived). Never edited: a wrong one gets a reversing row (reverses_adjustment_id, unique).
- payment_entries.kind: payment | refund | correction | credit_in | credit_out (stops guessing the type from the sign and the
  note). money_business_date: the venue's business day the money belongs to (Mon 6 PM - Tue 4 AM = Monday); NULL until the
  backfill. refund_of_entry_id / dispute_id / refund_transfer_id link a refund to the money it returns and to its workflow.
  The payment_method enum is NOT changed (credit rows are method 'other' + kind).
- player_credits: the player's credit at a venue, keyed by account or (no account) phone; one row per credit_in / credit_out
  entry.
- venues.no_show_charge: 'advance' (default: keep the advance, charge nothing more) | 'full'.

Downgrade refuses (and changes nothing) while any adjustment, player credit or non-'payment' kind written by new code exists.

Revision ID: e6b2d4f8a913
Revises: c3e8a1f5b902
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "e6b2d4f8a913"
down_revision: str | None = "c3e8a1f5b902"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column("bookings", sa.Column("base_price", sa.Numeric(10, 2), nullable=True))

    op.create_table(
        "booking_adjustments",
        sa.Column("id", _UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("booking_id", _UUID, sa.ForeignKey("bookings.id"), nullable=False, index=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("amount_pkr", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_by", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reverses_adjustment_id", _UUID, sa.ForeignKey("booking_adjustments.id"), nullable=True, unique=True),
        sa.Column("short_claim_id", _UUID, sa.ForeignKey("short_payment_claims.id"), nullable=True),
        sa.Column("backfilled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount_pkr > 0", name="ck_booking_adjustments_positive"),
        sa.CheckConstraint(
            "kind IN ('points', 'no_show', 'cancellation', 'price_reduced', 'waived')", name="ck_booking_adjustments_kind"
        ),
    )

    op.add_column("payment_entries", sa.Column("kind", sa.String(12), nullable=False, server_default="payment"))
    op.create_check_constraint(
        "ck_payment_entries_kind", "payment_entries", "kind IN ('payment', 'refund', 'correction', 'credit_in', 'credit_out')"
    )
    op.add_column("payment_entries", sa.Column("money_business_date", sa.Date(), nullable=True))
    op.add_column("payment_entries", sa.Column("refund_of_entry_id", _UUID, sa.ForeignKey("payment_entries.id"), nullable=True))
    op.add_column("payment_entries", sa.Column("dispute_id", _UUID, sa.ForeignKey("payment_disputes.id"), nullable=True))
    op.create_index("ix_payment_entries_dispute_id", "payment_entries", ["dispute_id"])
    op.add_column(
        "payment_entries", sa.Column("refund_transfer_id", _UUID, sa.ForeignKey("refund_transfers.id"), nullable=True, unique=True)
    )
    op.add_column("payment_entries", sa.Column("backfilled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.create_index("ix_payment_entries_business_date", "payment_entries", ["money_business_date"])

    op.create_table(
        "player_credits",
        sa.Column("id", _UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("venue_id", _UUID, sa.ForeignKey("venues.id"), nullable=False, index=True),
        sa.Column("player_id", _UUID, sa.ForeignKey("users.id"), nullable=True, index=True),
        sa.Column("phone", sa.String(20), nullable=True, index=True),
        sa.Column("delta_pkr", sa.Integer(), nullable=False),
        sa.Column("booking_id", _UUID, sa.ForeignKey("bookings.id"), nullable=False),
        sa.Column("entry_id", _UUID, sa.ForeignKey("payment_entries.id"), nullable=False, unique=True),
        sa.Column("created_by", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("player_id IS NOT NULL OR phone IS NOT NULL", name="ck_player_credits_key"),
        sa.CheckConstraint("delta_pkr <> 0", name="ck_player_credits_nonzero"),
    )

    op.add_column("venues", sa.Column("no_show_charge", sa.String(10), nullable=False, server_default="advance"))
    op.create_check_constraint("ck_venues_no_show_charge", "venues", "no_show_charge IN ('advance', 'full')")


def downgrade() -> None:
    conn = op.get_bind()
    used = conn.execute(
        sa.text(
            "SELECT (SELECT count(*) FROM booking_adjustments WHERE NOT backfilled)"
            " + (SELECT count(*) FROM player_credits)"
            " + (SELECT count(*) FROM payment_entries WHERE kind IN ('credit_in', 'credit_out'))"
        )
    ).scalar()
    if used:
        raise RuntimeError(
            "ledger_v2 downgrade refused: adjustments or player credit written by the app exist; they would be lost."
        )
    op.drop_constraint("ck_venues_no_show_charge", "venues", type_="check")
    op.drop_column("venues", "no_show_charge")
    op.drop_table("player_credits")
    op.drop_index("ix_payment_entries_business_date", table_name="payment_entries")
    op.drop_column("payment_entries", "backfilled")
    op.drop_column("payment_entries", "refund_transfer_id")
    op.drop_index("ix_payment_entries_dispute_id", table_name="payment_entries")
    op.drop_column("payment_entries", "dispute_id")
    op.drop_column("payment_entries", "refund_of_entry_id")
    op.drop_column("payment_entries", "money_business_date")
    op.drop_constraint("ck_payment_entries_kind", "payment_entries", type_="check")
    op.drop_column("payment_entries", "kind")
    op.drop_table("booking_adjustments")
    op.drop_column("bookings", "base_price")
