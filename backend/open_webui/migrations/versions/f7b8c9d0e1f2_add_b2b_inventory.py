"""Company-owned inventory and immutable transfers; no changes to ToC orders."""
from alembic import op
import sqlalchemy as sa
revision = 'f7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = depends_on = None


def upgrade():
    op.create_table('b2b_checkout', sa.Column('order_id', sa.String(), primary_key=True),
        sa.Column('external_id', sa.String(), nullable=False, unique=True),
        sa.Column('company_id', sa.String(), nullable=False), sa.Column('buyer_id', sa.String(), nullable=False))
    op.create_index('ix_b2b_checkout_company_id', 'b2b_checkout', ['company_id'])
    op.create_table('b2b_card', sa.Column('code', sa.String(), primary_key=True),
        sa.Column('order_id', sa.String(), nullable=False), sa.Column('company_id', sa.String(), nullable=False),
        sa.Column('owner_id', sa.String(), nullable=False), sa.Column('updated_at', sa.BigInteger(), nullable=False))
    for col in ('order_id', 'company_id', 'owner_id'):
        op.create_index('ix_b2b_card_'+col, 'b2b_card', [col])
    op.create_table('b2b_transfer', sa.Column('id', sa.String(), primary_key=True),
        sa.Column('company_id', sa.String(), nullable=False), sa.Column('from_id', sa.String(), nullable=False),
        sa.Column('to_id', sa.String(), nullable=False), sa.Column('actor_id', sa.String(), nullable=False),
        sa.Column('codes', sa.JSON(), nullable=False), sa.Column('note', sa.String(), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False))
    for col in ('company_id', 'created_at'):
        op.create_index('ix_b2b_transfer_'+col, 'b2b_transfer', [col])


def downgrade():
    for table in ('b2b_transfer', 'b2b_card', 'b2b_checkout'):
        op.drop_table(table)
