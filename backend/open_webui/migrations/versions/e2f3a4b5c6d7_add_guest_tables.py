"""Add guest access tables (guest_usage_daily, guest_ip_blacklist)

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-06-09 00:00:01.000000

Backs the guest (anonymous) access feature: per-IP / per-device daily usage
counters and an admin-managed IP blacklist.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_tables() -> set:
    insp = sa.inspect(op.get_bind())
    return set(insp.get_table_names())


def upgrade() -> None:
    tables = _existing_tables()

    if 'guest_usage_daily' not in tables:
        op.create_table(
            'guest_usage_daily',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('scope', sa.String(), nullable=False),
            sa.Column('key', sa.String(), nullable=False),
            sa.Column('date', sa.String(), nullable=False),
            sa.Column('count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('updated_at', sa.BigInteger(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('idx_guest_usage_daily_key', 'guest_usage_daily', ['key'])

    if 'guest_ip_blacklist' not in tables:
        op.create_table(
            'guest_ip_blacklist',
            sa.Column('ip', sa.String(), nullable=False),
            sa.Column('reason', sa.String(), nullable=True),
            sa.Column('created_by', sa.String(), nullable=True),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
            sa.PrimaryKeyConstraint('ip'),
        )


def downgrade() -> None:
    tables = _existing_tables()
    if 'guest_usage_daily' in tables:
        op.drop_index('idx_guest_usage_daily_key', table_name='guest_usage_daily')
        op.drop_table('guest_usage_daily')
    if 'guest_ip_blacklist' in tables:
        op.drop_table('guest_ip_blacklist')
