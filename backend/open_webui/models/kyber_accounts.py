"""Links an open-webui (shadow) user to their KyberRouter account + API key.

KyberRouter is the account/wallet/billing source of truth (see SESSION-HANDOFF §12.7).
When the auth bridge is enabled, each open-webui user that authenticates via KyberRouter
gets a row here mapping to their KyberRouter user id, plus their personal `sk-or-` API key
(stored Fernet-encrypted) which P2 will use to bill chat usage per-user against their
KyberRouter balance."""

import logging
import time
from typing import Optional

from open_webui.internal.db import Base, get_async_db_context
from pydantic import BaseModel, ConfigDict
from sqlalchemy import BigInteger, Column, String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


####################
# DB Schema
####################


class UserKyberAccount(Base):
    __tablename__ = 'user_kyber_account'

    user_id = Column(String, primary_key=True)  # open-webui (shadow) user id
    kyber_user_id = Column(String, index=True, nullable=False)  # KyberRouter User.id (cuid)
    kyber_email = Column(String, nullable=False)
    api_key_enc = Column(Text, nullable=True)  # Fernet-encrypted sk-or- key (utils.oauth.encrypt_data)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)


####################
# Pydantic
####################


class UserKyberAccountModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    kyber_user_id: str
    kyber_email: str
    api_key_enc: Optional[str] = None
    created_at: int
    updated_at: int


####################
# CRUD
####################


class UserKyberAccountsTable:
    async def get_by_user_id(
        self, user_id: str, db: Optional[AsyncSession] = None
    ) -> Optional[UserKyberAccountModel]:
        async with get_async_db_context(db) as db:
            row = await db.get(UserKyberAccount, user_id)
            return UserKyberAccountModel.model_validate(row) if row else None

    async def get_by_kyber_user_id(
        self, kyber_user_id: str, db: Optional[AsyncSession] = None
    ) -> Optional[UserKyberAccountModel]:
        async with get_async_db_context(db) as db:
            result = await db.execute(
                select(UserKyberAccount).filter_by(kyber_user_id=kyber_user_id).limit(1)
            )
            row = result.scalars().first()
            return UserKyberAccountModel.model_validate(row) if row else None

    async def upsert(
        self,
        user_id: str,
        kyber_user_id: str,
        kyber_email: str,
        api_key_enc: Optional[str] = None,
        db: Optional[AsyncSession] = None,
    ) -> Optional[UserKyberAccountModel]:
        """Create or update the link. `api_key_enc` is only overwritten when provided
        (None leaves an existing stored key untouched)."""
        async with get_async_db_context(db) as db:
            now = int(time.time())
            row = await db.get(UserKyberAccount, user_id)
            if row is None:
                row = UserKyberAccount(
                    user_id=user_id,
                    kyber_user_id=kyber_user_id,
                    kyber_email=kyber_email,
                    api_key_enc=api_key_enc,
                    created_at=now,
                    updated_at=now,
                )
                db.add(row)
            else:
                row.kyber_user_id = kyber_user_id
                row.kyber_email = kyber_email
                if api_key_enc is not None:
                    row.api_key_enc = api_key_enc
                row.updated_at = now
            await db.commit()
            await db.refresh(row)
            return UserKyberAccountModel.model_validate(row)

    async def set_api_key(
        self, user_id: str, api_key_enc: str, db: Optional[AsyncSession] = None
    ) -> bool:
        async with get_async_db_context(db) as db:
            row = await db.get(UserKyberAccount, user_id)
            if row is None:
                return False
            row.api_key_enc = api_key_enc
            row.updated_at = int(time.time())
            await db.commit()
            return True


UserKyberAccounts = UserKyberAccountsTable()
