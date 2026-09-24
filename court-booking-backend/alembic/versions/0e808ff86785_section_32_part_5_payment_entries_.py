"""section 32 part 5 payment entries ledger and court advance rule

Section 32 Part 5. `payment_entries` is the new append-only ledger of real money recorded against a
booking (separate from `payments`, which is OCR payment-PROOF review) -- `bookings.amount_paid`/
`balance_due` are always recomputed from the sum of a booking's entries from here on (see
`payment_ledger_service.recompute_payment_totals`); nothing else writes them.

Safe on existing data: backfills one payment_entries row per existing booking with amount_paid > 0, so the
ledger reflects real history from day one instead of starting blank on top of already-paid bookings. The
method is inferred (a walk-in was cash at the venue; anything else only ever got money through the app's
payment-proof review, i.e. a bank transfer) since the real method was never recorded before this. Nothing
in `bookings` itself is rewritten -- amount_paid/balance_due keep their existing values, which now simply
equal the sum of the backfilled entries.

`courts.advance_type`/`advance_value`/`advance_minimum` are new nullable columns (no existing court has a
value, so every court keeps its current behavior -- the advance comes from the matched pricing rule's own
advance_percentage, exactly as before -- until an owner explicitly sets a court-level rule).

Downgrade drops both additions. The only information lost is the per-payment ledger detail and any
court-level advance rule an owner configured -- bookings.amount_paid/balance_due (already independent
columns) are untouched.

Revision ID: 0e808ff86785
Revises: de11b783f108
Create Date: 2026-09-23 05:39:11.511684

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0e808ff86785'
down_revision: Union[str, None] = 'de11b783f108'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # payment_method is created as a side effect of create_table below (a new table, unlike add_column on an
    # existing one, auto-creates an enum type it references). court_advance_type is used on an ADD COLUMN
    # against the existing `courts` table, which does NOT auto-create it -- create it explicitly first,
    # matching ca2c0190ac2a's plan_tier precedent.
    court_advance_type_enum = sa.Enum('fixed', 'percent', name='court_advance_type')
    court_advance_type_enum.create(op.get_bind(), checkfirst=True)

    op.create_table('payment_entries',
    sa.Column('booking_id', sa.UUID(), nullable=False),
    sa.Column('amount_pkr', sa.Integer(), nullable=False),
    sa.Column('method', sa.Enum('bank_transfer_proof', 'cash_at_venue', 'other', name='payment_method'), nullable=False),
    sa.Column('recorded_by', sa.UUID(), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('reverses_entry_id', sa.UUID(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], ),
    sa.ForeignKeyConstraint(['recorded_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['reverses_entry_id'], ['payment_entries.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_payment_entries_booking_id'), 'payment_entries', ['booking_id'], unique=False)
    op.add_column('courts', sa.Column('advance_type', court_advance_type_enum, nullable=True))
    op.add_column('courts', sa.Column('advance_value', sa.Numeric(precision=10, scale=2), nullable=True))
    op.add_column('courts', sa.Column('advance_minimum', sa.Integer(), nullable=True))

    bind = op.get_bind()
    result = bind.execute(sa.text(
        """
        INSERT INTO payment_entries (booking_id, amount_pkr, method, note)
        SELECT id, ROUND(amount_paid)::integer,
               (CASE WHEN source = 'walkin' THEN 'cash_at_venue' ELSE 'bank_transfer_proof' END)::payment_method,
               'Backfilled from bookings.amount_paid at Part 5 migration'
        FROM bookings
        WHERE amount_paid > 0
        RETURNING 1
        """
    ))
    backfilled = result.rowcount
    print(f"\n[migration 0e808ff86785] payment_entries created; {backfilled} existing booking(s) with "
          f"amount_paid > 0 backfilled with one entry each; courts.advance_type/advance_value/advance_minimum "
          f"added (all null -- no court's advance behavior changes until an owner sets one).")


def downgrade() -> None:
    op.drop_column('courts', 'advance_minimum')
    op.drop_column('courts', 'advance_value')
    op.drop_column('courts', 'advance_type')
    op.drop_index(op.f('ix_payment_entries_booking_id'), table_name='payment_entries')
    op.drop_table('payment_entries')

    # Alembic's autogenerate doesn't emit DROP TYPE for enum columns -- drop them explicitly now that every
    # table/column using them is gone (matches 3059bec979b7's initial-schema precedent).
    from sqlalchemy.dialects import postgresql

    bind = op.get_bind()
    for enum_name in ('payment_method', 'court_advance_type'):
        postgresql.ENUM(name=enum_name).drop(bind, checkfirst=True)
