"""overnight courts: schedule_templates.closes_next_day

Section 32 Part 3.

A court may now stay open past midnight (3 PM to 3 AM, 6 PM to 6 AM). A schedule day belongs to the day it OPENS. The
template gets an explicit `closes_next_day` flag (set by the API exactly when close_time <= open_time: close 03:00 vs open
15:00 = next morning, close == open = open 24 hours, close 00:00 = midnight) and the CHECK `open_time < close_time` is
replaced by one that allows either shape.

Safe on production data: the new column defaults to false, so every existing row keeps meaning exactly what it did (they
all satisfy the old CHECK, so they satisfy the new one). ADD COLUMN with a constant default is instant in PostgreSQL 11+;
the CHECK is validated against a handful of rows. No data is rewritten.

Downgrade REFUSES (changing nothing) if any overnight template exists, because the old CHECK cannot represent one; the
owner must first change those hours to same-day hours. It never rewrites or drops an owner's hours to make itself fit.

Revision ID: 68d7e3464f30
Revises: dd23d75cf310
Create Date: 2026-09-22 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '68d7e3464f30'
down_revision: Union[str, None] = 'dd23d75cf310'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_CHECK = "(closes_next_day AND close_time <= open_time) OR (NOT closes_next_day AND open_time < close_time)"


def upgrade() -> None:
    conn = op.get_bind()
    bad = conn.execute(sa.text("SELECT count(*) FROM schedule_templates WHERE NOT (open_time < close_time)")).scalar()
    if bad:
        raise RuntimeError(
            f"{bad} existing schedule row(s) violate the old open < close rule, which should be impossible. "
            "Nothing was changed; investigate before migrating."
        )
    op.add_column(
        'schedule_templates',
        sa.Column('closes_next_day', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.drop_constraint('valid_times', 'schedule_templates', type_='check')
    op.create_check_constraint('valid_times', 'schedule_templates', NEW_CHECK)
    n = conn.execute(sa.text("SELECT count(*) FROM schedule_templates")).scalar()
    print(f"\n[migration 68d7e3464f30] closes_next_day added (default false); {n} existing schedule row(s) unchanged and valid.")


def downgrade() -> None:
    conn = op.get_bind()
    overnight = conn.execute(
        sa.text(
            """
            SELECT c.name, t.day_of_week, t.open_time::text AS open_time, t.close_time::text AS close_time
            FROM schedule_templates t JOIN courts c ON c.id = t.court_id
            WHERE t.closes_next_day ORDER BY c.name, t.day_of_week
            """
        )
    ).fetchall()
    if overnight:
        rows = "\n".join(f"  {r.name}: weekday {r.day_of_week} {r.open_time} -> {r.close_time} (next day)" for r in overnight)
        raise RuntimeError(
            f"Cannot downgrade: {len(overnight)} overnight schedule row(s) exist and the old rule cannot represent them. "
            f"Nothing was changed. Change these courts to same-day hours first:\n{rows}"
        )
    op.drop_constraint('valid_times', 'schedule_templates', type_='check')
    op.create_check_constraint('valid_times', 'schedule_templates', 'open_time < close_time')
    op.drop_column('schedule_templates', 'closes_next_day')
