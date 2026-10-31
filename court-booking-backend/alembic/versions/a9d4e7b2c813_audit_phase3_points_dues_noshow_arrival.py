"""audit 2026-10-28 Phase 3: points ledger, short-payment claims (dues), no-show replies, arrival GPS, venue points discount

All additive (new tables, new columns with defaults); every new behaviour is behind a default-OFF flag:
- point_entries (player_points): append-only points ledger.
- short_payment_claims (short_payment_reply / player_dues): a booking completed with money still due; an open claim is a due.
- noshow_replies (noshow_reply): "Main aaya tha" on a no-show.
- arrival_checks (noshow_reply): ONE GPS reading when the player pressed "Pohanch gaya".
- venues.points_discount_enabled / points_discount_pkr; bookings.points_discount_pkr.

Downgrade drops them all; it refuses (and changes nothing) while any points, claim, reply or arrival row exists, so no
player's points or a venue's dues are silently thrown away.

Revision ID: a9d4e7b2c813
Revises: f7c3a9d2b415
Create Date: 2026-10-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a9d4e7b2c813"
down_revision: str | None = "f7c3a9d2b415"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = postgresql.UUID(as_uuid=True)
_TABLES = ("point_entries", "short_payment_claims", "noshow_replies", "arrival_checks")


def _id() -> sa.Column:
    return sa.Column("id", _UUID, primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _created() -> sa.Column:
    return sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        "point_entries",
        _id(),
        sa.Column("player_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("booking_id", _UUID, sa.ForeignKey("bookings.id"), nullable=True),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(40), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        _created(),
    )
    op.create_index("ix_point_entries_player_id", "point_entries", ["player_id"])
    # each award / penalty happens at most once per booking
    op.create_index(
        "uq_point_entries_booking_reason", "point_entries", ["booking_id", "reason"], unique=True,
        postgresql_where=sa.text("booking_id IS NOT NULL"),
    )

    op.create_table(
        "short_payment_claims",
        _id(),
        sa.Column("booking_id", _UUID, sa.ForeignKey("bookings.id"), nullable=False, unique=True),
        sa.Column("venue_id", _UUID, sa.ForeignKey("venues.id"), nullable=False),
        sa.Column("player_id", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("total_pkr", sa.Integer(), nullable=False),
        sa.Column("paid_pkr", sa.Integer(), nullable=False),
        sa.Column("due_pkr", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'awaiting_reply'")),
        sa.Column("reply_deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("replied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("player_reason", sa.Text(), nullable=True),
        sa.Column("penalty_applied", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("penalty_returned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("owner_decision", sa.String(10), nullable=True),
        sa.Column("decided_by", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution", sa.String(10), nullable=True),
        _created(),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('awaiting_reply', 'confirmed', 'disputed', 'no_reply')", name="valid_short_claim_status"),
        sa.CheckConstraint("owner_decision IS NULL OR owner_decision IN ('collect', 'waive')", name="valid_short_claim_decision"),
        sa.CheckConstraint("resolution IS NULL OR resolution IN ('paid', 'waived')", name="valid_short_claim_resolution"),
    )
    op.create_index("ix_short_payment_claims_venue_id", "short_payment_claims", ["venue_id"])
    op.create_index("ix_short_payment_claims_player_id", "short_payment_claims", ["player_id"])

    op.create_table(
        "noshow_replies",
        _id(),
        sa.Column("booking_id", _UUID, sa.ForeignKey("bookings.id"), nullable=False, unique=True),
        sa.Column("player_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("owner_decision", sa.String(10), nullable=True),
        sa.Column("decided_by", _UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        _created(),
        sa.CheckConstraint("owner_decision IS NULL OR owner_decision IN ('keep', 'reverse')", name="valid_noshow_reply_decision"),
    )

    op.create_table(
        "arrival_checks",
        _id(),
        sa.Column("booking_id", _UUID, sa.ForeignKey("bookings.id"), nullable=False, unique=True),
        sa.Column("player_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column("verdict", sa.String(20), nullable=False),
        _created(),
        sa.CheckConstraint("verdict IN ('near', 'far', 'pin_unreliable')", name="valid_arrival_verdict"),
    )

    op.add_column("venues", sa.Column("points_discount_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("venues", sa.Column("points_discount_pkr", sa.Integer(), nullable=False, server_default=sa.text("500")))
    op.create_check_constraint("valid_points_discount_pkr", "venues", "points_discount_pkr BETWEEN 0 AND 100000")
    op.add_column("bookings", sa.Column("points_discount_pkr", sa.Integer(), nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    conn = op.get_bind()
    for table in _TABLES:
        n = conn.execute(sa.text(f"SELECT count(*) FROM {table}")).scalar()
        if n:
            raise RuntimeError(f"{table} has {n} row(s) (player points / dues / replies); move them before downgrading. Nothing was changed.")
    used = conn.execute(sa.text("SELECT count(*) FROM bookings WHERE points_discount_pkr <> 0")).scalar()
    if used:
        raise RuntimeError(f"{used} booking(s) used a points discount; downgrading would lose it. Nothing was changed.")
    op.drop_column("bookings", "points_discount_pkr")
    op.drop_constraint("valid_points_discount_pkr", "venues", type_="check")
    op.drop_column("venues", "points_discount_pkr")
    op.drop_column("venues", "points_discount_enabled")
    for table in reversed(_TABLES):
        op.drop_table(table)
