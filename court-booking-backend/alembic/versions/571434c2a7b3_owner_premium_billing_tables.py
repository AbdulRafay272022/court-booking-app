"""owner premium billing tables

Revision ID: 571434c2a7b3
Revises: e2a7d3f19c04
Create Date: 2026-10-10 18:59:40.661672

Owner premium billing, step 1. ADDITIVE ONLY -- no existing table is altered and no existing row is changed:
- five new tables: premium_features, owner_features, owner_invoices, owner_invoice_lines, owner_payments
- premium_features is seeded with the six sellable features at price 0 and NOT sellable, so nothing can be bought
  (and nothing is billed) until an admin sets a price
- one new row in feature_flags, `owner_billing_enforced`, seeded OFF (the one flag that also fails closed when its row is
  missing), so no owner loses any feature until enforcement is deliberately switched on

downgrade() drops the five tables and deletes that one feature_flags row.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# key, label, description. Mirrors app/models/feature_flag.py; duplicated so the migration is self-contained.
_PREMIUM_SEED = [
    ('ai_chat_booking', 'AI chat booking', "The AI assistant that finds and books courts in chat (app and WhatsApp)."),
    ('auto_approve', 'Auto-approve payments', 'Eligible payments are confirmed without the owner tapping approve.'),
    ('digest_reminders', 'Digest & reminders', 'Owner daily digest and booking reminder messages.'),
    ('growth_suggestions', 'Discount suggestions', 'Underbooked-slot discount suggestions.'),
    ('marketing_announcements', 'Announcements', 'Broadcast announcements to past players (monthly send allowance).'),
    ('ocr_verification', 'AI payment verification', 'Payment screenshots are read automatically and checked.'),
]


# revision identifiers, used by Alembic.
revision: str = '571434c2a7b3'
down_revision: Union[str, None] = 'e2a7d3f19c04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('owner_invoices',
    sa.Column('owner_id', sa.UUID(), nullable=False),
    sa.Column('period_start', sa.Date(), nullable=False),
    sa.Column('period_end', sa.Date(), nullable=False),
    sa.Column('total_pkr', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), server_default=sa.text("'issued'"), nullable=False),
    sa.Column('due_date', sa.Date(), nullable=False),
    sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('approved_by_user_id', sa.UUID(), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('issued', 'proof_submitted', 'paid', 'void', 'expired')", name='owner_invoice_status_valid'),
    sa.CheckConstraint('period_end >= period_start', name='owner_invoice_period_valid'),
    sa.CheckConstraint('total_pkr >= 0', name='owner_invoice_total_not_negative'),
    sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_owner_invoices_owner_id'), 'owner_invoices', ['owner_id'], unique=False)
    op.create_index('uq_owner_invoice_cycle', 'owner_invoices', ['owner_id', 'period_start'], unique=True, postgresql_where=sa.text("status <> 'void'"))
    op.create_table('premium_features',
    sa.Column('key', sa.String(length=50), nullable=False),
    sa.Column('label', sa.String(length=100), nullable=False),
    sa.Column('description', sa.String(length=300), nullable=True),
    sa.Column('monthly_price_pkr', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('is_sellable', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('updated_by_user_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('monthly_price_pkr >= 0', name='premium_price_not_negative'),
    sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('owner_features',
    sa.Column('owner_id', sa.UUID(), nullable=False),
    sa.Column('feature_key', sa.String(length=50), nullable=False),
    sa.Column('status', sa.String(length=20), server_default=sa.text("'active'"), nullable=False),
    sa.Column('paid_through', sa.Date(), nullable=True),
    sa.Column('price_pkr', sa.Integer(), nullable=False),
    sa.Column('auto_renew', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('enabled_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('active', 'past_due', 'lapsed', 'cancelled')", name='owner_feature_status_valid'),
    sa.CheckConstraint('price_pkr >= 0', name='owner_feature_price_not_negative'),
    sa.ForeignKeyConstraint(['feature_key'], ['premium_features.key'], ),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('owner_id', 'feature_key', name='uq_owner_feature')
    )
    op.create_index(op.f('ix_owner_features_owner_id'), 'owner_features', ['owner_id'], unique=False)
    op.create_table('owner_invoice_lines',
    sa.Column('invoice_id', sa.UUID(), nullable=False),
    sa.Column('feature_key', sa.String(length=50), nullable=False),
    sa.Column('amount_pkr', sa.Integer(), nullable=False),
    sa.Column('description', sa.String(length=200), nullable=True),
    sa.Column('period_start', sa.Date(), nullable=False),
    sa.Column('period_end', sa.Date(), nullable=False),
    sa.Column('prorated_days', sa.Integer(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('amount_pkr >= 0', name='owner_invoice_line_not_negative'),
    sa.ForeignKeyConstraint(['feature_key'], ['premium_features.key'], ),
    sa.ForeignKeyConstraint(['invoice_id'], ['owner_invoices.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_owner_invoice_lines_invoice_id'), 'owner_invoice_lines', ['invoice_id'], unique=False)
    op.create_table('owner_payments',
    sa.Column('invoice_id', sa.UUID(), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=False),
    sa.Column('amount_pkr', sa.Integer(), nullable=False),
    sa.Column('method', sa.String(length=30), server_default=sa.text("'bank_transfer_proof'"), nullable=False),
    sa.Column('status', sa.String(length=20), server_default=sa.text("'submitted'"), nullable=False),
    sa.Column('proof_key', sa.String(length=500), nullable=True),
    sa.Column('proof_hash', sa.String(length=64), nullable=True),
    sa.Column('reference', sa.String(length=100), nullable=True),
    sa.Column('rejection_reason', sa.Text(), nullable=True),
    sa.Column('recorded_by_user_id', sa.UUID(), nullable=True),
    sa.Column('reviewed_by_user_id', sa.UUID(), nullable=True),
    sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('reverses_payment_id', sa.UUID(), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(status = 'reversal' AND amount_pkr < 0) OR (status <> 'reversal' AND amount_pkr > 0)", name='owner_payment_sign_matches_status'),
    sa.CheckConstraint("(status = 'reversal') = (reverses_payment_id IS NOT NULL)", name='owner_payment_reversal_points_at_a_payment'),
    sa.CheckConstraint("status IN ('submitted', 'approved', 'rejected', 'reversal')", name='owner_payment_status_valid'),
    sa.ForeignKeyConstraint(['invoice_id'], ['owner_invoices.id'], ),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['recorded_by_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['reverses_payment_id'], ['owner_payments.id'], ),
    sa.ForeignKeyConstraint(['reviewed_by_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_owner_payments_invoice_id'), 'owner_payments', ['invoice_id'], unique=False)
    op.create_index(op.f('ix_owner_payments_owner_id'), 'owner_payments', ['owner_id'], unique=False)
    op.create_index('one_pending_owner_payment_per_invoice', 'owner_payments', ['invoice_id'], unique=True, postgresql_where=sa.text("status = 'submitted'"))

    premium = sa.table(
        'premium_features',
        sa.column('key', sa.String), sa.column('label', sa.String), sa.column('description', sa.String),
        sa.column('monthly_price_pkr', sa.Integer), sa.column('is_sellable', sa.Boolean),
    )
    op.bulk_insert(
        premium,
        [{'key': k, 'label': label, 'description': desc, 'monthly_price_pkr': 0, 'is_sellable': False} for k, label, desc in _PREMIUM_SEED],
    )
    op.execute(
        "INSERT INTO feature_flags (key, enabled, label, description) VALUES ("
        "'owner_billing_enforced', false, 'Owner billing enforcement', "
        "'ON: premium features need a paid plan or the free trial. OFF (default): every owner keeps every feature, nothing is charged.')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM feature_flags WHERE key = 'owner_billing_enforced'")
    op.drop_index('one_pending_owner_payment_per_invoice', table_name='owner_payments', postgresql_where=sa.text("status = 'submitted'"))
    op.drop_index(op.f('ix_owner_payments_owner_id'), table_name='owner_payments')
    op.drop_index(op.f('ix_owner_payments_invoice_id'), table_name='owner_payments')
    op.drop_table('owner_payments')
    op.drop_index(op.f('ix_owner_invoice_lines_invoice_id'), table_name='owner_invoice_lines')
    op.drop_table('owner_invoice_lines')
    op.drop_index(op.f('ix_owner_features_owner_id'), table_name='owner_features')
    op.drop_table('owner_features')
    op.drop_table('premium_features')
    op.drop_index('uq_owner_invoice_cycle', table_name='owner_invoices', postgresql_where=sa.text("status <> 'void'"))
    op.drop_index(op.f('ix_owner_invoices_owner_id'), table_name='owner_invoices')
    op.drop_table('owner_invoices')
