"""Section 32 Part 10 refund tracking

Extends payment_disputes (not a parallel table) with refund_amount/refund_status/refunded_amount/
refund_reference/refund_screenshot_key/refunded_by_user_id/refunded_at so a manual (no payment
gateway) refund can be tracked end to end on the same row that already flags "player probably paid,
got no booking"/"player cancelled a paid booking" cases.

refund_amount is backfilled for existing rows: 0 for reason='payment_review_expired' (the payment
was never approved, so nothing was actually recorded as paid -- see BookingService._flag_unclaimed_payments),
and the booking's own amount_paid for reason='player_cancelled_paid_booking' (a voluntary cancel that
already passed _enforce_cancellation_policy is always fully refundable -- there is no code path where a
cancel succeeds "inside the cutoff" for a partial amount to apply to).

Safe on production data: ADD COLUMN with a constant/computed default, nothing rewritten destructively.
Downgrade drops the new columns -- the only information lost is refund-tracking state itself (which
disputes still need chasing, what was actually refunded and by whom), not any booking/payment data.

Revision ID: a3f7c9d2e185
Revises: de11b783f108
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a3f7c9d2e185'
down_revision: Union[str, None] = 'de11b783f108'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('payment_disputes', sa.Column('refund_amount', sa.Numeric(10, 2), nullable=True))
    op.add_column(
        'payment_disputes',
        sa.Column('refund_status', sa.String(20), server_default=sa.text("'owed'"), nullable=False),
    )
    op.add_column('payment_disputes', sa.Column('refunded_amount', sa.Numeric(10, 2), nullable=True))
    op.add_column('payment_disputes', sa.Column('refund_reference', sa.Text(), nullable=True))
    op.add_column('payment_disputes', sa.Column('refund_screenshot_key', sa.String(512), nullable=True))
    op.add_column(
        'payment_disputes',
        sa.Column('refunded_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column('payment_disputes', sa.Column('refunded_at', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        'fk_payment_disputes_refunded_by_user_id', 'payment_disputes', 'users', ['refunded_by_user_id'], ['id']
    )
    op.create_check_constraint(
        'valid_refund_status', 'payment_disputes', "refund_status IN ('owed', 'refunded')"
    )

    bind = op.get_bind()
    zeroed = bind.execute(
        sa.text(
            "UPDATE payment_disputes SET refund_amount = 0 "
            "WHERE reason = 'payment_review_expired' AND refund_amount IS NULL"
        )
    ).rowcount
    backfilled = bind.execute(
        sa.text(
            "UPDATE payment_disputes SET refund_amount = bookings.amount_paid "
            "FROM bookings "
            "WHERE payment_disputes.booking_id = bookings.id "
            "AND payment_disputes.reason = 'player_cancelled_paid_booking' "
            "AND payment_disputes.refund_amount IS NULL"
        )
    ).rowcount
    print(
        f"\n[migration a3f7c9d2e185] refund tracking added to payment_disputes; "
        f"backfilled refund_amount=0 on {zeroed} payment_review_expired row(s) and "
        f"refund_amount=amount_paid on {backfilled} player_cancelled_paid_booking row(s)."
    )


def downgrade() -> None:
    op.drop_constraint('valid_refund_status', 'payment_disputes', type_='check')
    op.drop_constraint('fk_payment_disputes_refunded_by_user_id', 'payment_disputes', type_='foreignkey')
    op.drop_column('payment_disputes', 'refunded_at')
    op.drop_column('payment_disputes', 'refunded_by_user_id')
    op.drop_column('payment_disputes', 'refund_screenshot_key')
    op.drop_column('payment_disputes', 'refund_reference')
    op.drop_column('payment_disputes', 'refunded_amount')
    op.drop_column('payment_disputes', 'refund_status')
    op.drop_column('payment_disputes', 'refund_amount')
