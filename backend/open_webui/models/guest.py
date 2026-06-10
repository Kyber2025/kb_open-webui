"""Guest (anonymous) access — usage counters + IP blacklist.

These back the "let logged-out visitors chat a few times/day" feature.
Limiting is by IP **and** device (a client-generated id): if either the IP
or the device hits the daily cap, the guest is asked to log in. An admin
IP blacklist blocks abusive IPs outright.

Tables are created by an Alembic migration; see
migrations/versions/*_add_guest_tables.py.
"""

import logging
import time
from typing import Optional

from open_webui.internal.db import Base, get_async_db_context
from pydantic import BaseModel, ConfigDict
from sqlalchemy import BigInteger, Column, Integer, String, delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


####################
# DB Schemas
####################


class GuestUsageDaily(Base):
    __tablename__ = 'guest_usage_daily'

    # f"{scope}:{key}:{date}" — scope is 'ip' or 'device'
    id = Column(String, primary_key=True)
    scope = Column(String, nullable=False)  # 'ip' | 'device'
    key = Column(String, index=True, nullable=False)  # ip address or device id
    date = Column(String, nullable=False)  # 'YYYY-MM-DD' (UTC)
    count = Column(Integer, nullable=False, default=0)
    updated_at = Column(BigInteger, nullable=False)


class GuestIpBlacklist(Base):
    __tablename__ = 'guest_ip_blacklist'

    ip = Column(String, primary_key=True)  # exact IP address
    reason = Column(String, nullable=True)
    created_by = Column(String, nullable=True)  # admin user_id
    created_at = Column(BigInteger, nullable=False)


####################
# Pydantic models
####################


class GuestIpBlacklistModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ip: str
    reason: Optional[str] = None
    created_by: Optional[str] = None
    created_at: int


####################
# Table operations
####################


class GuestUsageTable:
    @staticmethod
    def _id(scope: str, key: str, date: str) -> str:
        return f'{scope}:{key}:{date}'

    async def get_count(
        self, scope: str, key: str, date: str, db: Optional[AsyncSession] = None
    ) -> int:
        async with get_async_db_context(db) as db:
            row = await db.get(GuestUsageDaily, self._id(scope, key, date))
            return row.count if row else 0

    async def increment(
        self, scope: str, key: str, date: str, db: Optional[AsyncSession] = None
    ) -> int:
        """Atomic server-side increment. The old read-modify-write could lose
        counts under concurrent messages (two readers see N, both write N+1);
        a single `UPDATE ... SET count = count + 1 RETURNING` can't, and is one
        round trip on the common path. INSERT races on the first message of the
        day collapse into a retry of the atomic UPDATE."""
        async with get_async_db_context(db) as db:
            _id = self._id(scope, key, date)
            now = int(time.time())

            async def _bump() -> Optional[int]:
                result = await db.execute(
                    update(GuestUsageDaily)
                    .where(GuestUsageDaily.id == _id)
                    .values(count=GuestUsageDaily.count + 1, updated_at=now)
                    .returning(GuestUsageDaily.count)
                )
                value = result.scalar_one_or_none()
                if value is not None:
                    await db.commit()
                return value

            new_count = await _bump()
            if new_count is not None:
                return new_count

            try:
                db.add(
                    GuestUsageDaily(
                        id=_id, scope=scope, key=key, date=date, count=1, updated_at=now
                    )
                )
                await db.commit()
                return 1
            except IntegrityError:
                # Lost the first-row race to a concurrent request — bump instead.
                await db.rollback()
                new_count = await _bump()
                return new_count if new_count is not None else 1


class GuestBlacklistTable:
    async def is_blacklisted(self, ip: str, db: Optional[AsyncSession] = None) -> bool:
        if not ip:
            return False
        async with get_async_db_context(db) as db:
            return (await db.get(GuestIpBlacklist, ip)) is not None

    async def list(self, db: Optional[AsyncSession] = None) -> list[GuestIpBlacklistModel]:
        async with get_async_db_context(db) as db:
            result = await db.execute(
                select(GuestIpBlacklist).order_by(GuestIpBlacklist.created_at.desc())
            )
            return [GuestIpBlacklistModel.model_validate(r) for r in result.scalars().all()]

    async def add(
        self,
        ip: str,
        reason: Optional[str] = None,
        created_by: Optional[str] = None,
        db: Optional[AsyncSession] = None,
    ) -> Optional[GuestIpBlacklistModel]:
        ip = (ip or '').strip()
        if not ip:
            return None
        async with get_async_db_context(db) as db:
            row = await db.get(GuestIpBlacklist, ip)
            if row is None:
                row = GuestIpBlacklist(
                    ip=ip, reason=reason, created_by=created_by, created_at=int(time.time())
                )
                db.add(row)
            else:
                row.reason = reason
            await db.commit()
            return GuestIpBlacklistModel(
                ip=ip, reason=reason, created_by=created_by, created_at=row.created_at
            )

    async def remove(self, ip: str, db: Optional[AsyncSession] = None) -> bool:
        async with get_async_db_context(db) as db:
            result = await db.execute(delete(GuestIpBlacklist).where(GuestIpBlacklist.ip == ip))
            await db.commit()
            return bool(result.rowcount)


GuestUsage = GuestUsageTable()
GuestBlacklist = GuestBlacklistTable()
