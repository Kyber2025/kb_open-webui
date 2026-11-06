"""Reseller permissions, prices, inventory holds and durable commerce history."""
from alembic import op
import sqlalchemy as sa

revision = 'f6a7b8c9d0e1'
down_revision = 'f5e6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('reseller_account',
        sa.Column('user_id', sa.String(), primary_key=True),
        sa.Column('invite_id', sa.String(), nullable=False, unique=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.String(), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False))
    op.create_table('reseller_price',
        sa.Column('scope', sa.String(), primary_key=True),
        sa.Column('tier_id', sa.String(), primary_key=True),
        sa.Column('price_usd', sa.Numeric(18, 6), nullable=False),
        sa.Column('updated_by', sa.String(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False))
    op.create_table('commerce_transaction',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('logical_order_id', sa.String()),
        sa.Column('user_id', sa.String()), sa.Column('actor_id', sa.String()),
        sa.Column('tier_id', sa.String()), sa.Column('tier_name', sa.String()),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('duration_days', sa.Integer()),
        sa.Column('unit_price', sa.Numeric(18, 6)), sa.Column('amount', sa.Numeric(18, 6)),
        sa.Column('chain_id', sa.String()), sa.Column('status', sa.String(), nullable=False),
        sa.Column('fulfilled', sa.Boolean(), nullable=False),
        sa.Column('stock_backed', sa.Boolean(), nullable=False),
        sa.Column('batch_id', sa.String(), unique=True),
        sa.Column('address', sa.String()), sa.Column('tx_hash', sa.String()),
        sa.Column('paid_at', sa.BigInteger()),
        sa.Column('payment', sa.Text()), sa.Column('collections', sa.Text()),
        sa.Column('note', sa.String()), sa.Column('expires_at', sa.BigInteger()),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False),
        sa.Column('synced_at', sa.BigInteger()))
    op.create_index('ix_commerce_transaction_user_id', 'commerce_transaction', ['user_id'])
    op.create_index('ix_commerce_transaction_paid_at', 'commerce_transaction', ['paid_at'])
    op.create_index('ix_commerce_source_created', 'commerce_transaction', ['source', 'created_at'])
    op.create_table('commerce_hold',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('tier_id', sa.String(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('expires_at', sa.BigInteger(), nullable=False))
    op.create_index('ix_commerce_hold_tier_id', 'commerce_hold', ['tier_id'])
    op.create_table('commerce_sync',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('cursor', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False))
    op.create_table('commerce_notice',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('sent', sa.Boolean(), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('next_attempt_at', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('sent_at', sa.BigInteger()))
    # Preserve historical issuance even if the original codes are later deleted.
    op.get_bind().execute(sa.text('''INSERT INTO commerce_transaction
        (id, source, actor_id, tier_id, quantity, duration_days, status, fulfilled, stock_backed, batch_id, created_at, updated_at)
        SELECT 'manual:' || COALESCE(batch_id, code), 'manual', MIN(created_by), MIN(tier_id), COUNT(*),
            MIN(duration_days), 'ISSUED', true, false, COALESCE(batch_id, code), MIN(created_at), MAX(updated_at)
        FROM subscription_gift_card GROUP BY COALESCE(batch_id, code)'''))


def downgrade():
    for table in ('commerce_notice', 'commerce_sync', 'commerce_hold', 'commerce_transaction', 'reseller_price', 'reseller_account'):
        op.drop_table(table)
