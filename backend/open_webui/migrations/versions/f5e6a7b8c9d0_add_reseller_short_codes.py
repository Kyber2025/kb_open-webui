"""Add stable opaque short invitation codes; retain all legacy links."""
import secrets
from alembic import op
import sqlalchemy as sa

revision = 'f5e6a7b8c9d0'
down_revision = 'f4d5e6a7b8c9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('reseller_invite', sa.Column('short_code', sa.String(12), nullable=True))
    op.create_index('ix_reseller_invite_short_code', 'reseller_invite', ['short_code'], unique=True)
    invites = sa.table('reseller_invite', sa.column('id', sa.String()), sa.column('short_code', sa.String()))
    connection = op.get_bind()
    used = set()
    for invite_id in connection.execute(sa.select(invites.c.id)).scalars().all():
        code = secrets.token_urlsafe(9)
        while code in used:
            code = secrets.token_urlsafe(9)
        used.add(code)
        connection.execute(invites.update().where(invites.c.id == invite_id).values(short_code=code))


def downgrade():
    op.drop_index('ix_reseller_invite_short_code', table_name='reseller_invite')
    op.drop_column('reseller_invite', 'short_code')
