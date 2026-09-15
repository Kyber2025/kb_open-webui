"""Coordinate subscriptions with Claude resources without double granting.

The local user row serializes grants. Capacity is reserved before money is requested
or a grant is committed. A durable outbox retries the remote commit after a crash.
"""
import logging
import time
import uuid
from fastapi import HTTPException
from sqlalchemy import select, func
from open_webui.internal.db import get_async_db
from open_webui.models.users import User
from open_webui.models.kyber_accounts import UserKyberAccounts
from open_webui.models.subscriptions import UserSubscription, UserSubscriptionModel, SubscriptionTier, SubscriptionOrder, GiftCard
from open_webui.models.subscription_changes import SubscriptionChange


log = logging.getLogger(__name__)


async def _internal_request(request, method, path, payload=None):
    from open_webui.utils.kyber import _internal_request as send
    return await send(request, method, path, payload)


async def routing_enabled(request):
    if not getattr(request.app.state.config, 'ENABLE_KYBER_TOKEN_BILLING', False):
        return False
    status, data = await _internal_request(request, 'GET', '/internal/claude-routing/status')
    if status != 200:
        raise HTTPException(503, '无法确认账号资源状态，请稍后再试')
    return bool(data.get('enabled'))


async def resource_call(request, action, payload):
    status, data = await _internal_request(request, 'POST', f'/internal/claude-routing/{action}', payload)
    if status != 200:
        message = data.get('message') or (data.get('error', {}).get('message') if isinstance(data.get('error'), dict) else None)
        raise HTTPException(409 if status == 409 else 503, message or '账号资源同步未完成，请稍后重试或联系管理员处理')
    return data


async def reserve_order(request, user_id, tier_id, operation_id, expires_at):
    if not await routing_enabled(request):
        return False
    link = await UserKyberAccounts.get_by_user_id(user_id)
    if not link or not link.kyber_user_id:
        raise HTTPException(409, '用户尚未关联平台账号，请联系管理员处理')
    await resource_call(request, 'reserve', dict(userId=link.kyber_user_id, tier=tier_id, operationId=operation_id, expiresAt=expires_at))
    return True


async def cancel_reservation(request, user_id, operation_id):
    link = await UserKyberAccounts.get_by_user_id(user_id)
    if link and link.kyber_user_id:
        await resource_call(request, 'cancel', dict(userId=link.kyber_user_id, operationId=operation_id))


async def propagate(request, change_id, db=None):
    if db is None:
        async with get_async_db() as session:
            result = await propagate(request, change_id, session)
            await session.commit()
            return result
    change = await db.get(SubscriptionChange, change_id)
    if change is None or change.synced:
        return
    await resource_call(request, 'commit', dict(userId=change.kyber_user_id, operationId=change.id,
        tier=change.tier_id, expiresAt=change.expires_at, version=change.version))
    change.synced = True
    change.error = None


