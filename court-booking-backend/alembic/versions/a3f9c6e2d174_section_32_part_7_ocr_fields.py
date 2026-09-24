"""Section 32 Part 7: OCR payer/bank/receiver fields and check verdicts on payments

Revision ID: a3f9c6e2d174
Revises: de11b783f108
Create Date: 2026-09-24 00:00:00.000000

Purely additive/nullable -- existing payment rows get NULL for every new
column (there is nothing to backfill: these fields didn't exist to be
extracted at the time older rows were submitted), same convention as the
original ocr_amount/ocr_ref/ocr_verdict columns. No CHECK constraints and
no index changes, so this is a fast, safe upgrade on a table that can grow
large. downgrade() simply drops the columns -- there is no case where that
loses data anyone still reads by another path.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a3f9c6e2d174'
down_revision: Union[str, None] = 'de11b783f108'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('payments', sa.Column('ocr_payer_name', sa.String(length=200), nullable=True))
    op.add_column('payments', sa.Column('ocr_bank', sa.String(length=100), nullable=True))
    op.add_column('payments', sa.Column('ocr_receiver', sa.String(length=200), nullable=True))
    op.add_column('payments', sa.Column('ocr_flags', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('payments', sa.Column('name_match_verdict', sa.String(length=20), nullable=True))
    op.add_column('payments', sa.Column('time_check_verdict', sa.String(length=20), nullable=True))
    op.add_column('payments', sa.Column('receiver_match_verdict', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('payments', 'receiver_match_verdict')
    op.drop_column('payments', 'time_check_verdict')
    op.drop_column('payments', 'name_match_verdict')
    op.drop_column('payments', 'ocr_flags')
    op.drop_column('payments', 'ocr_receiver')
    op.drop_column('payments', 'ocr_bank')
    op.drop_column('payments', 'ocr_payer_name')
