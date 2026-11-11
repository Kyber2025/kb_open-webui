"""A tier-row lock serializes all website stock commitments across app nodes."""
import time
from fastapi import HTTPException
from sqlalchemy import select, func, delete
from open_webui.models.commerce import CommerceHold, CommerceTransaction
from open_webui.models.subscriptions import SubscriptionTier, GiftCards, GiftCard
from open_webui.utils.claude_allocation import resource_call


async def lock_tier(db, tier_id):
    tier = (await db.execute(select(SubscriptionTier).where(SubscriptionTier.id == tier_id)
        .with_for_update())).scalar_one_or_none()
    if not tier or not tier.enabled or tier_id not in ('pro', 'ultra'):
        raise HTTPException(409, '此订阅档位已停用')
    return tier


async def held_counts(db, exclude_order=None):
    # A clock deadline only schedules reconciliation. Release requires a signed
    # final payment state; slow confirmations must never lose their stock.
    query = select(CommerceHold.tier_id, func.sum(CommerceHold.quantity))
    if exclude_order:
        query = query.where(CommerceHold.id != exclude_order)
    return dict((await db.execute(query.group_by(CommerceHold.tier_id))).all())


async def available_stock(request, db, tier_id, exclude_order=None):
    capacity = await resource_call(request, 'capacity', {'userId': 'unlinked-web:commerce-stock'})
    issued = await GiftCards.available_counts_by_tier(db=db)
    held = await held_counts(db, exclude_order)
    return max(0, capacity.get(tier_id, {}).get('remaining', 0) - issued.get(tier_id, 0) - held.get(tier_id, 0))


async def hold_stock(request, db, order_id, user_id, tier_id, quantity, expires_at):
    # Caller holds the user and tier row locks. Never release an older address
    # merely because the user changes networks; it can still receive USDT.
    existing = (await db.execute(select(CommerceHold.id).where(CommerceHold.user_id == user_id))).first()
    if existing:
        raise HTTPException(409, '已有待支付或核对中的订单，请先完成付款、取消该订单，或等待订单过期核对')
    now = int(time.time())
    recent = (await db.execute(select(func.count()).select_from(CommerceTransaction).where(
        CommerceTransaction.user_id == user_id, CommerceTransaction.created_at > now-3600))).scalar()
    abandoned = (await db.execute(select(func.count()).select_from(CommerceTransaction).where(
        CommerceTransaction.user_id == user_id, CommerceTransaction.status.in_(('EXPIRED','FAILED')),
        CommerceTransaction.expires_at > now-1800))).scalar()
    if recent >= 5 or abandoned >= 3:
        raise HTTPException(429, '建单过于频繁或多次未付款，请在 30 分钟后重试')
    if quantity > await available_stock(request, db, tier_id):
        raise HTTPException(409, '当前套餐库存不足，请减少数量或稍后再试')
    db.add(CommerceHold(id=order_id, user_id=user_id, tier_id=tier_id,
        quantity=quantity, expires_at=expires_at))


async def release_hold(db, order_id):
    await db.execute(delete(CommerceHold).where(CommerceHold.id == order_id))


async def change_card(request, code, *, enabled=None, remove=False):
    from open_webui.internal.db import get_async_db
    async with get_async_db() as db:
        card = await db.get(GiftCard, code)
        if not card:
            raise HTTPException(404, '激活码不存在')
        # All mutations use the same tier -> card lock order as redemption.
        await db.execute(select(SubscriptionTier).where(SubscriptionTier.id == card.tier_id).with_for_update())
        card = (await db.execute(select(GiftCard).where(GiftCard.code == code)
            .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        if not card:
            raise HTTPException(404, '激活码不存在')
        if remove:
            await db.delete(card)
        else:
            if enabled and not card.enabled and not card.redeemed_by:
                if await available_stock(request, db, card.tier_id) < 1:
                    raise HTTPException(409, '当前套餐库存不足，无法重新启用激活码')
            card.enabled, card.updated_at = enabled, int(time.time())
        await db.commit()
        return {'success': True, 'enabled': enabled}
