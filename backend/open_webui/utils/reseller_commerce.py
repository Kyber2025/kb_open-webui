import secrets
import time
import uuid
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select, delete, func
from open_webui.internal.db import get_async_db
from open_webui.models.users import User
from open_webui.models.reseller_invites import ResellerInvite, ResellerCustomer
from open_webui.models.commerce import ResellerAccount, ResellerPrice, CommerceTransaction, CommerceHold
from open_webui.models.subscriptions import SubscriptionTier, GiftCards, GiftCard
from open_webui.utils.commerce_inventory import lock_tier, hold_stock, available_stock, release_hold
from open_webui.utils.subscription_payments import merchant_request, validate_order, VerifiedMerchantError, CANCELLABLE


async def require_reseller(db, user_id, lock=False):
    query = select(ResellerAccount).where(ResellerAccount.user_id == user_id)
    row = (await db.execute(query.with_for_update() if lock else query)).scalar_one_or_none()
    if not row or not row.enabled:
        raise HTTPException(403, '此账号尚未开通代理购买权限或已停用')
    return row


async def reseller_prices(db, user_id=None):
    tiers = (await db.execute(select(SubscriptionTier).where(SubscriptionTier.id.in_(('pro', 'ultra')),
        SubscriptionTier.enabled.is_(True)).order_by(SubscriptionTier.sort_order))).scalars().all()
    prices = {(p.scope, p.tier_id): p.price_usd for p in (await db.execute(select(ResellerPrice)
        .where(ResellerPrice.scope.in_(['default'] + ([user_id] if user_id else []))))).scalars()}
    return [dict(tier_id=t.id, name=t.name, duration_days=t.duration_days,
        retail_price=str(t.price_usd), default_price=str(prices['default', t.id]) if ('default', t.id) in prices else None,
        override_price=str(prices[user_id, t.id]) if (user_id, t.id) in prices else None,
        price=str(prices.get((user_id, t.id), prices.get(('default', t.id))))
            if (user_id, t.id) in prices or ('default', t.id) in prices else None) for t in tiers]


async def assign_reseller(admin, user_id, invite_id=None, name=None):
    async with get_async_db() as db:
        user = (await db.execute(select(User).where(User.id == user_id).with_for_update())).scalar_one_or_none()
        if not user or user.role not in ('user', 'admin'):
            raise HTTPException(400, '请选择已注册且可正常登录的用户')
        existing = await db.get(ResellerAccount, user_id)
        if existing:
            raise HTTPException(409, '该用户已经是代理商，请修改现有代理设置')
        now = int(time.time())
        if invite_id:
            invite = (await db.execute(select(ResellerInvite).where(ResellerInvite.id == invite_id).with_for_update())).scalar_one_or_none()
            if not invite:
                raise HTTPException(404, '邀请记录不存在')
            if (await db.execute(select(ResellerAccount).where(ResellerAccount.invite_id == invite_id))).scalar_one_or_none():
                raise HTTPException(409, '此邀请已绑定其他代理商')
        else:
            invite = ResellerInvite(id=str(uuid.uuid4()), name=(name or user.name or user.email).strip(),
                token=secrets.token_urlsafe(32), short_code=secrets.token_urlsafe(9), enabled=True, created_at=now)
            db.add(invite)
        db.add(ResellerAccount(user_id=user_id, invite_id=invite.id, enabled=True,
            created_by=admin.id, created_at=now, updated_at=now))
        await db.commit()
        return {'success': True}


async def set_reseller_enabled(user_id, enabled):
    async with get_async_db() as db:
        row = (await db.execute(select(ResellerAccount).where(ResellerAccount.user_id == user_id).with_for_update())).scalar_one_or_none()
        if not row:
            raise HTTPException(404, '代理商不存在')
        row.enabled, row.updated_at = enabled, int(time.time())
        await db.commit()
    return {'success': True}


async def set_price(admin, scope, tier_id, price):
    async with get_async_db() as db:
        await lock_tier(db, tier_id)
        if scope != 'default' and await db.get(ResellerAccount, scope) is None:
            raise HTTPException(404, '代理商不存在')
        row = await db.get(ResellerPrice, (scope, tier_id))
        if price is None:
            if row: await db.delete(row)
        else:
            if not row:
                row = ResellerPrice(scope=scope, tier_id=tier_id)
                db.add(row)
            row.price_usd, row.updated_by, row.updated_at = price, admin.id, int(time.time())
        await db.commit()
    return {'success': True}


