from open_webui.utils.subscription_models import sync_subscription_model_policy
from open_webui.utils.claude_allocation import change_subscription, cancel_reservation
import logging
import time
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel

from open_webui.models.kyber_accounts import UserKyberAccounts
from open_webui.models.subscriptions import (
    GiftCards,
    SubscriptionOrders,
    SubscriptionTierForm,
    SubscriptionTiers,
    UserSubscriptions,
)
from open_webui.models.users import Users
from open_webui.utils.auth import get_admin_user, get_verified_user
from open_webui.utils.kyber import (
    KyberError,
    kyber_get_users_usage_limits,
    kyber_reset_user_usage,
)
from open_webui.utils.subscription import (
    DEFAULT_TIER_ID,
    create_subscription_order,
    generate_gift_cards,
    get_subscription_state,
    invalidate_gift_card,
    normalize_gift_code,
    redeem_gift_card,
    seed_default_tiers,
    sync_all_user_rate_limits_to_kyber,
    sync_order,
    sync_user_rate_limits_to_kyber,
)

log = logging.getLogger(__name__)

router = APIRouter()


class SubscribeForm(BaseModel):
    tier_id: str
    chain_id: str


class RedeemForm(BaseModel):
    code: str


class ExtraUsageForm(BaseModel):
    enabled: bool


class GiftCardGenerateForm(BaseModel):
    tier_id: str
    count: int = 1
    duration_days: Optional[int] = None
    note: Optional[str] = None


class GiftCardStatusForm(BaseModel):
    enabled: bool


class AdminUserIdsForm(BaseModel):
    user_ids: list[str]


class AdminSubscriptionForm(BaseModel):
    tier_id: str
    # Exact expiry, epoch seconds. Omitted → now + `duration_days` (or the tier's own
    # duration), which is what "grant this plan" means from the admin panel.
    expires_at: Optional[int] = None
    duration_days: Optional[int] = None


class UsageResetForm(BaseModel):
    # '5h' | 'week'; both windows when omitted.
    windows: Optional[list[str]] = None


############################
# User-facing endpoints
############################


@router.get('/tiers')
async def get_tiers(user=Depends(get_verified_user)):
    """Enabled tiers for the subscription page."""
    return await SubscriptionTiers.list_tiers(enabled_only=True)


@router.get('/chains')
async def get_chains(request: Request, user=Depends(get_verified_user)):
    return request.app.state.config.SUBSCRIPTION_CHAINS or []


@router.get('/me')
async def get_me(user=Depends(get_verified_user)):
    """Current effective tier + today's usage + active subscription."""
    return await get_subscription_state(user.id, is_admin=(user.role == 'admin'))


@router.post('/extra-usage')
async def set_extra_usage(request: Request, form_data: ExtraUsageForm, user=Depends(get_verified_user)):
    """Flip the user's paid-overflow opt-in, then re-sync to KyberRouter (one PUT
    carries the toggle + the tier multiplier + caps + managed flag). Returns the
    new state. 400 when the account has no KyberRouter wallet link yet."""
    ok = await UserKyberAccounts.set_extra_usage_enabled(user.id, form_data.enabled)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Your account is not linked to a wallet yet.',
        )
    await sync_user_rate_limits_to_kyber(request, user.id)
    return {'enabled': form_data.enabled}


