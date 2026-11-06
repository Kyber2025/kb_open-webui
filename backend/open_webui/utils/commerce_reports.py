import csv
import io
import time
from decimal import Decimal
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, func, or_
from open_webui.internal.db import get_async_db
from open_webui.models.commerce import CommerceTransaction, CommerceSync
from open_webui.models.subscriptions import SubscriptionOrder, SubscriptionTier
from open_webui.models.users import User
from open_webui.utils.subscription_payments import merchant_request


def transaction_view(row):
    return {key: (str(value) if isinstance(value, Decimal) else value) for key in (
        'id', 'source', 'user_id', 'actor_id', 'tier_id', 'tier_name', 'quantity', 'duration_days',
        'unit_price', 'amount', 'chain_id', 'status', 'fulfilled', 'batch_id', 'address', 'tx_hash',
        'payment', 'collections', 'note', 'expires_at', 'created_at', 'updated_at', 'synced_at')
        for value in [getattr(row, key)]}


async def record_subscription_order(order_id, payment=None, db=None, fulfilled=None):
    if db is None:
        async with get_async_db() as session:
            await record_subscription_order(order_id, payment, session, fulfilled)
            await session.commit()
            return
    order = await db.get(SubscriptionOrder, order_id)
    if not order:
        return
    row = await db.get(CommerceTransaction, order_id)
    previous_fulfilled = row.fulfilled if row else order.activated
    if not row:
        tier = await db.get(SubscriptionTier, order.tier_id)
        row = CommerceTransaction(id=order.id, source='subscription', logical_order_id=order.logical_order_id,
            user_id=order.user_id, tier_id=order.tier_id, tier_name=tier.name if tier else order.tier_id,
            quantity=1, unit_price=Decimal(order.amount), amount=Decimal(order.amount), chain_id=order.chain_id,
            created_at=order.created_at)
        db.add(row)
    row.status, row.fulfilled, row.address, row.tx_hash = order.status, bool(order.activated and previous_fulfilled), order.address, order.tx_hash
    from open_webui.models.subscription_changes import SubscriptionChange
    change = await db.get(SubscriptionChange, order.logical_order_id)
    if change and not change.synced:
        row.fulfilled = False
    if fulfilled is not None:
        row.fulfilled = fulfilled
    row.expires_at, row.updated_at = order.expires_at, order.updated_at
    if payment:
        row.payment, row.synced_at = payment, int(time.time())
        row.paid_at = iso_epoch(payment.get('paidAt'))


async def import_subscription_orders(db):
    ids = (await db.execute(select(SubscriptionOrder.id).outerjoin(CommerceTransaction,
        CommerceTransaction.id == SubscriptionOrder.id).where(or_(CommerceTransaction.id.is_(None),
            CommerceTransaction.status != SubscriptionOrder.status,
            (CommerceTransaction.fulfilled.is_(True) & SubscriptionOrder.activated.is_(False)),
            CommerceTransaction.updated_at < SubscriptionOrder.updated_at)))).scalars().all()
    for order_id in ids:
        await record_subscription_order(order_id, db=db)
    await db.flush()


def iso_epoch(value):
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()) if value else None


async def sync_payment_reports(request):
    # Hold a DB lock so concurrent administrators cannot advance the same cursor.
    async with get_async_db() as db:
        # A stable existing tier row serializes first-time cursor creation only.
        await db.execute(select(SubscriptionTier).where(SubscriptionTier.id == 'free').with_for_update())
        cursor = (await db.execute(select(CommerceSync).where(CommerceSync.id == 'payment').with_for_update())).scalar_one_or_none()
        if cursor is None:
            cursor = CommerceSync(id='payment', cursor=0, updated_at=0)
            db.add(cursor)
            await db.flush()
        now = int(time.time())
        if cursor.updated_at > now-15:
            return {'synced_at': cursor.updated_at, 'updated': 0}
        await import_subscription_orders(db)
        after, updated, checkpoint = 0, 0, None
        for _ in range(500):
            data = await merchant_request(request, 'POST', 'reports/orders',
                {'afterId': after, 'since': max(0, cursor.cursor-60), 'limit': 100})
            if checkpoint is None:
                checkpoint = int(data['serverTime'])
            for item in data['items']:
                payment = item['payment']
                order_id = payment['orderId']
                row = await db.get(CommerceTransaction, order_id)
                if row is None:
                    row = CommerceTransaction(id=order_id, source='payment', logical_order_id=payment['merchantOrderId'],
                        quantity=1, amount=Decimal(payment['amount']), chain_id=payment['chainId'],
                        status=payment['status'], fulfilled=False, created_at=iso_epoch(payment['createTime']) or now,
                        updated_at=now)
                    db.add(row)
                row.payment = payment
                row.paid_at = iso_epoch(payment.get('paidAt'))
                row.collections = {'items': item.get('collections', []), 'shared': bool(item.get('sharedCollection')),
                    'unmatched': item.get('unmatchedTransfers', [])}
                row.synced_at = now
                row.address, row.tx_hash = payment.get('address'), payment.get('txHash')
                if row.source == 'payment':
                    row.status, row.expires_at = payment['status'], iso_epoch(payment.get('expiresAt'))
                updated += 1
            if not data['hasMore']:
                break
            next_id = int(data['nextId'])
            if next_id <= after:
                raise HTTPException(502, '支付报表分页校验失败')
            after = next_id
        else:
            raise HTTPException(503, '待同步记录过多，请联系管理员；同步进度未提前推进')
        cursor.cursor, cursor.updated_at = checkpoint or now, now
        await db.commit()
        return {'synced_at': now, 'updated': updated}


