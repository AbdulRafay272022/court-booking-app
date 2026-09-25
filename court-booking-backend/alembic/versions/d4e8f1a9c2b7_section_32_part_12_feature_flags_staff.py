"""Section 32 Part 12: admin feature flags + owner staff/permissions

Revision ID: d4e8f1a9c2b7
Revises: c7d1a9b4e2f0
Create Date: 2026-09-25 00:00:00.000000

Additive only -- no existing table is altered, no data backfilled:
- user_role enum gains 'staff' (irreversible in downgrade: Postgres can't drop
  an enum value, same as the earlier 'phone_change' addition -- harmless leftover).
- feature_flags: one row per global kill switch, all seeded ENABLED so behavior
  is identical to today until an admin flips one. A missing row is treated as ON
  at read time (fail-open), so the seed is a convenience, not a correctness gate.
- staff_members: an owner's staff/manager account attached to one of the owner's
  venues (unique per staff_user + venue).
- staff_permissions: the individual owner actions granted to a staff member
  (presence of a row = granted).

downgrade() drops the three tables; it cannot remove the 'staff' enum value.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "d4e8f1a9c2b7"
down_revision: Union[str, None] = "c7d1a9b4e2f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# key -> (label, description). Mirrors app/models/feature_flag.py FEATURE_FLAG_SEED;
# duplicated here so the migration is self-contained (migrations never import app code).
_FLAG_SEED: list[tuple[str, str, str]] = [
    ("ocr_verification", "AI payment verification",
     "Auto-read payment screenshots and show verdicts. OFF: owner reviews every screenshot by eye."),
    ("qr_checkin", "QR check-in",
     "QR generate/scan check-in. OFF: owner marks checked-in / no-show manually from the dashboard."),
    ("split_payments", "Split payments",
     "Partial advance + balance and the payment ledger UI. OFF: new bookings require full payment upfront."),
    ("refunds", "Manual refunds",
     "Owner refund tracking + mark-refunded. OFF: no new refund actions (already-owed refunds stay visible)."),
    ("ai_chat_booking", "AI chat booking",
     "AI 'do you want to book' assistant. OFF: booking through app screens only; support chat still works."),
    ("photos", "Venue photos",
     "Photo galleries on venue/court pages. OFF: venues show core info only."),
    ("reviews", "Ratings & reviews",
     "Player ratings and reviews. OFF: review/rating sections hidden everywhere."),
    ("growth_suggestions", "Discount suggestions",
     "Underbooked-slot discount suggestions for owners. OFF: no suggestions surfaced."),
    ("push_notifications", "Notifications",
     "Push / WhatsApp notification side effects. OFF: notifications suppressed; booking logic unaffected."),
    ("auto_approve", "Auto-approve payments",
     "Auto-confirm eligible payments without owner tap. OFF: every payment goes to manual review."),
    ("waitlist", "Waitlist",
     "'Notify me' on booked slots. OFF: waitlist join hidden; no availability notifications."),
    ("marketing_announcements", "Announcements",
     "Owner paid broadcast announcements. OFF: the announcement action is disabled."),
    ("digest_reminders", "Digest & reminders",
     "Owner daily digest and booking reminder jobs. OFF: those scheduled messages stop sending."),
]


def upgrade() -> None:
    # 1. Add the 'staff' role. IF NOT EXISTS so a re-run is safe. PG 12+ allows
    #    ADD VALUE inside a transaction as long as the value isn't used in the
    #    same transaction (it isn't -- no row here uses it).
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'staff'")

    # 2. feature_flags
    feature_flags = op.create_table(
        "feature_flags",
        sa.Column("key", sa.String(length=50), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("label", sa.String(length=100), nullable=False, server_default=sa.text("''")),
        sa.Column("description", sa.String(length=300), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.bulk_insert(
        feature_flags,
        [{"key": k, "enabled": True, "label": label, "description": desc} for k, label, desc in _FLAG_SEED],
    )

    # 3. staff_members
    op.create_table(
        "staff_members",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("staff_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("venue_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("invited_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["staff_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["venue_id"], ["venues.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("staff_user_id", "venue_id", name="uq_staff_user_venue"),
    )
    op.create_index("ix_staff_members_staff_user_id", "staff_members", ["staff_user_id"])
    op.create_index("ix_staff_members_venue_id", "staff_members", ["venue_id"])

    # 4. staff_permissions
    op.create_table(
        "staff_permissions",
        sa.Column("staff_member_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("permission", sa.String(length=50), primary_key=True),
        sa.ForeignKeyConstraint(["staff_member_id"], ["staff_members.id"], ondelete="CASCADE"),
    )


def downgrade() -> None:
    op.drop_table("staff_permissions")
    op.drop_index("ix_staff_members_venue_id", table_name="staff_members")
    op.drop_index("ix_staff_members_staff_user_id", table_name="staff_members")
    op.drop_table("staff_members")
    op.drop_table("feature_flags")
    # The 'staff' value stays in the user_role enum -- Postgres cannot drop an
    # enum value. Harmless: no row will reference it after the tables are gone.
