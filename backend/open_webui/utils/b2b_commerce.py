"""Trusted ToB checkout uses the SAME stock and signed-payment fulfillment as ToC."""
import hashlib
import time
import uuid
from decimal import Decimal
from types import SimpleNamespace
from fastapi import HTTPException
from sqlalchemy import select, text
from open_webui.internal.db import get_async_db
from open_webui.models.commerce import CommerceTransaction, B2BCheckout, B2BCard, B2BTransfer
from open_webui.utils.commerce_inventory import lock_tier, hold_stock
from open_webui.utils.reseller_commerce import sync_purchase, cancel_purchase


async def lock_buyer(db, buyer):
    # External buyers have no customer User row. A transaction-scoped PG lock
    # serializes concurrent checkout/cancellation, including the first order.
    await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:buyer, 0))'), {'buyer': buyer})


async def create_purchase(request, form):
    if form.chain_id not in {str(c['id']) for c in request.app.state.config.SUBSCRIPTION_CHAINS or []}:
        raise HTTPException(400, '请选择支持的 USDT 网络')
    buyer = 'b2b:' + form.buyer_id
    logical = 'kvb-' + uuid.uuid5(uuid.NAMESPACE_URL, form.order_id).hex
    order_id = logical + '_' + form.chain_id
    async with get_async_db() as db:
        await lock_buyer(db, buyer)
        await lock_buyer(db, 'order:' + form.order_id)
        old = (await db.execute(select(CommerceTransaction).where(CommerceTransaction.logical_order_id == logical))).scalar_one_or_none()
        unit = Decimal(form.unit_price)
        if old:
            meta = await db.get(B2BCheckout, old.id)
            if not meta or meta.company_id != form.company_id or meta.buyer_id != form.buyer_id:
                raise HTTPException(409, '订单公司归属不一致')
            if (old.source, old.user_id, old.actor_id, old.tier_id, old.quantity, old.chain_id, old.unit_price) != (
                    'b2b', buyer, form.order_id, form.tier_id, form.quantity, form.chain_id, unit):
                raise HTTPException(409, '订单参数与原始报价不一致')
            order_id = old.id
        else:
            tier = await lock_tier(db, form.tier_id)
            now = int(time.time())
            await hold_stock(request, db, order_id, buyer, tier.id, form.quantity, now + 900)
            db.add(CommerceTransaction(id=order_id, logical_order_id=logical, source='b2b',
                user_id=buyer, actor_id=form.order_id, tier_id=tier.id, tier_name=tier.name,
                duration_days=tier.duration_days, quantity=form.quantity, unit_price=unit,
                amount=unit * form.quantity, chain_id=form.chain_id, status='CREATING',
                fulfilled=False, stock_backed=True, expires_at=now+900, created_at=now, updated_at=now))
            db.add(B2BCheckout(order_id=order_id, external_id=form.order_id, company_id=form.company_id, buyer_id=form.buyer_id))
            await db.commit()
    return await sync_purchase(request, buyer, order_id, source='b2b')


async def order_view(request, order_id, cancel=False, snapshot=False):
    async with get_async_db() as db:
        row = await db.get(CommerceTransaction, order_id)
        if not row or row.source not in ('b2b', 'b2b_manual'):
            raise HTTPException(404, '订单不存在')
        buyer = row.user_id
        if snapshot and row.status in ('CANCELLED', 'EXPIRED', 'FAILED') and (row.payment or {}).get('status') != 'PAID':
            from open_webui.utils.commerce_reports import transaction_view
            return transaction_view(row)
        if row.source == 'b2b_manual':
            if cancel: raise HTTPException(409, '管理员发放不能取消付款')
            from open_webui.utils.commerce_reports import transaction_view
            return transaction_view(row)
    if cancel:
        return await cancel_purchase(request, SimpleNamespace(id=buyer), order_id, source='b2b')
    return await sync_purchase(request, buyer, order_id, source='b2b')


async def attach_cards(db, order, cards):
    checkout = await db.get(B2BCheckout, order.id)
    if not checkout:
        raise HTTPException(409, 'ToB ownership record missing')
    now = int(time.time())
    for card in cards:
        db.add(B2BCard(code=card.code, order_id=order.id, company_id=checkout.company_id,
            owner_id=checkout.buyer_id, updated_at=now))


async def manual_issue(request, form):
    from open_webui.utils.subscription import generate_gift_cards
    from open_webui.utils.commerce_reports import transaction_view
    order_id = 'kvbm-' + uuid.uuid5(uuid.NAMESPACE_URL, form.order_id).hex
    buyer = 'b2b:' + form.buyer_id
    async with get_async_db() as db:
        await lock_buyer(db, buyer)
        await lock_buyer(db, 'order:' + form.order_id)
        row = await db.get(CommerceTransaction, order_id)
        if row:
            meta = await db.get(B2BCheckout, row.id)
            if (row.user_id, row.tier_id, row.quantity, row.note, meta.company_id) != (buyer, form.tier_id, form.quantity, form.note, form.company_id):
                raise HTTPException(409, '发放参数与原记录不一致')
            return transaction_view(row)
        tier = await lock_tier(db, form.tier_id)
        now = int(time.time())
        row = CommerceTransaction(id=order_id, logical_order_id=order_id, source='b2b_manual', user_id=buyer,
            actor_id=form.order_id, tier_id=tier.id, tier_name=tier.name, quantity=form.quantity,
            duration_days=tier.duration_days, unit_price=None, amount=None, status='ISSUED', fulfilled=False,
            stock_backed=True, note=form.note, created_at=now, updated_at=now)
        db.add(row)
        db.add(B2BCheckout(order_id=order_id, external_id=form.order_id, company_id=form.company_id, buyer_id=form.buyer_id))
        await db.flush()
        cards = await generate_gift_cards(SimpleNamespace(id=buyer),tier.id,form.quantity,tier.duration_days,
            form.note,db=db,transaction=row,request=request)
        await attach_cards(db,row,cards)
        row.batch_id, row.fulfilled = cards[0].batch_id, True
        await db.commit()
        return transaction_view(row)


