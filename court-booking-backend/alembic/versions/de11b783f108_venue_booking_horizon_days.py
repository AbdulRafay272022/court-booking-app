"""venue booking horizon days

Section 32 Part 4b.

venues.booking_horizon_days: how many days ahead a player can book at this venue. A per-venue setting (default 90, allowed
1 to 365), not a constant: the calendar stops there and holds beyond it are refused (an owner's walk-in is not limited).

Safe on production data: ADD COLUMN with a constant default is instant in PostgreSQL 11+ and every existing venue gets 90;
the CHECK is validated against a handful of rows. Nothing is rewritten. Downgrade drops the check and the column (the only
information lost is the horizon setting itself).

Revision ID: de11b783f108
Revises: 68d7e3464f30
Create Date: 2026-09-22 22:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'de11b783f108'
down_revision: Union[str, None] = '68d7e3464f30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('venues', sa.Column('booking_horizon_days', sa.Integer(), server_default=sa.text('90'), nullable=False))
    op.create_check_constraint('valid_booking_horizon', 'venues', 'booking_horizon_days BETWEEN 1 AND 365')
    n = op.get_bind().execute(sa.text("SELECT count(*) FROM venues")).scalar()
    print(f"\n[migration de11b783f108] booking_horizon_days added (default 90); {n} existing venue(s) now allow booking 90 days ahead.")


def downgrade() -> None:
    op.drop_constraint('valid_booking_horizon', 'venues', type_='check')
    op.drop_column('venues', 'booking_horizon_days')
