import logging
import time
import uuid
from typing import Optional

from open_webui.internal.db import Base, JSONField, get_async_db_context
from pydantic import BaseModel, ConfigDict
from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Float,
    Integer,
    String,
    Text,
    delete,
    func,
    select,
    update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


####################
# DB Schemas
####################


class SubscriptionTier(Base):
    __tablename__ = 'subscription_tier'

    id = Column(String, primary_key=True)  # slug: 'free' | 'pro' | 'max' | 'ultra'
    name = Column(String, nullable=False)  # display name
    description = Column(Text, nullable=True)
    price_usd = Column(Float, nullable=False, default=0.0)  # monthly price, in USDT
    duration_days = Column(Integer, nullable=False, default=30)
    daily_message_limit = Column(Integer, nullable=True)  # NULL = unlimited (legacy per-count gate)
    # P4 per-tier token windows (used when KyberRouter token billing is on): synced
    # to the user's KyberRouter override so it enforces them. NULL/0 = unlimited.
    token_limit_5h = Column(Integer, nullable=True)  # tokens per rolling 5h
    token_limit_week = Column(Integer, nullable=True)  # tokens per rolling 7d
    # Extra-usage (paid overflow) multiplier: when a subscription-managed user
    # exceeds their token caps and has opted into extra usage, KyberRouter bills
    # the wallet at `model price * this`. 1.0 = standard model price. Synced to the
    # user's KyberRouter account alongside the rate-limit caps.
    extra_usage_multiplier = Column(Float, nullable=False, default=1.0)
    allowed_model_ids = Column(JSONField, nullable=True)  # [] / NULL = all models allowed
    enabled = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)


class UserSubscription(Base):
    __tablename__ = 'user_subscription'

    id = Column(String, primary_key=True)
    user_id = Column(String, index=True, nullable=False)
    tier_id = Column(String, nullable=False)
    status = Column(String, nullable=False, default='active')  # active | expired | cancelled
    started_at = Column(BigInteger, nullable=False)
    expires_at = Column(BigInteger, nullable=False, index=True)
    order_id = Column(String, nullable=True)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)


class SubscriptionOrder(Base):
    __tablename__ = 'subscription_order'

    # id = the composite order id returned by the payment service ("<sent id>_<chainId>")
    id = Column(String, primary_key=True)
    logical_order_id = Column(String, index=True, nullable=False)  # the id we generated and sent
    user_id = Column(String, index=True, nullable=False)
    tier_id = Column(String, nullable=False)
    chain_id = Column(String, nullable=False)
    amount = Column(String, nullable=False)  # stored as string to avoid float drift
    address = Column(String, nullable=True)
    status = Column(String, nullable=False, default='PENDING')  # PENDING|PAID|EXPIRED|FAILED
    tx_hash = Column(String, nullable=True)
    activated = Column(Boolean, nullable=False, default=False)  # subscription granted for this paid order
    expires_at = Column(BigInteger, nullable=True)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)


class SubscriptionUsageDaily(Base):
    __tablename__ = 'subscription_usage_daily'

    id = Column(String, primary_key=True)  # f"{user_id}:{date}"
    user_id = Column(String, index=True, nullable=False)
    date = Column(String, nullable=False)  # 'YYYY-MM-DD' (UTC)
    count = Column(Integer, nullable=False, default=0)
    updated_at = Column(BigInteger, nullable=False)


class GiftCard(Base):
    __tablename__ = 'subscription_gift_card'

    # canonical code, e.g. 'ABCD-EFGH-JKLM-NPQR' (single-use redemption code)
    code = Column(String, primary_key=True)
    tier_id = Column(String, nullable=False)  # tier granted on redemption
    duration_days = Column(Integer, nullable=False)  # subscription length granted
    batch_id = Column(String, index=True, nullable=True)  # groups a generated batch
    note = Column(String, nullable=True)  # admin note
    enabled = Column(Boolean, nullable=False, default=True)  # False = deactivated
    redeemed_by = Column(String, index=True, nullable=True)  # user_id, NULL = unredeemed
    redeemed_at = Column(BigInteger, nullable=True)
    created_by = Column(String, nullable=True)  # admin user_id who generated it
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)


####################
# Pydantic models
####################


class SubscriptionTierModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: Optional[str] = None
    price_usd: float = 0.0
    duration_days: int = 30
    daily_message_limit: Optional[int] = None
    token_limit_5h: Optional[int] = None
    token_limit_week: Optional[int] = None
    extra_usage_multiplier: float = 1.0
    allowed_model_ids: Optional[list[str]] = None
    enabled: bool = True
    sort_order: int = 0
    created_at: int
    updated_at: int


class SubscriptionTierForm(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    price_usd: float = 0.0
    duration_days: int = 30
    daily_message_limit: Optional[int] = None
    token_limit_5h: Optional[int] = None
    token_limit_week: Optional[int] = None
    extra_usage_multiplier: float = 1.0
    allowed_model_ids: Optional[list[str]] = None
    enabled: bool = True
    sort_order: int = 0


class UserSubscriptionModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    tier_id: str
    status: str
    started_at: int
    expires_at: int
    order_id: Optional[str] = None
    created_at: int
    updated_at: int


class SubscriptionOrderModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    logical_order_id: str
    user_id: str
    tier_id: str
    chain_id: str
    amount: str
    address: Optional[str] = None
    status: str
    tx_hash: Optional[str] = None
    activated: bool
    expires_at: Optional[int] = None
    created_at: int
    updated_at: int


class GiftCardModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    tier_id: str
    duration_days: int
    batch_id: Optional[str] = None
    note: Optional[str] = None
    enabled: bool = True
    redeemed_by: Optional[str] = None
    redeemed_at: Optional[int] = None
    created_by: Optional[str] = None
    created_at: int
    updated_at: int


####################
# Table operations
####################


class SubscriptionTiersTable:
    async def list_tiers(
        self, enabled_only: bool = False, db: Optional[AsyncSession] = None
    ) -> list[SubscriptionTierModel]:
        async with get_async_db_context(db) as db:
            stmt = select(SubscriptionTier)
            if enabled_only:
                stmt = stmt.filter_by(enabled=True)
            stmt = stmt.order_by(SubscriptionTier.sort_order, SubscriptionTier.price_usd)
            result = await db.execute(stmt)
            return [SubscriptionTierModel.model_validate(t) for t in result.scalars().all()]

    async def get_tier(self, tier_id: str, db: Optional[AsyncSession] = None) -> Optional[SubscriptionTierModel]:
        async with get_async_db_context(db) as db:
            tier = await db.get(SubscriptionTier, tier_id)
            return SubscriptionTierModel.model_validate(tier) if tier else None

    async def count(self, db: Optional[AsyncSession] = None) -> int:
        async with get_async_db_context(db) as db:
            result = await db.execute(select(SubscriptionTier.id))
            return len(result.scalars().all())

    async def upsert_tier(
        self, form: SubscriptionTierForm, db: Optional[AsyncSession] = None
    ) -> Optional[SubscriptionTierModel]:
        async with get_async_db_context(db) as db:
            now = int(time.time())
            tier = await db.get(SubscriptionTier, form.id)
            if tier is None:
                tier = SubscriptionTier(
                    id=form.id,
                    name=form.name,
                    description=form.description,
                    price_usd=form.price_usd,
                    duration_days=form.duration_days,
                    daily_message_limit=form.daily_message_limit,
                    token_limit_5h=form.token_limit_5h,
                    token_limit_week=form.token_limit_week,
                    extra_usage_multiplier=form.extra_usage_multiplier,
                    allowed_model_ids=form.allowed_model_ids,
                    enabled=form.enabled,
                    sort_order=form.sort_order,
                    created_at=now,
                    updated_at=now,
                )
                db.add(tier)
            else:
                tier.name = form.name
                tier.description = form.description
                tier.price_usd = form.price_usd
                tier.duration_days = form.duration_days
                tier.daily_message_limit = form.daily_message_limit
                tier.token_limit_5h = form.token_limit_5h
                tier.token_limit_week = form.token_limit_week
                tier.extra_usage_multiplier = form.extra_usage_multiplier
                tier.allowed_model_ids = form.allowed_model_ids
                tier.enabled = form.enabled
                tier.sort_order = form.sort_order
                tier.updated_at = now
            await db.commit()
            await db.refresh(tier)
            return SubscriptionTierModel.model_validate(tier)

    async def delete_tier(self, tier_id: str, db: Optional[AsyncSession] = None) -> bool:
        async with get_async_db_context(db) as db:
            result = await db.execute(delete(SubscriptionTier).filter_by(id=tier_id))
            await db.commit()
            return result.rowcount > 0


class UserSubscriptionsTable:
    async def get_active_for_user(
        self, user_id: str, db: Optional[AsyncSession] = None
    ) -> Optional[UserSubscriptionModel]:
        async with get_async_db_context(db) as db:
            now = int(time.time())
            result = await db.execute(
                select(UserSubscription)
                .filter(
                    UserSubscription.user_id == user_id,
                    UserSubscription.status == 'active',
                    UserSubscription.expires_at > now,
                )
                .order_by(UserSubscription.expires_at.desc())
                .limit(1)
            )
            sub = result.scalars().first()
            return UserSubscriptionModel.model_validate(sub) if sub else None

    async def list_for_user(
        self, user_id: str, db: Optional[AsyncSession] = None
    ) -> list[UserSubscriptionModel]:
        async with get_async_db_context(db) as db:
            result = await db.execute(
                select(UserSubscription)
                .filter_by(user_id=user_id)
                .order_by(UserSubscription.created_at.desc())
            )
            return [UserSubscriptionModel.model_validate(s) for s in result.scalars().all()]

    async def list_all(self, db: Optional[AsyncSession] = None) -> list[UserSubscriptionModel]:
        async with get_async_db_context(db) as db:
            result = await db.execute(
                select(UserSubscription).order_by(UserSubscription.created_at.desc())
            )
            return [UserSubscriptionModel.model_validate(s) for s in result.scalars().all()]

    async def create_or_extend(
        self,
        user_id: str,
        tier_id: str,
        duration_days: int,
        order_id: Optional[str] = None,
        db: Optional[AsyncSession] = None,
    ) -> Optional[UserSubscriptionModel]:
        """Grant `tier_id` to the user. If they already hold an active subscription on the
        same tier, extend its expiry; otherwise mark existing active subs of other tiers
        expired and create a fresh subscription."""
        async with get_async_db_context(db) as db:
            now = int(time.time())
            duration_secs = duration_days * 86400

            result = await db.execute(
                select(UserSubscription)
                .filter(
                    UserSubscription.user_id == user_id,
                    UserSubscription.status == 'active',
                    UserSubscription.expires_at > now,
                )
                .order_by(UserSubscription.expires_at.desc())
            )
            active = result.scalars().all()

            same_tier = next((s for s in active if s.tier_id == tier_id), None)
            if same_tier is not None:
                # extend from current expiry
                base = max(same_tier.expires_at, now)
                same_tier.expires_at = base + duration_secs
                same_tier.updated_at = now
                if order_id:
                    same_tier.order_id = order_id
                target = same_tier
            else:
                # supersede any other active tier
                for s in active:
                    s.status = 'expired'
                    s.updated_at = now
                target = UserSubscription(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    tier_id=tier_id,
                    status='active',
                    started_at=now,
                    expires_at=now + duration_secs,
                    order_id=order_id,
                    created_at=now,
                    updated_at=now,
                )
                db.add(target)

            await db.commit()
            await db.refresh(target)
            return UserSubscriptionModel.model_validate(target)


class SubscriptionOrdersTable:
    async def insert(
        self,
        order_id: str,
        logical_order_id: str,
        user_id: str,
        tier_id: str,
        chain_id: str,
        amount: str,
        address: Optional[str],
        status: str,
        expires_at: Optional[int],
        db: Optional[AsyncSession] = None,
    ) -> Optional[SubscriptionOrderModel]:
        async with get_async_db_context(db) as db:
            now = int(time.time())
            order = SubscriptionOrder(
                id=order_id,
                logical_order_id=logical_order_id,
                user_id=user_id,
                tier_id=tier_id,
                chain_id=chain_id,
                amount=amount,
                address=address,
                status=status,
                activated=False,
                expires_at=expires_at,
                created_at=now,
                updated_at=now,
            )
            db.add(order)
            await db.commit()
            await db.refresh(order)
            return SubscriptionOrderModel.model_validate(order)

    async def get(self, order_id: str, db: Optional[AsyncSession] = None) -> Optional[SubscriptionOrderModel]:
        async with get_async_db_context(db) as db:
            order = await db.get(SubscriptionOrder, order_id)
            return SubscriptionOrderModel.model_validate(order) if order else None

    async def list_for_user(
        self, user_id: str, db: Optional[AsyncSession] = None
    ) -> list[SubscriptionOrderModel]:
        async with get_async_db_context(db) as db:
            result = await db.execute(
                select(SubscriptionOrder)
                .filter_by(user_id=user_id)
                .order_by(SubscriptionOrder.created_at.desc())
            )
            return [SubscriptionOrderModel.model_validate(o) for o in result.scalars().all()]

    async def update_status(
        self,
        order_id: str,
        status: str,
        tx_hash: Optional[str] = None,
        activated: Optional[bool] = None,
        db: Optional[AsyncSession] = None,
    ) -> Optional[SubscriptionOrderModel]:
        async with get_async_db_context(db) as db:
            order = await db.get(SubscriptionOrder, order_id)
            if order is None:
                return None
            order.status = status
            if tx_hash is not None:
                order.tx_hash = tx_hash
            if activated is not None:
                order.activated = activated
            order.updated_at = int(time.time())
            await db.commit()
            await db.refresh(order)
            return SubscriptionOrderModel.model_validate(order)


class SubscriptionUsageTable:
    @staticmethod
    def _id(user_id: str, date: str) -> str:
        return f'{user_id}:{date}'

    async def get_count(self, user_id: str, date: str, db: Optional[AsyncSession] = None) -> int:
        async with get_async_db_context(db) as db:
            row = await db.get(SubscriptionUsageDaily, self._id(user_id, date))
            return row.count if row else 0

    async def increment(self, user_id: str, date: str, db: Optional[AsyncSession] = None) -> int:
        """Atomic server-side increment (same rationale as GuestUsageTable.increment:
        the old read-modify-write lost counts under concurrent messages)."""
        async with get_async_db_context(db) as db:
            _id = self._id(user_id, date)
            now = int(time.time())

            async def _bump() -> Optional[int]:
                result = await db.execute(
                    update(SubscriptionUsageDaily)
                    .where(SubscriptionUsageDaily.id == _id)
                    .values(count=SubscriptionUsageDaily.count + 1, updated_at=now)
                    .returning(SubscriptionUsageDaily.count)
                )
                value = result.scalar_one_or_none()
                if value is not None:
                    await db.commit()
                return value

            new_count = await _bump()
            if new_count is not None:
                return new_count

            try:
                db.add(SubscriptionUsageDaily(id=_id, user_id=user_id, date=date, count=1, updated_at=now))
                await db.commit()
                return 1
            except IntegrityError:
                # Lost the first-row race to a concurrent request — bump instead.
                await db.rollback()
                new_count = await _bump()
                return new_count if new_count is not None else 1


class GiftCardsTable:
    async def insert_many(
        self, cards: list[dict], db: Optional[AsyncSession] = None
    ) -> list[GiftCardModel]:
        """Bulk-insert pre-generated gift cards in a single transaction. Each dict needs
        `code`, `tier_id`, `duration_days`; optional `batch_id`, `note`, `created_by`."""
        async with get_async_db_context(db) as db:
            now = int(time.time())
            for c in cards:
                db.add(
                    GiftCard(
                        code=c['code'],
                        tier_id=c['tier_id'],
                        duration_days=c['duration_days'],
                        batch_id=c.get('batch_id'),
                        note=c.get('note'),
                        enabled=True,
                        redeemed_by=None,
                        redeemed_at=None,
                        created_by=c.get('created_by'),
                        created_at=now,
                        updated_at=now,
                    )
                )
            await db.commit()
            # Build models from the same data to avoid touching expired ORM instances.
            return [
                GiftCardModel(
                    code=c['code'],
                    tier_id=c['tier_id'],
                    duration_days=c['duration_days'],
                    batch_id=c.get('batch_id'),
                    note=c.get('note'),
                    enabled=True,
                    redeemed_by=None,
                    redeemed_at=None,
                    created_by=c.get('created_by'),
                    created_at=now,
                    updated_at=now,
                )
                for c in cards
            ]

    async def existing(self, codes: list[str], db: Optional[AsyncSession] = None) -> set[str]:
        """Return the subset of `codes` already present (collision guard during generation)."""
        if not codes:
            return set()
        async with get_async_db_context(db) as db:
            result = await db.execute(select(GiftCard.code).where(GiftCard.code.in_(codes)))
            return set(result.scalars().all())

    async def get(self, code: str, db: Optional[AsyncSession] = None) -> Optional[GiftCardModel]:
        async with get_async_db_context(db) as db:
            row = await db.get(GiftCard, code)
            return GiftCardModel.model_validate(row) if row else None

    async def claim(
        self, code: str, user_id: str, db: Optional[AsyncSession] = None
    ) -> Optional[GiftCardModel]:
        """Atomically claim an unredeemed, enabled gift card for `user_id`. The conditional
        UPDATE is the concurrency gate — only one redeemer can flip `redeemed_by` from NULL.
        Returns the claimed card, or None if it was not claimable (missing/redeemed/disabled)."""
        async with get_async_db_context(db) as db:
            now = int(time.time())
            result = await db.execute(
                update(GiftCard)
                .where(
                    GiftCard.code == code,
                    GiftCard.redeemed_by.is_(None),
                    GiftCard.enabled.is_(True),
                )
                .values(redeemed_by=user_id, redeemed_at=now, updated_at=now)
            )
            await db.commit()
            if not result.rowcount:
                return None
            row = await db.get(GiftCard, code)
            return GiftCardModel.model_validate(row) if row else None

    async def release(self, code: str, db: Optional[AsyncSession] = None) -> None:
        """Undo a claim (used when granting the subscription fails after claiming)."""
        async with get_async_db_context(db) as db:
            await db.execute(
                update(GiftCard)
                .where(GiftCard.code == code)
                .values(redeemed_by=None, redeemed_at=None, updated_at=int(time.time()))
            )
            await db.commit()

    async def set_enabled(
        self, code: str, enabled: bool, db: Optional[AsyncSession] = None
    ) -> bool:
        async with get_async_db_context(db) as db:
            result = await db.execute(
                update(GiftCard)
                .where(GiftCard.code == code)
                .values(enabled=enabled, updated_at=int(time.time()))
            )
            await db.commit()
            return bool(result.rowcount)

    async def delete(self, code: str, db: Optional[AsyncSession] = None) -> bool:
        async with get_async_db_context(db) as db:
            result = await db.execute(delete(GiftCard).where(GiftCard.code == code))
            await db.commit()
            return bool(result.rowcount)

    async def list_cards(
        self,
        status: Optional[str] = None,
        batch_id: Optional[str] = None,
        limit: int = 500,
        db: Optional[AsyncSession] = None,
    ) -> list[GiftCardModel]:
        async with get_async_db_context(db) as db:
            stmt = select(GiftCard)
            if batch_id:
                stmt = stmt.filter_by(batch_id=batch_id)
            if status == 'redeemed':
                stmt = stmt.filter(GiftCard.redeemed_by.isnot(None))
            elif status == 'available':
                stmt = stmt.filter(GiftCard.redeemed_by.is_(None), GiftCard.enabled.is_(True))
            elif status == 'disabled':
                stmt = stmt.filter(GiftCard.enabled.is_(False))
            stmt = stmt.order_by(GiftCard.created_at.desc()).limit(limit)
            result = await db.execute(stmt)
            return [GiftCardModel.model_validate(r) for r in result.scalars().all()]

    async def counts(self, db: Optional[AsyncSession] = None) -> dict:
        async with get_async_db_context(db) as db:
            async def _count(*conds) -> int:
                stmt = select(func.count()).select_from(GiftCard)
                for c in conds:
                    stmt = stmt.where(c)
                return (await db.execute(stmt)).scalar() or 0

            return {
                'total': await _count(),
                'redeemed': await _count(GiftCard.redeemed_by.isnot(None)),
                'available': await _count(
                    GiftCard.redeemed_by.is_(None), GiftCard.enabled.is_(True)
                ),
                'disabled': await _count(GiftCard.enabled.is_(False)),
            }


SubscriptionTiers = SubscriptionTiersTable()
UserSubscriptions = UserSubscriptionsTable()
SubscriptionOrders = SubscriptionOrdersTable()
SubscriptionUsage = SubscriptionUsageTable()
GiftCards = GiftCardsTable()