async def change_subscription(request, user_id, tier_id, *, operation_id=None, expires_at=None,
                              duration_days=None, order_id=None, gift_code=None, revoke_order_id=None):
    """Grant/set/cancel atomically with an idempotency record; never silently succeed."""
    operation_id = operation_id or f'admin:{uuid.uuid4()}'
    enabled = await routing_enabled(request)
    link = await UserKyberAccounts.get_by_user_id(user_id)
    if enabled and (not link or not link.kyber_user_id):
        raise HTTPException(409, '用户尚未关联平台账号，请联系管理员处理')
    reserved_here = False
    committed = False
    async with get_async_db() as db:
        try:
            await db.execute(select(User).where(User.id == user_id).with_for_update())
            previous = await db.get(SubscriptionChange, operation_id)
            if previous:
                if previous.user_id != user_id:
                    raise HTTPException(409, '订阅操作已被使用')
                await propagate(request, operation_id, db)
                target = await db.get(UserSubscription, previous.subscription_id) if previous.subscription_id else None
                await db.commit()
                return UserSubscriptionModel.model_validate(target) if target else None
            pending = (await db.execute(select(SubscriptionChange).where(SubscriptionChange.user_id == user_id, SubscriptionChange.synced == False).order_by(SubscriptionChange.version))).scalars().all()
            for old in pending:
                await propagate(request, old.id, db)
            now = int(time.time())
            active = (await db.execute(select(UserSubscription).where(UserSubscription.user_id == user_id, UserSubscription.status == 'active', UserSubscription.expires_at > now))).scalars().all()
            if revoke_order_id and not any(s.order_id == revoke_order_id for s in active):
                await db.commit()
                return None
            tier = await db.get(SubscriptionTier, tier_id)
            if tier is None or not tier.enabled or tier_id not in ('free', 'pro', 'max', 'ultra'):
                raise HTTPException(409, '此订阅档位已停用，请选择新的档位')
            card = None
            if gift_code:
                card = (await db.execute(select(GiftCard).where(GiftCard.code == gift_code).with_for_update())).scalar_one_or_none()
                if not card or not card.enabled or card.redeemed_by:
                    raise HTTPException(409, '兑换码无效、已停用或已被使用')
                if card.tier_id != tier_id:
                    raise HTTPException(409, '兑换码档位发生变化，请重试')
                duration_days = card.duration_days
            order = None
            if order_id:
                order = (await db.execute(select(SubscriptionOrder).where(SubscriptionOrder.id == order_id).with_for_update())).scalar_one_or_none()
                if not order or order.user_id != user_id or order.tier_id != tier_id or order.status != 'PAID':
                    raise HTTPException(409, '订阅订单状态不允许开通')
                if order.activated:
                    await db.commit()
                    return UserSubscriptionModel.model_validate(active[0]) if active else None
            if tier_id != 'free':
                if duration_days is not None:
                    base = max([now] + [s.expires_at for s in active if s.tier_id == tier_id])
                    expires_at = base + int(duration_days) * 86400
                if not expires_at or expires_at <= now:
                    raise HTTPException(400, '订阅到期时间必须晚于当前时间')
                if enabled:
                    await resource_call(request, 'reserve', dict(userId=link.kyber_user_id, tier=tier_id,
                        operationId=operation_id, expiresAt=now + 86400))
                    reserved_here = not bool(order_id)
            else:
                expires_at = None
            for sub in active:
                sub.status = 'cancelled' if tier_id == 'free' else 'expired'
                sub.updated_at = now
            target = None
            if tier_id != 'free':
                target = UserSubscription(id=str(uuid.uuid4()), user_id=user_id, tier_id=tier_id,
                    status='active', started_at=now, expires_at=expires_at,
                    order_id=order_id or (f'gift:{gift_code}' if gift_code else operation_id), created_at=now, updated_at=now)
                db.add(target)
            if card:
                card.redeemed_by, card.redeemed_at, card.updated_at = user_id, now, now
            if order:
                order.activated, order.updated_at = True, now
            latest = (await db.execute(select(func.max(SubscriptionChange.version)).where(SubscriptionChange.user_id == user_id))).scalar() or 0
            version = max(time.time_ns() // 1000, latest + 1)
            db.add(SubscriptionChange(id=operation_id, user_id=user_id, version=version, tier_id=tier_id,
                expires_at=expires_at, kyber_user_id=link.kyber_user_id if link else None,
                subscription_id=target.id if target else None, synced=not enabled, created_at=now))
            await db.commit()
            committed = True
        except Exception:
            await db.rollback()
            if reserved_here and not committed:
                try:
                    await cancel_reservation(request, user_id, operation_id)
                except Exception:
                    log.warning('reservation cleanup deferred to expiry for %s', operation_id)
            raise
    # A failure here leaves a durable grant/outbox, never releases a redeemed card.
    await propagate(request, operation_id)
    return UserSubscriptionModel.model_validate(target) if target else None


async def reconcile_allocations(request):
    async with get_async_db() as db:
        ids = (await db.execute(select(SubscriptionChange.id).where(SubscriptionChange.synced == False).order_by(SubscriptionChange.version).limit(100))).scalars().all()
    for change_id in ids:
        try:
            await propagate(request, change_id)
        except Exception:
            log.warning('subscription allocation still pending: %s', change_id)


async def latest_change(user_id):
    async with get_async_db() as db:
        return (await db.execute(select(SubscriptionChange).where(SubscriptionChange.user_id == user_id).order_by(SubscriptionChange.version.desc()).limit(1))).scalar_one_or_none()
