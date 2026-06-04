"""Add gift card table

Revision ID: a7b8c9d0e1f2
Revises: f0a1b2c3d4e5
Create Date: 2026-06-04 04:00:00.000000

Adds the gift card / redemption code table for the USDT subscription system:
- subscription_gift_card : admin-generated single-use codes that grant a tier on redemption
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from open_webui.migrations.util import get_existing_tables

revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = 'f0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing_tables = set(get_existing_tables())

    if 'subscription_gift_card' not in existing_tables:
        op.create_table(
            'subscription_gift_card',
            sa.Column('code', sa.String(), nullable=False, primary_key=True),
            sa.Column('tier_id', sa.String(), nullable=False),
            sa.Column('duration_days', sa.Integer(), nullable=False),
            sa.Column('batch_id', sa.String(), nullable=True),
            sa.Column('note', sa.String(), nullable=True),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('redeemed_by', sa.String(), nullable=True),
            sa.Column('redeemed_at', sa.BigInteger(), nullable=True),
            sa.Column('created_by', sa.String(), nullable=True),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
            sa.Column('updated_at', sa.BigInteger(), nullable=False),
        )
        op.create_index(
            'idx_gift_card_batch', 'subscription_gift_card', ['batch_id']
        )
        op.create_index(
            'idx_gift_card_redeemed_by', 'subscription_gift_card', ['redeemed_by']
        )


def downgrade() -> None:
    existing_tables = set(get_existing_tables())

    if 'subscription_gift_card' in existing_tables:
        op.drop_index('idx_gift_card_redeemed_by', table_name='subscription_gift_card')
        op.drop_index('idx_gift_card_batch', table_name='subscription_gift_card')
        op.drop_table('subscription_gift_card')