@router.post('/subscribe')
async def subscribe(request: Request, form_data: SubscribeForm, user=Depends(get_verified_user)):
    """Create a USDT payment order for a tier; returns the checkout payload (address + QR)."""
    if not getattr(request.app.state.config, 'ENABLE_SUBSCRIPTIONS', True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Subscriptions are disabled')
    return await create_subscription_order(request, user, form_data.tier_id, form_data.chain_id)


@router.get('/order/{order_id}')
async def get_order(request: Request, order_id: str, user=Depends(get_verified_user)):
    """Poll order status; activates the subscription on first PAID."""
    return await sync_order(request, user, order_id)


@router.get('/orders')
async def list_my_orders(user=Depends(get_verified_user)):
    return await SubscriptionOrders.list_for_user(user.id)


@router.delete('/order/{order_id}')
async def cancel_order(request: Request, order_id: str, user=Depends(get_verified_user)):
    order = await SubscriptionOrders.get(order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(404, 'Order not found')
    if order.activated or order.status == 'PAID':
        raise HTTPException(409, '该订单已支付，不能取消')
    if order.status != 'CANCELLED':
        from open_webui.utils.subscription import _payment_status, _is_payment_error
        try:
            payment = await _payment_status(request, order_id)
        except Exception:
            raise HTTPException(503, '无法确认付款状态，请稍后再试')
        if _is_payment_error(payment) or payment.get('status') not in ('PENDING', 'EXPIRED', 'FAILED'):
            raise HTTPException(409, '付款状态不允许取消，请刷新订单状态')
        from open_webui.internal.db import get_async_db
        from open_webui.models.subscriptions import SubscriptionOrder
        from sqlalchemy import update
        async with get_async_db() as db:
            changed = await db.execute(update(SubscriptionOrder).where(
                SubscriptionOrder.id == order_id, SubscriptionOrder.activated == False,
                SubscriptionOrder.status.in_(['PENDING', 'EXPIRED', 'FAILED']))
                .values(status='CANCELLED', updated_at=int(time.time())))
            await db.commit()
            if changed.rowcount != 1:
                raise HTTPException(409, '订单状态已变化，请刷新')
    await cancel_reservation(request, user.id, order.logical_order_id)
    return {'cancelled': True}


@router.post('/redeem')
async def redeem(request: Request, form_data: RedeemForm, user=Depends(get_verified_user)):
    """Redeem a gift card / redemption code and activate the granted plan."""
    return await redeem_gift_card(request, user, form_data.code)


############################
# Admin endpoints
############################


@router.get('/admin/tiers')
async def admin_list_tiers(user=Depends(get_admin_user)):
    return await SubscriptionTiers.list_tiers(enabled_only=False)


@router.get('/admin/models')
async def admin_model_catalog(request: Request, user=Depends(get_admin_user)):
    """Configuration catalog; never use the administrator's personal plan filter."""
    import aiohttp
    from open_webui.utils.kyber import kyber_base

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
            # The gateway publishes a public catalog without credentials. This
            # authenticated admin endpoint exposes metadata only, no inference.
            async with session.get(f'{kyber_base(request)}/v1/models') as response:
                if response.status != 200:
                    raise ValueError('Catalog unavailable')
                data = await response.json()
                return [{'id': m['id'], 'name': m.get('name', m['id'])}
                        for m in data.get('data', []) if isinstance(m, dict) and m.get('id')]
    except Exception:
        raise HTTPException(status_code=503, detail='完整模型目录暂时不可用，请稍后重试。')


@router.post('/admin/tiers')
async def admin_upsert_tier(
    request: Request,
    form_data: SubscriptionTierForm,
    background_tasks: BackgroundTasks,
    user=Depends(get_admin_user),
):
    """Create/update a tier. When the token caps or the extra-usage multiplier of an
    EXISTING tier change, every user currently on that tier is re-synced to
    KyberRouter in the background, so the limiter and the usage ring pick up the new
    caps immediately. Model policies are always acknowledged by the gateway
    before reporting success, independently of per-user token-cap sync."""
    tier_id = (form_data.id or '').strip().lower()
    if not tier_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Tier id is required')
    form_data.id = tier_id
    previous = await SubscriptionTiers.get_tier(tier_id)
    tier = await SubscriptionTiers.upsert_tier(form_data)
    if tier is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='Failed to save tier')
    if not await sync_subscription_model_policy(request):
        raise HTTPException(status_code=503, detail='订阅设置已保存，但模型权限尚未同步到网关；请重试保存。后台会继续重试同步。')
    if previous is not None and (
        previous.token_limit_5h != tier.token_limit_5h
        or previous.token_limit_week != tier.token_limit_week
        or previous.extra_usage_multiplier != tier.extra_usage_multiplier
    ):
        background_tasks.add_task(sync_all_user_rate_limits_to_kyber, request, tier_id)
    return tier


@router.post('/admin/resync-rate-limits')
async def admin_resync_rate_limits(
    request: Request, tier_id: Optional[str] = None, user=Depends(get_admin_user)
):
    """Re-push every linked user's effective tier caps to KyberRouter (optionally only
    users on `tier_id`) and report counts. Use after editing tiers by hand / SQL, or
    after a KyberRouter internal-secret outage left users on stale caps."""
    tier_id = (tier_id or '').strip().lower() or None
    if tier_id is not None and await SubscriptionTiers.get_tier(tier_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Subscription plan not found')
    return await sync_all_user_rate_limits_to_kyber(request, tier_id)


@router.delete('/admin/tiers/{tier_id}')
async def admin_delete_tier(tier_id: str, request: Request, user=Depends(get_admin_user)):
    if tier_id == DEFAULT_TIER_ID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='The default free tier cannot be deleted')
    import time
    if not await sync_subscription_model_policy(request, {'id': tier_id, 'name': tier_id, 'enabled': False, 'allowedModelIds': [], 'updatedAt': int(time.time())}):
        raise HTTPException(status_code=503, detail='模型权限同步失败，请重试删除。')
    ok = await SubscriptionTiers.delete_tier(tier_id)
    return {'success': ok}


@router.post('/admin/seed')
async def admin_seed_tiers(user=Depends(get_admin_user)):
    """Seed the default tiers (no-op if any tier already exists)."""
    await seed_default_tiers()
    return await SubscriptionTiers.list_tiers(enabled_only=False)


@router.get('/admin/subscriptions')
async def admin_list_subscriptions(user=Depends(get_admin_user)):
    return await UserSubscriptions.list_all()


############################
# Admin — per-user plan & usage
############################


async def _admin_user_snapshot(request: Request, user_ids: list[str]) -> dict[str, dict]:
    """{user_id: {tier, subscription, expires_at, kyber_linked, usage}} for a page of
    users, in a fixed number of round trips (3 queries + 1 KyberRouter call) — the
    admin list must not fan out per row.

    `tier` is the EFFECTIVE tier and mirrors get_user_tier's fallback exactly: a
    subscription whose tier was deleted or disabled counts for nothing, so the user
    shows as Free. `usage` is the live 5h/weekly token window from KyberRouter, or
    None when the user has no wallet link (or KyberRouter did not answer)."""
    ids = list(dict.fromkeys([u for u in user_ids if u]))
    if not ids:
        return {}

    subs = await UserSubscriptions.list_active_for_users(ids)
    tiers = {t.id: t for t in await SubscriptionTiers.list_tiers(enabled_only=False)}
    kyber_ids = await UserKyberAccounts.kyber_ids_for_users(ids)
    usage_by_kyber = await kyber_get_users_usage_limits(request, list(kyber_ids.values()))

    out: dict[str, dict] = {}
    for uid in ids:
        sub = subs.get(uid)
        tier = None
        if sub is not None:
            candidate = tiers.get(sub.tier_id)
            if candidate is not None and candidate.enabled:
                tier = candidate
            else:
                sub = None  # same as get_user_tier: unusable tier → default, no sub
        if tier is None:
            tier = tiers.get(DEFAULT_TIER_ID)

        kyber_id = kyber_ids.get(uid)
        out[uid] = {
            'tier': tier.model_dump() if tier else None,
            'subscription': sub.model_dump() if sub else None,
            'expires_at': sub.expires_at if sub else None,
            'kyber_linked': bool(kyber_id),
            'usage': usage_by_kyber.get(kyber_id) if kyber_id else None,
        }
    return out


def _sync_result(request: Request, snapshot: dict, synced: bool) -> dict:
    """Attach the outcome of the KyberRouter cap sync to an admin response. The sync is
    best-effort by design (it must never fail a payment), which is exactly why the
    admin panel has to SHOW when it did not happen — a tier the limiter never heard
    about is the one bug this whole feature exists to catch."""
    return {
        **snapshot,
        'rate_limits_synced': synced,
        'token_billing_enabled': bool(
            getattr(request.app.state.config, 'ENABLE_KYBER_TOKEN_BILLING', False)
        ),
    }


@router.post('/admin/users/overview')
async def admin_users_overview(
    request: Request, form_data: AdminUserIdsForm, user=Depends(get_admin_user)
):
    """Plan, expiry and live 5h/weekly token usage for the given users (one admin page
    at a time). Users without a KyberRouter link come back with `usage: null`."""
    if len(form_data.user_ids) > 500:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail='Too many users in one request'
        )
    return {'users': await _admin_user_snapshot(request, form_data.user_ids)}


