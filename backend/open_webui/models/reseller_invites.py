"""Server-owned reseller attribution. Profile/settings updates cannot change it."""
import secrets
import time
import uuid

from fastapi import HTTPException
from sqlalchemy import BigInteger, Boolean, Column, String, func, or_, select

from open_webui.internal.db import Base, get_async_db_context


class ResellerInvite(Base):
    __tablename__ = 'reseller_invite'
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    token = Column(String, nullable=False, unique=True)
    short_code = Column(String(12), nullable=True, unique=True)
    enabled = Column(Boolean, nullable=False)
    created_at = Column(BigInteger, nullable=False)


class ResellerCustomer(Base):
    __tablename__ = 'reseller_customer'
    user_id = Column(String, primary_key=True)
    invite_id = Column(String, nullable=False, index=True)
    created_at = Column(BigInteger, nullable=False)


class ResellerRegistration(Base):
    __tablename__ = 'reseller_registration'
    email = Column(String, primary_key=True)
    invite_id = Column(String, nullable=False)
    created_at = Column(BigInteger, nullable=False)


class ResellerInvitesTable:
    async def create(self, name, db=None):
        async with get_async_db_context(db) as session:
            row = ResellerInvite(id=str(uuid.uuid4()), name=name.strip(),
                token=secrets.token_urlsafe(32), short_code=secrets.token_urlsafe(9),
                enabled=True, created_at=int(time.time()))
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return self.view(row, 0)

    @staticmethod
    def view(row, customers):
        return {key: getattr(row, key) for key in ('id', 'name', 'token', 'short_code', 'enabled', 'created_at')} | {'customers': customers}

    async def list(self, db=None):
        async with get_async_db_context(db) as session:
            rows = (await session.execute(select(ResellerInvite, func.count(ResellerCustomer.user_id))
                .outerjoin(ResellerCustomer, ResellerCustomer.invite_id == ResellerInvite.id)
                .group_by(ResellerInvite.id).order_by(ResellerInvite.created_at.desc()))).all()
            # A previous application node can still create a legacy row during rollout.
            missing = [row for row, _ in rows if not row.short_code]
            for row in missing:
                row.short_code = secrets.token_urlsafe(9)
            if missing:
                await session.commit()
            return [self.view(row, count) for row, count in rows]

    async def set_enabled(self, invite_id, enabled, db=None):
        async with get_async_db_context(db) as session:
            row = await session.get(ResellerInvite, invite_id)
            if row is None:
                raise HTTPException(404, 'Invitation not found')
            row.enabled = enabled
            await session.commit()
        # Existing customers remain attributed even when new signups are disabled.
        return {'success': True}

    async def for_users(self, user_ids, db=None):
        """Admin-only attribution summary in one query, without invitation secrets."""
        if not user_ids:
            return {}
        async with get_async_db_context(db) as session:
            rows = (await session.execute(select(ResellerCustomer, ResellerInvite)
                .outerjoin(ResellerInvite, ResellerInvite.id == ResellerCustomer.invite_id)
                .where(ResellerCustomer.user_id.in_(user_ids)))).all()
            return {member.user_id: {'invite_id': member.invite_id,
                'name': invite.name if invite else '已删除代理',
                'enabled': invite.enabled if invite else False,
                'created_at': member.created_at} for member, invite in rows}

    async def validate(self, token, db=None):
        async with get_async_db_context(db) as session:
            row = (await session.execute(select(ResellerInvite).where(
                or_(ResellerInvite.token == token, ResellerInvite.short_code == token),
                ResellerInvite.enabled.is_(True)))).scalar_one_or_none()
            if row is None:
                raise HTTPException(400, '邀请链接无效或已停用，请联系服务商。')
            return row.id

    async def registration_invite(self, email, token=None, db=None):
        """The email reservation wins even if the verification request drops its token."""
        async with get_async_db_context(db) as session:
            explicit = await self.validate(token, db=session) if token is not None else None
            saved = await session.get(ResellerRegistration, email.strip().lower())
            if saved:
                if explicit is not None and explicit != saved.invite_id:
                    raise HTTPException(409, '此邮箱已有其他服务商邀请，请使用原邀请链接。')
                row = await session.get(ResellerInvite, saved.invite_id)
                if row is None or not row.enabled:
                    raise HTTPException(400, '邀请链接已停用，请联系服务商。')
                return saved.invite_id
            return explicit

    async def reserve(self, email, token, db=None):
        email = email.strip().lower()
        async with get_async_db_context(db) as session:
            invite_id = await self.registration_invite(email, token, db=session)
            if invite_id and await session.get(ResellerRegistration, email) is None:
                # ON CONFLICT prevents concurrent requests from replacing attribution.
                dialect = session.bind.dialect.name
                if dialect == 'postgresql':
                    from sqlalchemy.dialects.postgresql import insert
                else:
                    from sqlalchemy.dialects.sqlite import insert
                await session.execute(insert(ResellerRegistration).values(email=email,
                    invite_id=invite_id, created_at=int(time.time())).on_conflict_do_nothing(index_elements=['email']))
                await session.commit()
                saved = await session.get(ResellerRegistration, email, populate_existing=True)
                if saved.invite_id != invite_id:
                    raise HTTPException(409, '此邮箱已有其他服务商邀请，请使用原邀请链接。')
            return invite_id

    async def is_customer(self, user_id, db=None):
        async with get_async_db_context(db) as session:
            return await session.get(ResellerCustomer, user_id) is not None


ResellerInvites = ResellerInvitesTable()
