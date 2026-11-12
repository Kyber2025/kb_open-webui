"""Explicit administrator recovery of verified paid orders; never fabricates payment."""
import time
from fastapi import HTTPException
from sqlalchemy import select
from open_webui.internal.db import get_async_db
from open_webui.models.commerce import CommerceTransaction, CommerceHold
from open_webui.models.users import User, Users
from open_webui.models.subscriptions import UserSubscriptions
from open_webui.utils.commerce_inventory import available_stock, lock_tier
from open_webui.utils.subscription_payments import merchant_request, validate_order, sync_checkout
from open_webui.utils.reseller_commerce import sync_purchase


async def retry_fulfillment(request, admin, order_id):
    async with get_async_db() as db:
        snapshot = await db.get(CommerceTransaction, order_id)
        if not snapshot or snapshot.source not in ('subscription', 'reseller', 'b2b') or not snapshot.user_id:
            raise HTTPException(404, '购买记录不存在')
        user_id, source = snapshot.user_id, snapshot.source
        if source == 'b2b':
            from open_webui.utils.b2b_commerce import lock_buyer
            await lock_buyer(db, user_id)
        else:
            await db.execute(select(User).where(User.id == user_id).with_for_update())
        row = (await db.execute(select(CommerceTransaction).where(CommerceTransaction.id == order_id)
            .with_for_update().execution_options(populate_existing=True))).scalar_one()
        if row.fulfilled:
            return {'success': True, 'fulfilled': True}
        data = await merchant_request(request, 'GET', 'status/' + row.id)
        validate_order(row, data)
        if data['status'] != 'PAID':
            raise HTTPException(409, '支付平台尚未确认到账，无法交付')
        await lock_tier(db, row.tier_id)
        quantity = row.quantity
        if source == 'subscription':
            current = await UserSubscriptions.get_active_for_user(user_id, db=db)
            if current and current.tier_id == row.tier_id:
                quantity = 0
        if await available_stock(request, db, row.tier_id, exclude_order=row.id) < quantity:
            raise HTTPException(409, '当前库存仍不足，请补充账号资源后重试')
        if await db.get(CommerceHold, row.id) is None:
            db.add(CommerceHold(id=row.id, user_id=user_id, tier_id=row.tier_id,
                quantity=quantity, expires_at=int(time.time())+900))
        row.payment = data
        row.note = (row.note or '') + f'\n管理员 {admin.id} 于 {int(time.time())} 核验到账并重试交付'
        await db.commit()
    if source == 'b2b':
        result = await sync_purchase(request, user_id, order_id, source=source)
        return {'success': True, 'fulfilled': result['fulfilled']}
    user = await Users.get_user_by_id(user_id)
    if not user:
        raise HTTPException(409, '购买用户已不存在，请人工处理')
    if source == 'reseller':
        result = await sync_purchase(request, user_id, order_id)
        return {'success': True, 'fulfilled': result['fulfilled']}
    result = await sync_checkout(request, user, order_id)
    return {'success': True, 'fulfilled': result['activated']}
