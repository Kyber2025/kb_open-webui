"""Database-backed reconciliation and Telegram outbox, safe on both app nodes."""
import asyncio
import logging
import time
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
from sqlalchemy import select, or_, and_
from starlette.requests import Request
from open_webui.internal.db import get_async_db
from open_webui.models.commerce import CommerceTransaction, CommerceNotice
from open_webui.models.subscriptions import SubscriptionOrder, SubscriptionTier
from open_webui.models.users import Users
from open_webui.utils.subscription_payments import merchant_request, sync_checkout
from open_webui.utils.reseller_commerce import sync_purchase
from open_webui.utils.commerce_reports import sync_payment_reports, iso_epoch

log = logging.getLogger(__name__)
HK = ZoneInfo('Asia/Shanghai')


def daily_payload(rows, day):
    start = int(datetime.combine(day, datetime.min.time(), HK).timestamp())
    end = start + 86400
    counts = {'subscription': 0, 'reseller': 0}
    amounts = {'subscription': Decimal(0), 'reseller': Decimal(0)}
    codes = manual = pending = 0
    for row in rows:
        if row.source == 'manual' and start <= row.created_at < end:
            manual += row.quantity
        payment = row.payment or {}
        if row.source not in counts or payment.get('status') != 'PAID':
            continue
        paid_at = iso_epoch(payment.get('paidAt'))
        if paid_at is None or not start <= paid_at < end:
            continue
        paid = Decimal(str(payment['paidAmount']))
        if not paid.is_finite() or paid <= 0:
            continue
        counts[row.source] += 1
        amounts[row.source] += paid
        if not row.fulfilled or row.status == 'PAID_REQUIRES_ADMIN':
            pending += 1
        if row.source == 'reseller' and row.fulfilled:
            codes += row.quantity
    if not sum(counts.values()):
        return None
    return dict(kind='daily_sales', day=day.isoformat(), ordinaryCount=counts['subscription'],
        ordinaryAmount=str(amounts['subscription']), resellerCount=counts['reseller'],
        resellerAmount=str(amounts['reseller']), deliveredCodes=codes, manualCodes=manual, pendingCount=pending)


async def queue_notices(now=None, *, include_daily=True):
    now = now or int(time.time())
    local = datetime.fromtimestamp(now, HK)
    yesterday = local.date() - timedelta(days=1)
    start = int(datetime.combine(yesterday, datetime.min.time(), HK).timestamp())
    async with get_async_db() as db:
        # Also serializes first insertion of unique notice keys across app nodes.
        await db.execute(select(SubscriptionTier).where(SubscriptionTier.id == 'free').with_for_update())
        rows = (await db.execute(select(CommerceTransaction).where(
            CommerceTransaction.source.in_(('subscription', 'reseller', 'manual')),
            or_(and_(CommerceTransaction.fulfilled.is_(False), or_(CommerceTransaction.paid_at.is_not(None),
                    CommerceTransaction.status.in_(('PAID', 'PAID_REQUIRES_ADMIN')))),
                and_(CommerceTransaction.paid_at >= start, CommerceTransaction.paid_at < start+86400),
                and_(CommerceTransaction.source == 'manual', CommerceTransaction.created_at >= start,
                    CommerceTransaction.created_at < start+86400))))).scalars().all()
        for row in rows:
            if row.source == 'manual' or row.fulfilled:
                continue
            payment = row.payment or {}
            if payment.get('status') != 'PAID':
                continue
            paid_at = iso_epoch(payment.get('paidAt')) or row.created_at
            if row.status != 'PAID_REQUIRES_ADMIN' and paid_at > now-120:
                continue  # Allow a normal fulfillment attempt before warning.
            key = 'unfulfilled:' + row.id
            if await db.get(CommerceNotice, key) is None:
                db.add(CommerceNotice(id=key, payload={'kind': 'fulfillment_pending', 'orderId': row.id},
                    next_attempt_at=now, created_at=now))
        if include_daily and local.hour >= 9:
            day = yesterday
            key = 'daily:' + day.isoformat()
            if await db.get(CommerceNotice, key) is None:
                payload = daily_payload(rows, day)
                if payload:
                    db.add(CommerceNotice(id=key, payload=payload, next_attempt_at=now, created_at=now))
        await db.commit()


