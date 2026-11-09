"""fix/nov-9 items 6 + 9-12: refund payout details, refund transfers (OCR + player confirmation), escalations to Khelo, user language

All additive (new tables, new nullable columns); nothing existing is rewritten.

- users.language ('ru' | 'en', NULL = never chosen = Roman Urdu): push / WhatsApp / bell text the server writes follows it.
- payment_disputes.payout_*: where the player wants the refund ("Refund kahan bhejein?"): method (jazzcash | easypaisa | bank),
  the number / IBAN ENCRYPTED (Fernet, same key as venue bank details), its last 4 digits in clear for masking (****6789),
  account title, bank name. The full number is shown only to the venue that owes that refund, only while it is owed, and every
  full view is written to audit_log (payout.viewed).
- refund_transfers: one row per "Refund bhej diya" (a refund can be sent in parts): amount, screenshot, the OCR check of the
  screenshot against the amount and the player's payout details (match | mismatch | unreadable | no_screenshot), and the
  player's answer (received | not_received) with the venue's reply. Refunds already marked sent before this migration get one
  backfilled row each (ocr_verdict no_screenshot / unreadable, i.e. never checked), so every sent refund has a transfer row.
- escalations: "Khelo se shikayat karein" after the venue said no: kind no_show | short_payment | refund, one per source row
  (the no-show reply, the short-payment claim, the refund transfer), with the super admin's decision (player | venue) and note.

Downgrade refuses (and changes nothing) while any payout detail, transfer that is not a backfilled one, or escalation exists,
so no player's refund details or a dispute is silently thrown away.

Revision ID: c3e8a1f5b902
Revises: a9d4e7b2c813
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3e8a1f5b902"
down_revision: str | None = "a9d4e7b2c813"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=True)


def _id() -> sa.Column:
    return sa.Column("id", _UUID, primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _created() -> sa.Column:
    return sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def _updated() -> sa.Column:
    return sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    # --- item 6: the user's chosen language
    op.add_column("users", sa.Column("language", sa.String(5), nullable=True))
    op.create_check_constraint("valid_user_language", "users", "language IS NULL OR language IN ('ru', 'en')")

    # --- item 10: where the player wants the refund
    op.add_column("payment_disputes", sa.Column("payout_method", sa.String(12), nullable=True))
    op.add_column("payment_disputes", sa.Column("payout_account_enc", sa.Text(), nullable=True))
    op.add_column("payment_disputes", sa.Column("payout_account_last4", sa.String(4), nullable=True))
    op.add_column("payment_disputes", sa.Column("payout_title", sa.String(100), nullable=True))
    op.add_column("payment_disputes", sa.Column("payout_bank", sa.String(60), nullable=True))
    op.add_column("payment_disputes", sa.Column("payout_set_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "valid_payout_method", "payment_disputes", "payout_method IS NULL OR payout_method IN ('jazzcash', 'easypaisa', 'bank')"
    )
    op.create_check_constraint(
        "payout_complete",
        "payment_disputes",
        "payout_method IS NULL OR (payout_account_enc IS NOT NULL AND payout_account_last4 IS NOT NULL AND payout_title IS NOT NULL)",
    )

    # --- items 11 + 12: each refund sent, its OCR check and the player's answer
    op.create_table(
        "refund_transfers",
        _id(),
        sa.Column("dispute_id", _UUID, sa.ForeignKey("payment_disputes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("booking_id", _UUID, sa.ForeignKey("bookings.id"), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("reference", sa.Text(), nullable=True),
        sa.Column("screenshot_key", sa.String(512), nullable=True),
        sa.Column("sent_by", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("ocr_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("ocr_receiver", sa.Text(), nullable=True),
        sa.Column("ocr_verdict", sa.String(14), nullable=False, server_default=sa.text("'no_screenshot'")),
        sa.Column("ocr_reasons", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("player_response", sa.String(14), nullable=True),
        sa.Column("player_note", sa.Text(), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("owner_reply", sa.Text(), nullable=True),
        sa.Column("owner_replied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("backfilled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        _created(),
        sa.CheckConstraint("amount > 0", name="positive_refund_transfer"),
        sa.CheckConstraint(
            "ocr_verdict IN ('match', 'mismatch', 'unreadable', 'no_screenshot')", name="valid_refund_ocr_verdict"
        ),
        sa.CheckConstraint(
            "player_response IS NULL OR player_response IN ('received', 'not_received')", name="valid_refund_player_response"
        ),
    )
    op.create_index("ix_refund_transfers_dispute_id", "refund_transfers", ["dispute_id"])
    op.create_index("ix_refund_transfers_booking_id", "refund_transfers", ["booking_id"])
    # every refund already marked sent gets its transfer row (never OCR-checked; the player is not asked about these)
    op.execute(
        """
        INSERT INTO refund_transfers (dispute_id, booking_id, amount, reference, screenshot_key, sent_by, ocr_verdict,
                                      player_response, responded_at, backfilled, created_at)
        SELECT id, booking_id, refunded_amount, refund_reference, refund_screenshot_key, refunded_by_user_id,
               CASE WHEN refund_screenshot_key IS NULL THEN 'no_screenshot' ELSE 'unreadable' END,
               NULL, NULL, true, COALESCE(refunded_at, now())
        FROM payment_disputes
        WHERE COALESCE(refunded_amount, 0) > 0
        """
    )

    # --- items 9 + 12: "Khelo se shikayat karein"
    op.create_table(
        "escalations",
        _id(),
        sa.Column("kind", sa.String(14), nullable=False),
        sa.Column("source_id", _UUID, nullable=False),
        sa.Column("booking_id", _UUID, sa.ForeignKey("bookings.id"), nullable=False),
        sa.Column("venue_id", _UUID, sa.ForeignKey("venues.id"), nullable=False),
        sa.Column("player_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(10), nullable=False, server_default=sa.text("'open'")),
        sa.Column("admin_decision", sa.String(10), nullable=True),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("decided_by", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        _created(),
        _updated(),
        sa.CheckConstraint("kind IN ('no_show', 'short_payment', 'refund')", name="valid_escalation_kind"),
        sa.CheckConstraint("status IN ('open', 'decided')", name="valid_escalation_status"),
        sa.CheckConstraint("admin_decision IS NULL OR admin_decision IN ('player', 'venue')", name="valid_escalation_decision"),
        sa.CheckConstraint(
            "(status = 'open' AND admin_decision IS NULL) OR (status = 'decided' AND admin_decision IS NOT NULL)",
            name="escalation_decided_has_decision",
        ),
        sa.UniqueConstraint("kind", "source_id", name="uq_escalations_kind_source"),
    )
    op.create_index("ix_escalations_status", "escalations", ["status"])
    op.create_index("ix_escalations_venue_id", "escalations", ["venue_id"])
    op.create_index("ix_escalations_booking_id", "escalations", ["booking_id"])


def downgrade() -> None:
    conn = op.get_bind()
    checks = (
        ("escalations", "SELECT count(*) FROM escalations"),
        ("refund transfers recorded after the upgrade", "SELECT count(*) FROM refund_transfers WHERE NOT backfilled"),
        ("refunds with payout details", "SELECT count(*) FROM payment_disputes WHERE payout_method IS NOT NULL"),
    )
    for what, sql in checks:
        n = conn.execute(sa.text(sql)).scalar()
        if n:
            raise RuntimeError(f"{n} {what} exist; downgrading would lose them. Nothing was changed.")
    op.drop_table("escalations")
    op.drop_table("refund_transfers")
    op.drop_constraint("payout_complete", "payment_disputes", type_="check")
    op.drop_constraint("valid_payout_method", "payment_disputes", type_="check")
    for col in ("payout_set_at", "payout_bank", "payout_title", "payout_account_last4", "payout_account_enc", "payout_method"):
        op.drop_column("payment_disputes", col)
    op.drop_constraint("valid_user_language", "users", type_="check")
    op.drop_column("users", "language")
