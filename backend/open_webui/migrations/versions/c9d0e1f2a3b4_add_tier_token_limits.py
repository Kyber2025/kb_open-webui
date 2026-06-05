"""Add token_limit_5h / token_limit_week to subscription_tier

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-06-05 00:00:00.000000

Per-tier 5h / weekly token limits (SESSION-HANDOFF §12.7, P4). open-webui syncs
these to each user's KyberRouter rate-limit override so KyberRouter enforces them.
Both nullable (NULL = inherit KyberRouter's global default for that window).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(table: str) -> set:
    insp = sa.inspect(op.get_bind())
    return {c['name'] for c in insp.get_columns(table)}


def upgrade() -> None:
    cols = _existing_columns('subscription_tier')
    if 'token_limit_5h' not in cols:
        op.add_column('subscription_tier', sa.Column('token_limit_5h', sa.Integer(), nullable=True))
    if 'token_limit_week' not in cols:
        op.add_column('subscription_tier', sa.Column('token_limit_week', sa.Integer(), nullable=True))


def downgrade() -> None:
    cols = _existing_columns('subscription_tier')
    if 'token_limit_week' in cols:
        op.drop_column('subscription_tier', 'token_limit_week')
    if 'token_limit_5h' in cols:
        op.drop_column('subscription_tier', 'token_limit_5h')