@router.post('/admin/users/{user_id}/subscription')
async def admin_set_user_subscription(
    request: Request, user_id: str, form_data: AdminSubscriptionForm, user=Depends(get_admin_user)
):
    """Put a user on a plan until a chosen instant, then push the tier's caps to
    KyberRouter. Unlike a payment or a gift card this SETS the expiry (it can shorten
    it); selecting the default free plan revokes the subscription instead, since Free
    is the absence of one."""
    target = await Users.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    tier_id = (form_data.tier_id or '').strip().lower()
    tier = await SubscriptionTiers.get_tier(tier_id)
    if tier is None or not tier.enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Subscription plan not found')

    if tier_id == DEFAULT_TIER_ID:
        await change_subscription(request, user_id, 'free')
    else:
        now = int(time.time())
        expires_at = form_data.expires_at
        if expires_at is None:
            days = form_data.duration_days or tier.duration_days or 30
            if days <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail='Duration must be at least one day'
                )
            expires_at = now + int(days) * 86400
        if int(expires_at) <= now:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Expiry must be in the future — switch the user to the free plan to end it now',
            )
        await change_subscription(request, user_id, tier_id, expires_at=int(expires_at))

    synced = await sync_user_rate_limits_to_kyber(request, user_id)
    log.info(
        'admin %s set subscription of %s to %s (synced=%s)', user.id, user_id, tier_id, synced
    )
    snapshot = await _admin_user_snapshot(request, [user_id])
    return _sync_result(request, snapshot.get(user_id, {}), synced)


