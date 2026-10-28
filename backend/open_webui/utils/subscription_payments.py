"""Signed USDT checkout. Durable intents precede external calls; only verified PAID grants access."""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
from urllib.parse import quote, urlsplit

import aiohttp
from fastapi import HTTPException
from fastapi.responses import PlainTextResponse

log = logging.getLogger(__name__)
OPEN_STATUSES = ('CREATING', 'PENDING', 'EXPIRED_CHECKING', 'PAID', 'PAID_REQUIRES_ADMIN')
PAYMENT_IN_PROGRESS = ('PAID', 'PAID_REQUIRES_ADMIN', 'EXPIRED_CHECKING')
MAX_ORDER_SECONDS = 48 * 3600


def credentials():
    app_id = os.getenv('SUBSCRIPTION_PAYMENT_APP_ID', '')
    secret = os.getenv('SUBSCRIPTION_PAYMENT_SECRET', '')
    if not app_id or not secret:
        raise HTTPException(503, 'USDT 收银暂不可用，请稍后再试')
    return app_id, secret


def signature(secret, *parts):
    return hmac.new(secret.encode(), '\n'.join(parts).encode(), hashlib.sha256).hexdigest()


def verify_signature(secret, kind, timestamp, nonce, body, provided):
    if not timestamp or not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        raise HTTPException(502, '支付响应时间校验失败')
    expected = signature(secret, kind, timestamp, nonce, hashlib.sha256(body).hexdigest())
    if not isinstance(provided, str) or not hmac.compare_digest(expected, provided.lower()):
        raise HTTPException(502, '支付响应签名校验失败')


async def merchant_request(request, method, suffix, payload=None):
    app_id, secret = credentials()
    base = str(request.app.state.config.PAYMENT_SERVICE_URL).rstrip('/')
    url = base + '/payment/v2/' + suffix
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.hostname != 'payment.kividas.com':
        raise HTTPException(503, '支付服务地址配置无效')
    body = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode() if payload is not None else b''
    timestamp, nonce = str(int(time.time())), secrets.token_hex(16)
    headers = {'Content-Type': 'application/json', 'X-App-Id': app_id, 'X-Timestamp': timestamp, 'X-Nonce': nonce,
               'X-Signature': signature(secret, method, parts.path, timestamp, nonce, hashlib.sha256(body).hexdigest())}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=25)) as session:
        async with session.request(method, url, data=body or None, headers=headers, allow_redirects=False) as response:
            raw = await response.read()
            verify_signature(secret, 'RESPONSE', response.headers.get('X-Timestamp', ''), nonce, raw, response.headers.get('X-Signature'))
            result = json.loads(raw)
            if response.status != 200 or result.get('code') != 200 or not isinstance(result.get('data'), dict):
                raise HTTPException(502, '支付服务暂时无法处理订单，请稍后重试')
            return result['data']


def validate_order(order, data):
    if (data.get('orderId') != order.id or data.get('merchantOrderId') != order.logical_order_id
            or str(data.get('chainId')) != order.chain_id or data.get('token') != 'USDT'):
        raise HTTPException(502, '支付订单身份校验失败')
    try:
        if Decimal(str(data.get('amount'))) != Decimal(order.amount):
            raise ValueError('amount')
        if data.get('status') == 'PAID' and (Decimal(str(data.get('paidAmount'))) < Decimal(order.amount)
                or not data.get('txHash') or data.get('finalStatus') is not True):
            raise ValueError('payment')
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(502, '支付金额或到账状态校验失败')
    if data.get('status') not in ('PENDING', 'PAID', 'EXPIRED', 'FAILED'):
        raise HTTPException(502, '未知支付状态')
    address = data.get('address')
    if not isinstance(address, str) or not address or len(address) > 200:
        raise HTTPException(502, '无效收款地址')
    try:
        expires = int(datetime.fromisoformat(data['expiresAt'].replace('Z', '+00:00')).timestamp())
    except (ValueError, KeyError, TypeError):
        raise HTTPException(502, '无效订单到期时间')
    if expires > order.created_at + MAX_ORDER_SECONDS - 3600:
        raise HTTPException(502, '订单付款期限无效')
    return expires


async def plans_with_capacity(request, user):
    from open_webui.models.subscriptions import SubscriptionTiers
    from open_webui.models.kyber_accounts import UserKyberAccounts
    from open_webui.utils.claude_allocation import resource_call
    tiers = await SubscriptionTiers.list_tiers(enabled_only=True)
    capacity = {}
    linked = False
    try:
        credentials()
        link = await UserKyberAccounts.get_by_user_id(user.id)
        linked = bool(link and link.kyber_user_id)
        # Unlinked local administrators can see stock, but cannot buy.
        capacity = await resource_call(request, 'capacity', {
            'userId': link.kyber_user_id if linked else 'unlinked-web:' + user.id})
    except Exception:
        log.warning('Subscription checkout capacity unavailable')
    return [{**tier.model_dump(), 'remaining': capacity.get(tier.id, {}).get('remaining'),
             'can_purchase': linked and bool(capacity.get(tier.id, {}).get('can_purchase')),
             'merchant_name': 'Kividas 订阅'} for tier in tiers]