async def reseller_profile(request, user):
    async with get_async_db() as db:
        row = await db.get(ResellerAccount, user.id)
        if not row:
            return {'is_reseller': False}
        invite = await db.get(ResellerInvite, row.invite_id)
        enabled = row.enabled
        prices = await reseller_prices(db, user.id)
        if enabled:
            for price in prices:
                price['remaining'] = await available_stock(request, db, price['tier_id'])
        # The reseller's own customer invitation: the short link only, never the long token.
        name, short_code, invite_enabled, customers = (invite.name if invite else user.name), None, False, 0
        if invite:
            invite_enabled = bool(invite.enabled)
            customers = (await db.execute(select(func.count()).select_from(ResellerCustomer)
                .where(ResellerCustomer.invite_id == invite.id))).scalar() or 0
            short_code = invite.short_code
            if not short_code:
                # Rows created before short links existed are completed on first use, as the admin list does.
                short_code = invite.short_code = secrets.token_urlsafe(9)
                await db.commit()
        return {'is_reseller': True, 'enabled': enabled, 'name': name,
            'short_code': short_code, 'invite_enabled': invite_enabled, 'customers': customers, 'prices': prices,
            'chains': request.app.state.config.SUBSCRIPTION_CHAINS or []}


async def create_purchase(request, user, tier_id, quantity, chain_id, request_id):
    chains = {str(c['id']) for c in request.app.state.config.SUBSCRIPTION_CHAINS or []}
    if chain_id not in chains:
        raise HTTPException(400, '请选择支持的 USDT 网络')
    # Idempotency key is bound to the authenticated user, never a submitted buyer ID.
    logical = 'kvr-' + uuid.uuid5(uuid.NAMESPACE_URL, user.id + ':' + request_id).hex
    order_id = logical + '_' + chain_id
    async with get_async_db() as db:
        await db.execute(select(User).where(User.id == user.id).with_for_update())
        await require_reseller(db, user.id, lock=True)
        tier = await lock_tier(db, tier_id)
        previous = (await db.execute(select(CommerceTransaction).where(
            CommerceTransaction.logical_order_id == logical))).scalar_one_or_none()
        if previous:
            if (previous.user_id, previous.tier_id, previous.quantity, previous.chain_id) != (user.id, tier_id, quantity, chain_id):
                raise HTTPException(409, '重复请求的购买参数不一致，请刷新后重试')
            order_id = previous.id
        else:
            now = int(time.time())
            # Database-backed limits work across both application nodes.
            recent = (await db.execute(select(func.count()).select_from(CommerceTransaction).where(
                CommerceTransaction.user_id == user.id, CommerceTransaction.source == 'reseller',
                CommerceTransaction.created_at > now-3600))).scalar()
            if recent >= 10:
                raise HTTPException(429, '创建订单过于频繁，请稍后再试')
            prices = await reseller_prices(db, user.id)
            price = next((p for p in prices if p['tier_id'] == tier_id), None)
            if not price or price['price'] is None:
                raise HTTPException(409, '此档位尚未配置代理价格，请联系管理员')
            unit = Decimal(price['price'])
            # Reserve before issuing an address; another invoice cannot replace it.
            await hold_stock(request, db, order_id, user.id, tier_id, quantity, now+900)
            db.add(CommerceTransaction(id=order_id, logical_order_id=logical, source='reseller', user_id=user.id,
                tier_id=tier_id, tier_name=tier.name, quantity=quantity, duration_days=tier.duration_days,
                unit_price=unit, amount=unit*quantity, chain_id=chain_id, status='CREATING', fulfilled=False, stock_backed=True,
                expires_at=now+900, created_at=now, updated_at=now))
            await db.commit()
    return await sync_purchase(request, user.id, order_id)


