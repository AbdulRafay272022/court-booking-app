"""Section 32 Part 6: review moderation/edit tracking + court photo gallery

Revision ID: c7d1a9b4e2f0
Revises: de11b783f108
Create Date: 2026-09-24 12:00:00.000000

Purely additive/nullable (plus one NOT NULL bool with a server_default), so every
existing row gets a sane value with nothing to backfill:
- reviews.is_hidden  -> admin can hide an abusive review (default false = visible)
- reviews.updated_at -> set when a player edits their review within the 7-day window
- courts.photos      -> per-court photo gallery (S3 keys), mirroring venues.photos

No CHECK/constraint changes. downgrade() drops the three columns.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "c7d1a9b4e2f0"
down_revision: Union[str, None] = "a3f9c6e2d174"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "reviews",
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("reviews", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("courts", sa.Column("photos", postgresql.ARRAY(sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("courts", "photos")
    op.drop_column("reviews", "updated_at")
    op.drop_column("reviews", "is_hidden")
