"""email unique (case-insensitive) and phone change otp

Revision ID: 651abc777d2c
Revises: 4785869bebe6
Create Date: 2026-09-20 17:02:58.256154

Two things, deliberately in one release:

1. `otp_requests.user_id` + the `phone_change` OTP purpose, for the authenticated
   change-phone flow (the code goes to the NEW number, so the row needs to say which user
   asked for it).
2. A case-insensitive UNIQUE index on `lower(users.email)`. Before creating it this migration
   looks for existing duplicates and resolves them instead of failing or silently dropping
   data: the earliest account (created_at, then id) keeps the address; every later duplicate has
   its email set to NULL, and each one is recorded in `audit_log` (old value included) and
   printed to the migration output. Emails are contact-only (not a login identifier), so a NULLed
   email costs that account nothing but a contact address it can re-enter from Edit profile.
   Production, checked 2026-09-20 before this was written: 1 user, no `email` column yet (the
   previous migration adds it), so there is nothing to resolve there.
"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '651abc777d2c'
down_revision: Union[str, None] = '4785869bebe6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _resolve_duplicate_emails() -> None:
    bind = op.get_bind()
    total = bind.execute(sa.text("SELECT count(*) FROM users WHERE email IS NOT NULL")).scalar()
    rows = bind.execute(
        sa.text(
            """
            SELECT id, email, created_at,
                   row_number() OVER (PARTITION BY lower(email) ORDER BY created_at, id) AS rn,
                   first_value(id) OVER (PARTITION BY lower(email) ORDER BY created_at, id) AS keeper
            FROM users WHERE email IS NOT NULL
            """
        )
    ).fetchall()
    losers = [r for r in rows if r.rn > 1]
    print(f"[651abc777d2c] email uniqueness: checked {total} email(s), found {len(losers)} duplicate(s) to resolve")
    for r in losers:
        print(f"[651abc777d2c]   NULLing {r.email!r} on user {r.id} (created {r.created_at}); kept on user {r.keeper}")
        bind.execute(
            sa.text(
                "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, actor_type) "
                "VALUES ('user', :id, 'email_deduplicated_by_migration', CAST(:old AS jsonb), CAST(:new AS jsonb), 'system')"
            ),
            {"id": r.id, "old": json.dumps({"email": r.email, "kept_by_user": str(r.keeper)}), "new": json.dumps({"email": None})},
        )
        bind.execute(sa.text("UPDATE users SET email = NULL WHERE id = :id"), {"id": r.id})


def upgrade() -> None:
    # New OTP purpose. (Postgres can't drop an enum value again, so downgrade leaves it.)
    op.execute("ALTER TYPE otp_purpose ADD VALUE IF NOT EXISTS 'phone_change'")

    op.add_column('otp_requests', sa.Column('user_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_otp_requests_user_id'), 'otp_requests', ['user_id'], unique=False)
    op.create_foreign_key('fk_otp_requests_user_id', 'otp_requests', 'users', ['user_id'], ['id'], ondelete='CASCADE')

    _resolve_duplicate_emails()
    op.create_index('uq_users_email_lower', 'users', [sa.literal_column('lower(email)')], unique=True)


def downgrade() -> None:
    op.drop_index('uq_users_email_lower', table_name='users')
    op.drop_constraint('fk_otp_requests_user_id', 'otp_requests', type_='foreignkey')
    op.drop_index(op.f('ix_otp_requests_user_id'), table_name='otp_requests')
    op.drop_column('otp_requests', 'user_id')
    # The 'phone_change' value stays in the otp_purpose enum: Postgres has no ALTER TYPE ... DROP VALUE.