async def sync_purchase(request, user_id, order_id, *, source="reseller"):
    from open_webui.utils.subscription import generate_gift_cards
    from open_webui.utils.commerce_reports import transaction_view, iso_epoch
    from types import SimpleNamespace
    async with get_async_db() as db:
        order = (await db.execute(select(CommerceTransaction).where(CommerceTransaction.id == order_id)
            .with_for_update())).scalar_one_or_none()
        if not order or order.source != source or order.user_id != user_id:
            raise HTTPException(404, '订单不存在')
        if not order.fulfilled:
            cancelled = order.status == 'CANCELLED'
            stalled = order.status == 'CREATING' and order.expires_at <= int(time.time())
            create = order.status == 'CREATING' and not stalled
            try:
                data = await merchant_request(request, 'POST' if create else 'GET',
                'create' if create else 'status/' + order.id,
                {'orderId': order.logical_order_id, 'chainId': order.chain_id, 'amount': str(order.amount),
                 'expiresInSeconds': 900, 'notifyUrl': 'https://chat.kividas.com/api/v1/commerce/payment/notify'} if create else None)
            except VerifiedMerchantError:
                # Signed absence proves no address was issued. A cancelled intent simply stays cancelled.
                if not stalled and not cancelled: raise
                data = None
                if not cancelled: order.status = 'FAILED'
            if data:
                order.expires_at = validate_order(order, data)
                final = data.get('finalStatus') is True or data.get('final') is True
                # The buyer released a cancelled invoice. Only verified money may reopen it;
                # PENDING or EXPIRED from the payment platform must not undo the cancellation.
                if not cancelled or data['status'] == 'PAID':
                    order.status = 'EXPIRED_CHECKING' if data['status'] == 'EXPIRED' and not final else data['status']
                order.address, order.tx_hash, order.payment = data['address'], data.get('txHash'), data
                order.paid_at = iso_epoch(data.get('paidAt'))
            order.updated_at = int(time.time())
            # Persist verified money before trying to fulfill. Failure never loses it.
            await db.commit()
        order = (await db.execute(select(CommerceTransaction).where(CommerceTransaction.id == order_id)
            .with_for_update().execution_options(populate_existing=True))).scalar_one()
        if order.status in ('PAID', 'PAID_REQUIRES_ADMIN') and not order.fulfilled:
            await lock_tier(db, order.tier_id)
            remaining = await available_stock(request, db, order.tier_id, exclude_order=order.id)
            hold = await db.get(CommerceHold, order.id)
            if (order.stock_backed and hold is None) or remaining < order.quantity:
                order.status = 'PAID_REQUIRES_ADMIN'
            else:
                cards = await generate_gift_cards(SimpleNamespace(id=user_id), order.tier_id, order.quantity,
                    order.duration_days, '代理购买 ' + order.id, db=db, transaction=order, request=request)
                if source == 'b2b':
                    from open_webui.utils.b2b_commerce import attach_cards
                    await attach_cards(db, order, cards)
                order.batch_id, order.fulfilled, order.status = cards[0].batch_id, True, 'PAID'
                await release_hold(db, order.id)
            await db.commit()
        elif order.status in ('EXPIRED', 'FAILED'):
            await db.execute(delete(CommerceHold).where(CommerceHold.id == order.id))
            await db.commit()
        result = transaction_view(order)
        result['cards'] = [c.model_dump() for c in await GiftCards.list_cards(batch_id=order.batch_id, db=db)] if order.fulfilled else []
        return result


async def cancel_purchase(request, user, order_id, *, source="reseller"):
    """Reseller-requested early release of an unpaid purchase, without waiting for the payment window.

    Same contract as subscription_payments.cancel_checkout: the issued address can still receive USDT,
    so cancelling only frees the stock hold. Money that already arrived is settled instead of cancelled;
    money that arrives later is recorded and handed to an administrator, like a payment after expiry.
    """
    paid = False
    async with get_async_db() as db:
        # Same lock order as create_purchase: the buyer row, then the order.
        if source == 'b2b':
            from open_webui.utils.b2b_commerce import lock_buyer
            await lock_buyer(db, user.id)
        else:
            await db.execute(select(User).where(User.id == user.id).with_for_update())
        order = (await db.execute(select(CommerceTransaction).where(CommerceTransaction.id == order_id)
            .with_for_update())).scalar_one_or_none()
        if not order or order.source != source or order.user_id != user.id:
            raise HTTPException(404, '订单不存在')
        if order.status != 'CANCELLED':
            if order.fulfilled or order.status not in CANCELLABLE:
                raise HTTPException(409, '订单已到账或已结束，不能取消')
            data = None
            try:
                # Fresh signed evidence: a stale local PENDING must not cancel a paid invoice.
                data = await merchant_request(request, 'GET', 'status/' + order.id)
            except VerifiedMerchantError:
                if order.status != 'CREATING': raise  # Only an unissued intent may be absent.
            if data:
                validate_order(order, data)
                paid = data['status'] == 'PAID'
            if not paid:
                now = int(time.time())
                order.status, order.updated_at = 'CANCELLED', now
                order.note = ((order.note or '') + f'\n代理于 {now} 取消未付款订单，库存预留已释放').strip()
                await db.execute(delete(CommerceHold).where(CommerceHold.id == order.id))
                await db.commit()
    if paid:
        # The payment won the race. Settle it (the hold is still in place) instead of cancelling.
        await sync_purchase(request, user.id, order_id, source=source)
        raise HTTPException(409, '付款已到账，订单不能取消')
    return await sync_purchase(request, user.id, order_id, source=source)
