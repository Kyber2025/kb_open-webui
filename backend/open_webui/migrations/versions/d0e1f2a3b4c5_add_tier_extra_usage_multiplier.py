"""Add extra_usage_multiplier to subscription_tier

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-06-08 00:00:00.000000

Per-tier paid-overflow (extra-usage) multiplier. When a subscription-managed user
exceeds their token caps and has opted into extra usage, KyberRouter bills the
wallet at `model price * this`. 1.0 = standard model price. open-webui syncs it to
the user's KyberRouter account alongside the rate-limit caps.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd0e1f2a3b4c5'
down_revision: Union[str, None] = 'c9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(table: str) -> set:
    insp = sa.inspect(op.get_bind())
    return {c['name'] for c in insp.get_columns(table)}


def upgrade() -> None:
    cols = _existing_columns('subscription_tier')
    if 'extra_usage_multiplier' not in cols:
        op.add_column(
            'subscription_tier',
            sa.Column('extra_usage_multiplier', sa.Float(), nullable=False, server_default='1.0'),
        )


def downgrade() -> None:
    cols = _existing_columns('subscription_tier')
    if 'extra_usage_multiplier' in cols:
        op.drop_column('subscription_tier', 'extra_usage_multiplier')
