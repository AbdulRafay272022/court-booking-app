"""audit 2026-10-28 Phase 2: CNIC review status, walk-in WhatsApp opt-in, refund rows without a payment proof

- owner_identity: cnic_status ('pending' | 'approved' | 'rejected'), rejection_reason, reviewed_by, reviewed_at.
  Backfill: a row with verified_at set becomes 'approved' (reviewed_by/at copied from verified_by/at); the rest 'pending'.
- bookings.whatsapp_opt_in (nullable boolean): the owner ticked "Player ko bata diya ke WhatsApp par rasid aayegi".
- payment_disputes.payment_id becomes NULLABLE: a refund owed on a booking paid in CASH (no payment proof row), and a
  player's "Refund maangein" request, need a refund row with no proof. payment_disputes.player_note: the player's reason.

All additive except the NOT NULL -> NULL relaxation, which loses nothing. Downgrade refuses (and changes nothing) while
any refund row without a payment exists, instead of deleting money records.

Revision ID: f7c3a9d2b415
Revises: e5b8c2d4f6a1
Create Date: 2026-10-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f7c3a9d2b415"
down_revision: str | None = "e5b8c2d4f6a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "owner_identity",
        sa.Column("cnic_status", sa.String(length=20), nullable=False, server_default=sa.text("'pending'")),
    )
    op.add_column("owner_identity", sa.Column("rejection_reason", sa.Text(), nullable=True))
    op.add_column("owner_identity", sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("owner_identity", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_owner_identity_reviewed_by_users", "owner_identity", "users", ["reviewed_by"], ["id"]
    )
    op.create_check_constraint(
        "valid_cnic_status", "owner_identity", "cnic_status IN ('pending', 'approved', 'rejected')"
    )
    op.execute(
        "UPDATE owner_identity SET cnic_status = 'approved', reviewed_by = verified_by, reviewed_at = verified_at "
        "WHERE verified_at IS NOT NULL"
    )

    op.add_column("bookings", sa.Column("whatsapp_opt_in", sa.Boolean(), nullable=True))

    op.alter_column("payment_disputes", "payment_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column("payment_disputes", sa.Column("player_note", sa.Text(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    orphan = conn.execute(sa.text("SELECT count(*) FROM payment_disputes WHERE payment_id IS NULL")).scalar()
    if orphan:
        raise RuntimeError(
            f"{orphan} refund row(s) have no payment proof (cash refunds / player refund requests); "
            "settle or move them before downgrading. Nothing was changed."
        )
    op.drop_column("payment_disputes", "player_note")
    op.alter_column("payment_disputes", "payment_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)

    op.drop_column("bookings", "whatsapp_opt_in")

    op.drop_constraint("valid_cnic_status", "owner_identity", type_="check")
    op.drop_constraint("fk_owner_identity_reviewed_by_users", "owner_identity", type_="foreignkey")
    op.drop_column("owner_identity", "reviewed_at")
    op.drop_column("owner_identity", "reviewed_by")
    op.drop_column("owner_identity", "rejection_reason")
    op.drop_column("owner_identity", "cnic_status")