async def dispatch_notices(request):
    for _ in range(50):
        async with get_async_db() as db:
            now = int(time.time())
            row = (await db.execute(select(CommerceNotice).where(CommerceNotice.sent.is_(False),
                CommerceNotice.next_attempt_at <= now).order_by(CommerceNotice.next_attempt_at)
                .limit(1).with_for_update(skip_locked=True))).scalar_one_or_none()
            if row is None:
                return
            row.attempts += 1
            row.next_attempt_at = now + min(1800, 30 * 2 ** min(row.attempts, 6))
            try:
                result = await merchant_request(request, 'POST', 'reports/notice', row.payload)
                if result.get('delivered') is True:
                    row.sent, row.sent_at = True, now
            except Exception:
                # Do not log signed requests, merchant credentials or TG URLs.
                log.warning('Commerce notification delivery deferred: %s', row.id)
            await db.commit()


async def reconcile_once(request):
    now = int(time.time())
    async with get_async_db() as db:
        ordinary = (await db.execute(select(SubscriptionOrder).outerjoin(CommerceTransaction,
            CommerceTransaction.id == SubscriptionOrder.id).where(
            SubscriptionOrder.logical_order_id.like('kvs-%'),
            or_(SubscriptionOrder.activated.is_(False), CommerceTransaction.fulfilled.is_(False)),
            or_(SubscriptionOrder.status.in_(('CREATING', 'PENDING', 'EXPIRED_CHECKING', 'PAID')),
                and_(SubscriptionOrder.status.in_(('EXPIRED', 'FAILED')),
                    or_(SubscriptionOrder.created_at >= now-7*86400, CommerceTransaction.paid_at.is_not(None))),
                # Buyer-cancelled invoices are not polled; the signed payment report flags late money.
                and_(SubscriptionOrder.status == 'CANCELLED', CommerceTransaction.paid_at.is_not(None))))
            .order_by(SubscriptionOrder.updated_at).limit(100))).scalars().all()
        reseller = (await db.execute(select(CommerceTransaction).where(CommerceTransaction.source == 'reseller',
            CommerceTransaction.fulfilled.is_(False), CommerceTransaction.status != 'PAID_REQUIRES_ADMIN',
            or_(CommerceTransaction.status.in_(('CREATING', 'PENDING', 'EXPIRED_CHECKING', 'PAID')),
                # Reseller-cancelled purchases are not polled; the signed payment report flags late money.
                and_(CommerceTransaction.status != 'CANCELLED', CommerceTransaction.created_at >= now-7*86400),
                CommerceTransaction.paid_at.is_not(None)))
            .order_by(CommerceTransaction.updated_at).limit(100))).scalars().all()
    semaphore = asyncio.Semaphore(4)
    async def reconcile(row, agent=False):
        async with semaphore:
            try:
                if agent:
                    await sync_purchase(request, row.user_id, row.id)
                else:
                    user = await Users.get_user_by_id(row.user_id)
                    if user:
                        await sync_checkout(request, user, row.id)
            except Exception:
                log.warning('Commerce order reconciliation deferred: %s', row.id)
    await asyncio.gather(*(reconcile(r) for r in ordinary), *(reconcile(r, True) for r in reseller))


async def commerce_reconcile_loop(app):
    request = Request({'type': 'http', 'app': app, 'headers': []})
    while True:
        try:
            await asyncio.sleep(20)
            await reconcile_once(request)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning('Commerce reconciliation pass deferred')


async def commerce_reporting_loop(app):
    request = Request({'type': 'http', 'app': app, 'headers': []})
    while True:
        synced = False
        try:
            await asyncio.sleep(30)
            # No report is sent from stale data if payment synchronization fails.
            await sync_payment_reports(request)
            synced = True
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning('Commerce report synchronization deferred')
        try:
            await queue_notices(include_daily=synced)
            await dispatch_notices(request)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning('Commerce outbox pass deferred')