async def create_checkout(request, user, tier_id, chain_id):
    from sqlalchemy import select
    from open_webui.internal.db import get_async_db
    from open_webui.models.users import User
    from open_webui.models.subscriptions import SubscriptionOrder, SubscriptionTier
    from open_webui.models.kyber_accounts import UserKyberAccounts
    from open_webui.utils.claude_allocation import resource_call
    credentials()
    chains = {str(c['id']) for c in request.app.state.config.SUBSCRIPTION_CHAINS or []}
    if chain_id not in chains:
        raise HTTPException(400, '请选择支持的 USDT 网络')
    async with get_async_db() as db:
        await db.execute(select(User).where(User.id == user.id).with_for_update())
        tier = await db.get(SubscriptionTier, tier_id)
        if tier_id not in ('pro', 'ultra') or not tier or not tier.enabled or tier.price_usd <= 0:
            raise HTTPException(404, '此订阅档位已停用')
        now = int(time.time())
        current_amount = Decimal(str(tier.price_usd))
        orders = (await db.execute(select(SubscriptionOrder).where(SubscriptionOrder.user_id == user.id,
            SubscriptionOrder.tier_id == tier_id,
            SubscriptionOrder.status.in_(OPEN_STATUSES), SubscriptionOrder.activated == False)
            .order_by(SubscriptionOrder.created_at.desc()))).scalars().all()
        # Preserve payments being settled, even if the user selected another network.
        # Unpaid orders remain queryable, but old prices/expired intents never set a new quote.
        existing = next((order for order in orders if order.status in PAYMENT_IN_PROGRESS), None)
        if existing is None:
            existing = next((order for order in orders
                if order.chain_id == chain_id and order.status in ('CREATING', 'PENDING')
                and order.expires_at > now and Decimal(order.amount) == current_amount), None)
        if existing:
            order_id = existing.id
        else:
            logical = 'kvs-' + uuid.uuid4().hex
            order_id = logical + '_' + chain_id
            link = await UserKyberAccounts.get_by_user_id(user.id)
            if not link or not link.kyber_user_id:
                raise HTTPException(409, '用户尚未关联平台账号，请联系管理员处理')
            capacity = await resource_call(request, 'capacity', {'userId': link.kyber_user_id})
            if not capacity.get(tier_id, {}).get('can_purchase'):
                raise HTTPException(409, '当前套餐暂无可购买名额')
            db.add(SubscriptionOrder(id=order_id, logical_order_id=logical, user_id=user.id, tier_id=tier_id,
                chain_id=chain_id, amount=format(current_amount, 'f'), address=None,
                status='CREATING', activated=False, expires_at=now + 86400, created_at=now, updated_at=now))
            await db.commit()
    # A crash or timeout leaves the same durable intent for idempotent recovery.
    return await sync_checkout(request, user, order_id)


async def sync_checkout(request, user, order_id):
    from sqlalchemy import select
    from open_webui.internal.db import get_async_db
    from open_webui.models.subscriptions import SubscriptionOrder, SubscriptionTiers, SubscriptionOrders
    from open_webui.utils.claude_allocation import change_subscription, cancel_reservation, propagate
    from open_webui.utils.subscription import get_subscription_state, sync_user_rate_limits_to_kyber
    data = {}
    async with get_async_db() as db:
        order = (await db.execute(select(SubscriptionOrder).where(SubscriptionOrder.id == order_id).with_for_update())).scalar_one_or_none()
        if not order or order.user_id != user.id or not order.logical_order_id.startswith('kvs-'):
            raise HTTPException(404, 'Order not found')
        if not order.activated and order.status in OPEN_STATUSES and order.status != 'PAID_REQUIRES_ADMIN':
            if order.status == 'CREATING':
                data = await merchant_request(request, 'POST', 'create', {'orderId': order.logical_order_id,
                    'chainId': order.chain_id, 'amount': order.amount,
                    'notifyUrl': 'https://chat.kividas.com/api/v1/subscriptions/payment/notify'})
            else:
                data = await merchant_request(request, 'GET', 'status/' + quote(order.id, safe=''))
            expires = validate_order(order, data)
            order.address, order.expires_at = data['address'], expires
            order.status = 'EXPIRED_CHECKING' if data['status'] == 'EXPIRED' and data.get('finalStatus') is not True else data['status']
            order.tx_hash = data.get('txHash')
            order.updated_at = int(time.time())
            await db.commit()
    order = await SubscriptionOrders.get(order_id)
    fulfilled = order.activated
    if order.status in ('PAID', 'PAID_REQUIRES_ADMIN'):
        fulfilled = False
        tier = await SubscriptionTiers.get_tier(order.tier_id)
        if not tier:
            raise HTTPException(409, '付款已确认，订阅开通待处理，请联系管理员')
        try:
            if not order.activated:
                # Only confirmed money may reserve a seat. A sold-out race keeps
                # the verified payment for administrator handling without granting access.
                await change_subscription(request, user.id, order.tier_id, duration_days=tier.duration_days,
                    operation_id=order.logical_order_id, order_id=order.id)
            await propagate(request, order.logical_order_id)
            if not await sync_user_rate_limits_to_kyber(request, user.id):
                raise HTTPException(503, '付款已确认，订阅正在同步，请稍后刷新')
            fulfilled = True
            if order.status == 'PAID_REQUIRES_ADMIN':
                await SubscriptionOrders.update_status(order.id, 'PAID')
        except HTTPException as exc:
            if exc.status_code not in (409, 503):
                raise
            if exc.status_code == 409:
                await SubscriptionOrders.update_status(order.id, 'PAID_REQUIRES_ADMIN')
            log.warning('Paid subscription requires %s: %s', 'administrator' if exc.status_code == 409 else 'sync retry', order.id)
        order = await SubscriptionOrders.get(order_id)
    elif order.status in ('EXPIRED', 'FAILED'):
        await cancel_reservation(request, user.id, order.logical_order_id)
    tier = await SubscriptionTiers.get_tier(order.tier_id)
    qr = data.get('qrCodeImage')
    if not isinstance(qr, str) or not qr.startswith('data:image/png;base64,') or len(qr) > 300000:
        qr = None
    return {'order_id': order.id, 'tier_id': order.tier_id, 'tier_name': tier.name if tier else '',
        'merchant_name': 'Kividas 订阅', 'chain_id': order.chain_id, 'amount': order.amount,
        'address': order.address, 'qr_code_image': qr, 'status': order.status,
        'expires_at': order.expires_at, 'activated': order.activated and fulfilled, 'tx_hash': order.tx_hash,
        'subscription_state': await get_subscription_state(user.id, is_admin=user.role == 'admin')}


