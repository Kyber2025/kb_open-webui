"""Add extra_usage_enabled to user_kyber_account

Revision ID: d1e2f3a4b5c6
Revises: d0e1f2a3b4c5
Create Date: 2026-06-08 00:00:01.000000

Per-user opt-in for paid extra-usage (token overflow). When True, open-webui syncs
it to the user's KyberRouter account so exceeding a token cap overflows into the
wallet instead of a hard 429. Default False = hard stop at the cap.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, None] = 'd0e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(table: str) -> set:
    insp = sa.inspect(op.get_bind())
    return {c['name'] for c in insp.get_columns(table)}


def upgrade() -> None:
    cols = _existing_columns('user_kyber_account')
    if 'extra_usage_enabled' not in cols:
        op.add_column(
            'user_kyber_account',
            sa.Column('extra_usage_enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    cols = _existing_columns('user_kyber_account')
    if 'extra_usage_enabled' in cols:
        op.drop_column('user_kyber_account', 'extra_usage_enabled')
