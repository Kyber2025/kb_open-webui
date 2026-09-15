"""Add idempotent subscription grants and allocation outbox."""
from alembic import op
import sqlalchemy as sa

revision = 'f3c4d5e6a7b8'
down_revision = 'e2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('subscription_change',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('version', sa.BigInteger(), nullable=False),
        sa.Column('tier_id', sa.String(), nullable=False),
        sa.Column('expires_at', sa.BigInteger(), nullable=True),
        sa.Column('kyber_user_id', sa.String(), nullable=True),
        sa.Column('subscription_id', sa.String(), nullable=True),
        sa.Column('synced', sa.Boolean(), nullable=False),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.BigInteger(), nullable=False))
    op.create_index('ix_subscription_change_user_id', 'subscription_change', ['user_id'])


def downgrade():
    op.drop_table('subscription_change')