async def latest_checkout(request, user, tier_id=None):
    from open_webui.models.subscriptions import SubscriptionOrders
    orders = await SubscriptionOrders.list_for_user(user.id)
    candidates = [o for o in orders if o.logical_order_id.startswith('kvs-') and not o.activated and o.status in OPEN_STATUSES
                  and (tier_id is None or o.tier_id == tier_id)]
    order = next((o for o in candidates if o.status in PAYMENT_IN_PROGRESS), candidates[0] if candidates else None)
    return await sync_checkout(request, user, order.id) if order else None


async def payment_notify(request):
    app_id, secret = credentials()
    raw = await request.body()
    if len(raw) > 50000 or request.headers.get('X-App-Id') != app_id:
        raise HTTPException(401, 'Invalid payment notification')
    try:
        verify_signature(secret, 'NOTIFY', request.headers.get('X-Timestamp', ''), request.headers.get('X-Nonce', ''), raw, request.headers.get('X-Signature'))
        payload = json.loads(raw)
    except Exception:
        raise HTTPException(401, 'Invalid payment notification')
    if not isinstance(payload, dict) or not isinstance(payload.get('data'), (dict, type(None))):
        raise HTTPException(401, 'Invalid payment notification')
    if payload.get('event') == 'PING':
        return PlainTextResponse('success')
    from open_webui.models.subscriptions import SubscriptionOrders
    from open_webui.models.users import Users
    order = await SubscriptionOrders.get((payload.get('data') or {}).get('orderId', ''))
    if not order or not order.logical_order_id.startswith('kvs-'):
        raise HTTPException(404, 'Order not found')
    user = await Users.get_user_by_id(order.user_id)
    if not user:
        raise HTTPException(404, 'User not found')
    # Fetch a fresh signed response; callback replay cannot manufacture paid status.
    if order.status != 'PAID_REQUIRES_ADMIN':
        await sync_checkout(request, user, order.id)
    return PlainTextResponse('success')


async def payment_reconcile_loop(app):
    from sqlalchemy import select
    from starlette.requests import Request
    from open_webui.internal.db import get_async_db
    from open_webui.models.subscriptions import SubscriptionOrder
    from open_webui.models.users import Users
    request = Request({'type': 'http', 'app': app, 'headers': []})
    while True:
        try:
            await asyncio.sleep(20)
            async with get_async_db() as db:
                rows = (await db.execute(select(SubscriptionOrder).where(SubscriptionOrder.logical_order_id.like('kvs-%'),
                    SubscriptionOrder.status.in_(tuple(s for s in OPEN_STATUSES if s != 'PAID_REQUIRES_ADMIN')), SubscriptionOrder.activated == False)
                    .order_by(SubscriptionOrder.updated_at).limit(50))).scalars().all()
            for order in rows:
                try:
                    user = await Users.get_user_by_id(order.user_id)
                    if user:
                        await sync_checkout(request, user, order.id)
                except Exception:
                    log.exception('Subscription payment reconciliation failed for %s', order.id)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('Subscription payment reconciliation pass failed')