@router.delete('/admin/users/{user_id}/subscription')
async def admin_revoke_user_subscription(
    request: Request, user_id: str, user=Depends(get_admin_user)
):
    """Cancel the user's active subscription (back to the default free tier) and
    re-sync the free caps to KyberRouter."""
    target = await Users.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    await change_subscription(request, user_id, 'free')
    revoked = 1
    synced = await sync_user_rate_limits_to_kyber(request, user_id)
    log.info('admin %s revoked %s subscription(s) of %s (synced=%s)', user.id, revoked, user_id, synced)
    snapshot = await _admin_user_snapshot(request, [user_id])
    return {**_sync_result(request, snapshot.get(user_id, {}), synced), 'revoked': revoked}


@router.post('/admin/users/{user_id}/usage/reset')
async def admin_reset_user_usage(
    request: Request, user_id: str, form_data: UsageResetForm, user=Depends(get_admin_user)
):
    """Clear a user's rolling 5h and/or weekly token window on KyberRouter (both when
    `windows` is omitted), so they can send again immediately. Their usage history and
    wallet are untouched — this only zeroes the rate-limit counters. Fails loudly:
    unlike the tier sync, an admin must never be told a reset worked when it didn't."""
    target = await Users.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    link = await UserKyberAccounts.get_by_user_id(user_id)
    if not link or not link.kyber_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='This user is not linked to a wallet yet.',
        )

    windows = [w for w in (form_data.windows or []) if w in ('5h', 'week')]
    try:
        result = await kyber_reset_user_usage(request, link.kyber_user_id, windows or None)
    except KyberError as e:
        raise HTTPException(status_code=e.status or 502, detail=e.message)

    log.info('admin %s reset %s window(s) of %s', user.id, windows or 'all', user_id)
    snapshot = await _admin_user_snapshot(request, [user_id])
    return {**snapshot.get(user_id, {}), 'reset': result.get('windows', windows or ['5h', 'week'])}


############################
# Admin — gift cards
############################


@router.post('/admin/gift-cards')
async def admin_generate_gift_cards(form_data: GiftCardGenerateForm, user=Depends(get_admin_user)):
    """Generate a batch of single-use gift cards for a tier. Returns the new codes."""
    return await generate_gift_cards(
        user, form_data.tier_id, form_data.count, form_data.duration_days, form_data.note
    )


@router.get('/admin/gift-cards')
async def admin_list_gift_cards(
    status_filter: Optional[str] = None,
    batch_id: Optional[str] = None,
    search: Optional[str] = None,
    user=Depends(get_admin_user),
):
    """List gift cards (most recent first, capped) plus summary counts.
    `status_filter` ∈ all | available | redeemed | disabled. `search` matches the code
    (case-insensitive, dash-optional) so an admin can find any code beyond the 500 cap."""
    search_term = None
    if search and search.strip():
        raw = search.strip().upper()
        # If typed without dashes, regroup into the stored 'XXXX-XXXX-…' form so a
        # `contains` prefix still hits (normalize_gift_code uppercases + strips + groups).
        search_term = raw if '-' in raw else (normalize_gift_code(raw) or raw)
    cards = await GiftCards.list_cards(status=status_filter, batch_id=batch_id, search=search_term)
    counts = await GiftCards.counts()
    return {'cards': cards, 'counts': counts}


@router.post('/admin/gift-cards/{code}/status')
async def admin_set_gift_card_status(
    code: str, form_data: GiftCardStatusForm, user=Depends(get_admin_user)
):
    ok = await GiftCards.set_enabled(code, form_data.enabled)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Gift card not found')
    return {'success': True, 'enabled': form_data.enabled}


@router.post('/admin/gift-cards/{code}/invalidate')
async def admin_invalidate_gift_card(request: Request, code: str, user=Depends(get_admin_user)):
    """Refund a REDEEMED gift card: void the code AND revoke the subscription it
    granted (the redeemer reverts to Free). For unredeemed codes, use the status
    (enable/disable) endpoint instead."""
    return await invalidate_gift_card(request, code)


@router.delete('/admin/gift-cards/{code}')
async def admin_delete_gift_card(code: str, user=Depends(get_admin_user)):
    ok = await GiftCards.delete(code)
    return {'success': ok}
