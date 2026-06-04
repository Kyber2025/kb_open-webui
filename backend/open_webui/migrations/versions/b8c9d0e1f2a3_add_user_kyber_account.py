"""Add user_kyber_account table

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-04 06:00:00.000000

Links an open-webui (shadow) user to their KyberRouter account + encrypted API key,
for the KyberRouter account/billing unification (SESSION-HANDOFF §12.7, P1 auth bridge).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from open_webui.migrations.util import get_existing_tables

revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing_tables = set(get_existing_tables())

    if 'user_kyber_account' not in existing_tables:
        op.create_table(
            'user_kyber_account',
            sa.Column('user_id', sa.String(), nullable=False, primary_key=True),
            sa.Column('kyber_user_id', sa.String(), nullable=False),
            sa.Column('kyber_email', sa.String(), nullable=False),
            sa.Column('api_key_enc', sa.Text(), nullable=True),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
            sa.Column('updated_at', sa.BigInteger(), nullable=False),
        )
        op.create_index(
            'idx_user_kyber_account_kyber_user', 'user_kyber_account', ['kyber_user_id']
        )


def downgrade() -> None:
    existing_tables = set(get_existing_tables())

    if 'user_kyber_account' in existing_tables:
        op.drop_index('idx_user_kyber_account_kyber_user', table_name='user_kyber_account')
        op.drop_table('user_kyber_account')