def transaction_query(filters, owner=None):
    query = select(CommerceTransaction)
    if owner:
        query = query.where(CommerceTransaction.user_id == owner, CommerceTransaction.source == 'reseller')
    for key in ('source', 'tier_id', 'status', 'chain_id', 'user_id'):
        if filters.get(key):
            query = query.where(getattr(CommerceTransaction, key) == filters[key])
    if filters.get('start') is not None:
        query = query.where(CommerceTransaction.created_at >= filters['start'])
    if filters.get('end') is not None:
        query = query.where(CommerceTransaction.created_at < filters['end'])
    if filters.get('search'):
        pattern = '%' + filters['search'].strip() + '%'
        matching_users = select(User.id).where(or_(User.name.ilike(pattern), User.email.ilike(pattern)))
        query = query.where(or_(CommerceTransaction.id.ilike(pattern), CommerceTransaction.tx_hash.ilike(pattern),
            CommerceTransaction.address.ilike(pattern), CommerceTransaction.batch_id.ilike(pattern),
            CommerceTransaction.user_id.in_(matching_users), CommerceTransaction.actor_id.in_(matching_users)))
    return query


async def list_transactions(filters, owner=None):
    async with get_async_db() as db:
        if not owner:
            await import_subscription_orders(db)
            await db.commit()
        query = transaction_query(filters, owner)
        total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar()
        page, size = filters.get('page', 1), filters.get('page_size', 20)
        rows = (await db.execute(query.order_by(CommerceTransaction.created_at.desc(), CommerceTransaction.id.desc())
            .offset((page-1)*size).limit(size))).scalars().all()
        ids = {r.user_id for r in rows} | {r.actor_id for r in rows}
        users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(list(ids - {None}))))).scalars()}
        result = []
        for row in rows:
            view = transaction_view(row)
            for key, user_id in [('buyer', row.user_id), ('actor', row.actor_id)]:
                user = users.get(user_id)
                view[key] = {'id': user.id, 'name': user.name, 'email': user.email} if user else None
            result.append(view)
        cursor = await db.get(CommerceSync, 'payment')
        return {'items': result, 'total': total, 'page': page, 'page_size': size,
            'synced_at': cursor.updated_at if cursor else None}


def csv_cell(value):
    value = '' if value is None else str(value)
    # Spreadsheet exports must not execute buyer-controlled names/notes as formulas.
    return "'" + value if value.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')) else value


async def export_transactions(filters, owner=None):
    stream = io.StringIO()
    writer = csv.writer(stream)
    columns = [('id','记录号'),('source','来源'),('buyer_name','购买人'),('buyer_email','购买人邮箱'),
        ('actor_name','操作人'),('tier_name','档位'),('quantity','数量'),('duration_days','天数'),
        ('unit_price','单价 USDT'),('amount','订单金额 USDT'),('paid_amount','实收 USDT'),
        ('status','状态'),('fulfilled','已交付'),('chain_id','链'),('address','收款地址'),('tx_hash','交易哈希'),
        ('from_address','付款地址'),('batch_id','激活码批次'),('created_time','创建时间 UTC+8'),('note','备注')]
    writer.writerow([title for _,title in columns])
    yield '\ufeff' + stream.getvalue()
    # One SQL cursor preserves a consistent row set while new sales are inserted.
    # Offset pagination could otherwise duplicate or omit records in the export.
    from sqlalchemy.orm import aliased
    from datetime import timedelta
    buyer, actor = aliased(User), aliased(User)
    async with get_async_db() as db:
        if not owner:
            await import_subscription_orders(db)
            await db.commit()
        query = transaction_query(filters, owner).add_columns(buyer.name, buyer.email, actor.name)
        query = query.outerjoin(buyer, buyer.id == CommerceTransaction.user_id).outerjoin(actor, actor.id == CommerceTransaction.actor_id)
        query = query.order_by(CommerceTransaction.created_at.desc(), CommerceTransaction.id.desc())
        result = await db.stream(query.execution_options(yield_per=200))
        count = 0
        stream.seek(0); stream.truncate(0)
        async for transaction, buyer_name, buyer_email, actor_name in result:
            row = transaction_view(transaction)
            payment = row.get('payment') or {}
            row.update(buyer_name=buyer_name, buyer_email=buyer_email, actor_name=actor_name,
                paid_amount=payment.get('paidAmount'), from_address=payment.get('fromAddress'),
                created_time=datetime.fromtimestamp(row['created_at'], timezone(timedelta(hours=8))).isoformat())
            writer.writerow([csv_cell(row.get(key)) for key,_ in columns])
            count += 1
            if count % 200 == 0:
                yield stream.getvalue()
                stream.seek(0); stream.truncate(0)
        if stream.tell():
            yield stream.getvalue()
