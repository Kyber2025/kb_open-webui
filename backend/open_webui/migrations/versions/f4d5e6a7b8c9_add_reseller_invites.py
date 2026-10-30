"""Add reseller invitations, durable customer attribution and email reservations."""
from alembic import op
import sqlalchemy as sa

revision = 'f4d5e6a7b8c9'
down_revision = 'f3c4d5e6a7b8'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('reseller_invite',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('token', sa.String(), nullable=False, unique=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False))
    op.create_table('reseller_customer',
        sa.Column('user_id', sa.String(), primary_key=True),
        sa.Column('invite_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False))
    op.create_index('ix_reseller_customer_invite_id', 'reseller_customer', ['invite_id'])
    op.create_table('reseller_registration',
        sa.Column('email', sa.String(), primary_key=True),
        sa.Column('invite_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False))


def downgrade():
    op.drop_table('reseller_registration')
    op.drop_table('reseller_customer')
    op.drop_table('reseller_invite')
