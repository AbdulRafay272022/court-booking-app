"""round2 stage2: web push subscriptions, owner CNIC identity, venue timers, notification payload

Revision ID: e5b8c2d4f6a1
Revises: c4f1a9e2d7b3
Create Date: 2026-10-20

ADDITIVE ONLY (docs/stage2-contract.md section 1). Nothing existing is dropped, rewritten or backfilled:
- creates `web_push_subscriptions` (empty) exactly as docs/web-push-plan.md section 3;
- creates `owner_identity` (empty): CNIC stored Fernet-encrypted, last4 + HMAC hash, private photo keys;
- adds 7 NULLABLE timer columns to `venues` (NULL = the default in app/services/venue_timers.py, i.e. today's
  behaviour), each with a range CHECK that every NULL satisfies, so existing rows need no change;
- adds NULLABLE `notification_log.payload` JSONB.
bookings.channel is deliberately NOT part of this revision.

Downgrade drops exactly these (losing only web push subscriptions, submitted CNICs, per-venue timer values and
log payloads; restore from the pre-migration snapshot `khelo-pre-round2-20261019-1947` if those ever matter).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e5b8c2d4f6a1"
down_revision: Union[str, None] = "c4f1a9e2d7b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_VENUE_CHECKS = (
    ("ck_venues_hold_minutes", "hold_minutes BETWEEN 5 AND 180"),
    ("ck_venues_first_reminder_after_min", "first_reminder_after_min >= 1"),
    ("ck_venues_repeat_every_min", "repeat_every_min >= 5"),
    ("ck_venues_max_reminders", "max_reminders BETWEEN 1 AND 10"),
    ("ck_venues_auto_cancel_after_min", "auto_cancel_after_min BETWEEN 5 AND 1440"),
)

_VENUE_COLUMNS = (
    ("hold_minutes", sa.SmallInteger()),
    ("reminders_enabled", sa.Boolean()),
    ("first_reminder_after_min", sa.SmallInteger()),
    ("repeat_every_min", sa.SmallInteger()),
    ("max_reminders", sa.SmallInteger()),
    ("auto_cancel_enabled", sa.Boolean()),
    ("auto_cancel_after_min", sa.SmallInteger()),
)


def upgrade() -> None:
    # 1. Web Push subscriptions.
    op.create_table(
        "web_push_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(255), nullable=False),
        sa.Column("auth", sa.String(255), nullable=False),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("endpoint", name="uq_web_push_endpoint"),
    )
    op.create_index(
        "idx_web_push_user_active", "web_push_subscriptions", ["user_id"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        "idx_web_push_revoked", "web_push_subscriptions", ["revoked_at"],
        postgresql_where=sa.text("revoked_at IS NOT NULL"),
    )

    # 2. Owner identity (CNIC).
    op.create_table(
        "owner_identity",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cnic_encrypted", postgresql.JSONB(), nullable=False),
        sa.Column("cnic_last4", sa.CHAR(4), nullable=False),
        sa.Column("cnic_hash", sa.CHAR(64), nullable=False),
        sa.Column("front_key", sa.String(512), nullable=False),
        sa.Column("back_key", sa.String(512), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("flags", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", name="owner_identity_user_id_key"),
    )
    op.create_index("ix_owner_identity_cnic_hash", "owner_identity", ["cnic_hash"])

    # 3. Venue timers (all nullable; NULL = default).
    for name, type_ in _VENUE_COLUMNS:
        op.add_column("venues", sa.Column(name, type_, nullable=True))
    for name, cond in _VENUE_CHECKS:
        op.create_check_constraint(name, "venues", cond)

    # 4. Notification payload.
    op.add_column("notification_log", sa.Column("payload", postgresql.JSONB(), nullable=True))
    print("[migration e5b8c2d4f6a1] created web_push_subscriptions + owner_identity (empty); "
          "added 7 nullable venue timer columns and notification_log.payload; no rows changed")


def downgrade() -> None:
    op.drop_column("notification_log", "payload")
    for name, _ in reversed(_VENUE_CHECKS):
        op.drop_constraint(name, "venues", type_="check")
    for name, _ in reversed(_VENUE_COLUMNS):
        op.drop_column("venues", name)
    op.drop_index("ix_owner_identity_cnic_hash", table_name="owner_identity")
    op.drop_table("owner_identity")
    op.drop_index("idx_web_push_revoked", table_name="web_push_subscriptions")
    op.drop_index("idx_web_push_user_active", table_name="web_push_subscriptions")
    op.drop_table("web_push_subscriptions")
