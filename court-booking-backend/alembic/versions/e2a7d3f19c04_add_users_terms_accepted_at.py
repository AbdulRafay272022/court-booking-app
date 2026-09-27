"""add users.terms_accepted_at

QA signup-venue round item 9: signups now require an explicit Terms/Privacy acceptance
checkbox, and the server stamps the moment of acceptance. This column stores that
timestamp -- one row per user, NULL for accounts created before the field existed
(deliberately grandfathered rather than forcing every legacy user through a re-consent
flow the moment the migration lands). Every NEW signup must have a non-null value; that
is enforced by AuthService.verify_signup_otp, not a NOT NULL constraint, so a running
old backend served against the new schema keeps working. Additive/nullable = no rewrite
of the users table, so this is a fast metadata-only migration on Postgres.

Revision ID: e2a7d3f19c04
Revises: d4e8f1a9c2b7
Create Date: 2026-09-28 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2a7d3f19c04"
down_revision: Union[str, None] = "d4e8f1a9c2b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Additive, nullable, no default -- fast on Postgres regardless of row count.
    op.add_column(
        "users",
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "terms_accepted_at")
