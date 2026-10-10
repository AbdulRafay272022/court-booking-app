"""drop venues.plan_tier (retired by owner premium billing)

Revision ID: b7d2e4f6a801
Revises: 571434c2a7b3
Create Date: 2026-10-11

The Free / Pro / Business tier was replaced by per-feature owner premium billing (steps 1-5); since step 4 nothing in the
code reads this column. Dropping it loses the tier each venue had. On production there was one venue, on Free. Any venue
that was NOT on Free is counted into the migration log before the column goes, so the value is not lost silently.

Downgrade puts the column and its enum type back with every venue on 'free' (the original values are not recoverable;
restore from the pre-migration snapshot if they ever matter).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7d2e4f6a801"
down_revision: Union[str, None] = "571434c2a7b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    paid = bind.execute(sa.text("SELECT plan_tier::text, count(*) FROM venues WHERE plan_tier <> 'free' GROUP BY 1")).fetchall()
    print(f"[migration b7d2e4f6a801] dropping venues.plan_tier; venues not on 'free': {[tuple(r) for r in paid] or 'none'}")
    op.drop_column("venues", "plan_tier")
    sa.Enum(name="plan_tier").drop(bind, checkfirst=True)


def downgrade() -> None:
    plan_tier = sa.Enum("free", "pro", "business", name="plan_tier")
    plan_tier.create(op.get_bind(), checkfirst=True)
    op.add_column("venues", sa.Column("plan_tier", plan_tier, server_default="free", nullable=False))
