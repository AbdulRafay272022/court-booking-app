"""favorite_venues: players can save venues

Revision ID: c4f1a9e2d7b3
Revises: b7d2e4f6a801
Create Date: 2026-10-11

Adds one table. Nothing existing is altered or backfilled, so the upgrade cannot lose data and is safe to run on a
populated database: it only creates `favorite_venues` (primary key = user_id + venue_id, both ON DELETE CASCADE) and one
index for "this user's favorites, newest first".

Downgrade drops the table (and with it every saved venue); restore from the pre-migration snapshot if those ever matter.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4f1a9e2d7b3"
down_revision: Union[str, None] = "b7d2e4f6a801"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "favorite_venues",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("venue_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("venues.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_favorite_venues_user", "favorite_venues", ["user_id", "created_at"])
    print("[migration c4f1a9e2d7b3] created favorite_venues (empty)")


def downgrade() -> None:
    op.drop_index("idx_favorite_venues_user", table_name="favorite_venues")
    op.drop_table("favorite_venues")