def card_ref(code):
    # Stable opaque reference for the ledger; never a redeemable secret.
    return hashlib.sha256(('b2b-card:' + code).encode()).hexdigest()[:24]


async def inventory(form):
    from open_webui.models.subscriptions import GiftCard
    async with get_async_db() as db:
        q = select(B2BCard, GiftCard, B2BCheckout, CommerceTransaction).join(GiftCard, GiftCard.code == B2BCard.code).join(
            B2BCheckout, B2BCheckout.order_id == B2BCard.order_id).join(CommerceTransaction, CommerceTransaction.id == B2BCard.order_id).where(
            B2BCard.company_id == form.company_id, B2BCard.owner_id.in_(form.owner_ids))
        rows = (await db.execute(q.order_by(B2BCard.updated_at.desc(), B2BCard.code).offset(form.offset).limit(200))).all()
        return {'items': [dict(code=c.code if form.include_codes else None, cardRef=card_ref(c.code), ownerId=c.owner_id,
            orderId=m.external_id, remoteOrderId=c.order_id, source='TRANSFER' if c.owner_id != m.buyer_id else o.source,
            originalSource=o.source, tierId=g.tier_id, durationDays=g.duration_days, enabled=g.enabled,
            redeemedAt=g.redeemed_at, updatedAt=c.updated_at) for c,g,m,o in rows], 'hasMore': len(rows)==200}


async def transfer(request, form):
    from open_webui.models.subscriptions import GiftCard
    codes = sorted(set(form.codes))
    if len(codes)!=len(form.codes) or form.from_id==form.to_id:
        raise HTTPException(400, '转发卡号或目标无效')
    async with get_async_db() as db:
        await lock_buyer(db, 'transfer:' + form.request_id)
        prior = await db.get(B2BTransfer, form.request_id)
        if prior:
            if (prior.company_id,prior.from_id,prior.to_id,prior.actor_id,prior.codes,prior.note)!=(form.company_id,form.from_id,form.to_id,form.actor_id,codes,form.note):
                raise HTTPException(409, '转发参数与原记录不一致')
            return {'id':prior.id,'quantity':len(codes),'amount':'0.000000','createdAt':prior.created_at}
        # Match redemption's tier -> card lock order. A redeemed/disabled card
        # cannot be handed on, and overlapping transfers cannot double-assign.
        tiers = (await db.execute(select(GiftCard.tier_id).where(GiftCard.code.in_(codes)).distinct())).scalars().all()
        for tier in sorted(tiers): await lock_tier(db,tier)
        cards = (await db.execute(select(GiftCard).where(GiftCard.code.in_(codes)).order_by(GiftCard.code).with_for_update())).scalars().all()
        owned = (await db.execute(select(B2BCard).where(B2BCard.code.in_(codes)).order_by(B2BCard.code).with_for_update())).scalars().all()
        if len(cards)!=len(codes) or len(owned)!=len(codes) or any(not g.enabled or g.redeemed_by for g in cards) or any(
                c.company_id!=form.company_id or c.owner_id!=form.from_id for c in owned):
            raise HTTPException(409, '只能转发自己持有且未兑换的有效卡')
        now=int(time.time())
        for c in owned: c.owner_id,c.updated_at=form.to_id,now
        db.add(B2BTransfer(id=form.request_id,company_id=form.company_id,from_id=form.from_id,to_id=form.to_id,
            actor_id=form.actor_id,codes=codes,note=form.note,created_at=now))
        await db.commit()
        return {'id':form.request_id,'quantity':len(codes),'amount':'0.000000','createdAt':now}


async def transfer_report(form):
    from sqlalchemy import or_
    async with get_async_db() as db:
        q=select(B2BTransfer).where(B2BTransfer.company_id==form.company_id,
            or_(B2BTransfer.from_id.in_(form.owner_ids),B2BTransfer.to_id.in_(form.owner_ids)))
        if form.start is not None: q=q.where(B2BTransfer.created_at>=form.start)
        if form.end is not None: q=q.where(B2BTransfer.created_at<form.end)
        rows=(await db.execute(q.order_by(B2BTransfer.created_at.desc(),B2BTransfer.id).offset(form.offset).limit(200))).scalars().all()
        codes={code for r in rows for code in r.codes}
        origins=(await db.execute(select(B2BCard.code,B2BCheckout.external_id,CommerceTransaction.tier_id,
            CommerceTransaction.source).join(B2BCheckout,B2BCheckout.order_id==B2BCard.order_id)
            .join(CommerceTransaction,CommerceTransaction.id==B2BCard.order_id)
            .where(B2BCard.code.in_(codes),B2BCard.company_id==form.company_id))).all() if codes else []
        refs={c:dict(cardRef=card_ref(c),orderId=o,tierId=t,source=s) for c,o,t,s in origins}
        return {'items':[dict(id=r.id,fromId=r.from_id,toId=r.to_id,actorId=r.actor_id,quantity=len(r.codes),
            kind='TRANSFER',status='TRANSFERRED',unitPrice='0.000000',amount='0.000000',paidAmount='0.000000',
            note=r.note,createdAt=r.created_at,cards=[refs.get(c,{'cardRef':card_ref(c)}) for c in r.codes])
            for r in rows],'hasMore':len(rows)==200}
