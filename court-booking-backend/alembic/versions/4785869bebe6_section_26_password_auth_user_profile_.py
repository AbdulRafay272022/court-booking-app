"""section 26 password auth: user profile fields, otp purpose, login attempts

Revision ID: 4785869bebe6
Revises: 88c4d5be0fc4
Create Date: 2026-09-20 09:37:23.009224

Adds the password-auth columns, backfills `phone_verified_at` for accounts
created under the old phone+OTP-only model (every one of them was created by
passing an OTP, so `created_at` is an honest, conservative "last verified"
time), and fixes `sessions.last_active_at`, whose initial-migration default
was the *string* 'now()' -- Postgres folded that into a constant timestamp at
DDL time, so every new session started with the migration's own timestamp.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4785869bebe6'
down_revision: Union[str, None] = '88c4d5be0fc4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_otp_purpose = sa.Enum('signup', 'reverify', 'password_reset', name='otp_purpose')
_city = sa.Enum(
    'karachi', 'lahore', 'islamabad', 'rawalpindi', 'faisalabad', 'multan',
    'gujranwala', 'peshawar', 'kohat', 'hyderabad', name='city',
)
_gender = sa.Enum('male', 'female', 'other', name='gender')


def upgrade() -> None:
    op.create_table('login_attempts',
    sa.Column('phone', sa.String(length=20), nullable=False),
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_login_attempts_phone', 'login_attempts', ['phone', 'created_at'], unique=False)

    # Enum types added to *existing* tables aren't created as a side effect of
    # add_column (unlike a brand-new table), so create them explicitly first.
    bind = op.get_bind()
    _otp_purpose.create(bind, checkfirst=True)
    _city.create(bind, checkfirst=True)
    _gender.create(bind, checkfirst=True)

    op.add_column('otp_requests', sa.Column('purpose', _otp_purpose, server_default='signup', nullable=False))
    op.add_column('users', sa.Column('password_hash', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('email', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('city', _city, nullable=True))
    op.add_column('users', sa.Column('gender', _gender, nullable=True))
    op.add_column('users', sa.Column('phone_verified_at', sa.DateTime(timezone=True), nullable=True))

    # Existing accounts: no password yet (they'll hit PASSWORD_NOT_SET and set
    # one through the reset flow), phone counted as verified from creation.
    op.execute("UPDATE users SET phone_verified_at = created_at WHERE phone_verified_at IS NULL")

    op.alter_column('sessions', 'last_active_at', server_default=sa.text('now()'))


def downgrade() -> None:
    op.alter_column(
        'sessions', 'last_active_at',
        server_default=sa.text("'2026-09-19 17:01:34.204442+00'::timestamp with time zone"),
    )
    op.drop_column('users', 'phone_verified_at')
    op.drop_column('users', 'gender')
    op.drop_column('users', 'city')
    op.drop_column('users', 'email')
    op.drop_column('users', 'password_hash')
    op.drop_column('otp_requests', 'purpose')
    op.drop_index('idx_login_attempts_phone', table_name='login_attempts')
    op.drop_table('login_attempts')
    bind = op.get_bind()
    _gender.drop(bind, checkfirst=True)
    _city.drop(bind, checkfirst=True)
    _otp_purpose.drop(bind, checkfirst=True)
