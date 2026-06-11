"""Subscription business logic: tier resolution, enforcement, payment_service client,
activation and default-tier seeding. See SUBSCRIPTION.md."""

import logging
import secrets
import time
import uuid
from typing import Optional

import aiohttp
from fastapi import HTTPException, Request, status

from open_webui.models.subscriptions import (
    GiftCardModel,
    GiftCards,
    SubscriptionOrders,
    SubscriptionTierForm,
    SubscriptionTierModel,
    SubscriptionTiers,
    SubscriptionUsage,
    UserSubscriptionModel,
    UserSubscriptions,
)

log = logging.getLogger(__name__)

DEFAULT_TIER_ID = 'free'
ORDER_TTL_SECONDS = 24 * 60 * 60  # payment_service orders expire after 24h


def utc_date() -> str:
    return time.strftime('%Y-%m-%d', time.gmtime())


def _fmt_amount(value: float) -> str:
    s = f'{value:.6f}'.rstrip('0').rstrip('.')
    return s or '0'


####################
# Tier resolution
####################


async def get_user_tier(user_id: str) -> tuple[Optional[SubscriptionTierModel], Optional[UserSubscriptionModel]]:
    """Resolve a user's effective tier. Returns (tier, active_subscription).
    Falls back to the default 'free' tier when there's no active paid subscription."""
    sub = await UserSubscriptions.get_active_for_user(user_id)
    if sub:
        tier = await SubscriptionTiers.get_tier(sub.tier_id)
        if tier and tier.enabled:
            return tier, sub
    tier = await SubscriptionTiers.get_tier(DEFAULT_TIER_ID)
    return tier, None


async def sync_user_rate_limits_to_kyber(request: Request, user_id: str) -> None:
    """P4 (Mode B): push the user's effective tier's 5h/week token caps to KyberRouter
    as a per-user override AND mark the account subscription-managed, so KyberRouter
    limits the user by these token rate caps instead of their wallet balance.
    get_user_tier already falls back to the Free tier, so free users get Free's
    configured caps. The override is ALWAYS non-null when the user has a tier — even
    unlimited tiers (caps None) send {tp5h: 0, tpw: 0} (0 = unlimited per KyberRouter
    convention) so the managed flag and a concrete cap are always set. The non-tier
    token windows (tph/tp4h/tpd) are pinned to 0 so a managed user is bound only by the
    per-tier 5h/weekly caps, never by KyberRouter's global hourly/4h/daily defaults.
    Admins are subscription-managed but get a fully-unlimited override (all caps 0) so a
    bridge-provisioned admin isn't accidentally token-rate-capped by the Free tier. No-op
    when token billing is off; best-effort (never raises into the subscription/login flow)."""
    try:
        if not getattr(request.app.state.config, 'ENABLE_KYBER_TOKEN_BILLING', False):
            return
        tier, _ = await get_user_tier(user_id)
        from open_webui.utils.kyber import kyber_set_user_rate_limits

        if tier is None:
            # No tier configured/seeded yet → clear any override, leave management off.
            await kyber_set_user_rate_limits(request, user_id, None)
            return

        # Admins are subscription-managed (skip the wallet 402) but never token-rate-capped:
        # a bridge-provisioned admin would otherwise inherit the Free tier's caps.
        from open_webui.models.users import Users

        user = await Users.get_user_by_id(user_id)
        is_admin = getattr(user, 'role', None) == 'admin'

        # Always send a NON-NULL override + subscription_managed=True. 0 = unlimited.
        # Pin the non-tier token windows (tph/tp4h/tpd) to 0 so a managed user is bound
        # ONLY by the per-tier 5h/weekly caps, never by a global hourly/4h/daily default
        # (KyberRouter merges any window absent from the override over its GLOBAL defaults).
        # Don't send rpm (KyberRouter requires rpm>=1) — let it inherit the global.
        if is_admin:
            override = {'tp5h': 0, 'tpw': 0, 'tph': 0, 'tp4h': 0, 'tpd': 0}
        else:
            override = {
                'tp5h': int(tier.token_limit_5h or 0),
                'tpw': int(tier.token_limit_week or 0),
                'tph': 0,
                'tp4h': 0,
                'tpd': 0,
            }
        # Extra-usage (paid overflow): the per-tier multiplier + the user's opt-in
        # (stored on the kyber link). Synced alongside the caps so KyberRouter can
        # bill the wallet at `model price * multiplier` when the user overflows.
        from open_webui.models.kyber_accounts import UserKyberAccounts

        link = await UserKyberAccounts.get_by_user_id(user_id)
        extra_enabled = bool(getattr(link, 'extra_usage_enabled', False)) if link else False
        multiplier = float(getattr(tier, 'extra_usage_multiplier', 1.0) or 1.0)
        await kyber_set_user_rate_limits(
            request, user_id, override, subscription_managed=True,
            extra_usage_enabled=extra_enabled, extra_usage_multiplier=multiplier,
        )
    except Exception:
        log.exception('Failed to sync rate limits to KyberRouter for %s', user_id)


async def get_subscription_state(user_id: str, is_admin: bool = False) -> dict:
    """State for the /me endpoint: effective tier, today's usage, remaining, expiry."""
    tier, sub = await get_user_tier(user_id)
    limit = None if (is_admin or tier is None) else tier.daily_message_limit
    used = 0
    if limit is not None:
        used = await SubscriptionUsage.get_count(user_id, utc_date())
    # Extra-usage (paid overflow) state for the Settings toggle: the per-user opt-in
    # (kyber link) + the per-tier multiplier (what each extra token costs vs base).
    from open_webui.models.kyber_accounts import UserKyberAccounts

    link = await UserKyberAccounts.get_by_user_id(user_id)
    extra_usage_enabled = bool(getattr(link, 'extra_usage_enabled', False)) if link else False
    extra_usage_multiplier = float(getattr(tier, 'extra_usage_multiplier', 1.0) or 1.0) if tier else 1.0
    return {
        'tier': tier.model_dump() if tier else None,
        'subscription': sub.model_dump() if sub else None,
        'expires_at': sub.expires_at if sub else None,
        'usage': {
            'date': utc_date(),
            'used': used,
            'limit': limit,
            'remaining': (None if limit is None else max(0, limit - used)),
        },
        'extra_usage_enabled': extra_usage_enabled,
        'extra_usage_multiplier': extra_usage_multiplier,
        'is_admin': is_admin,
    }


####################
# Enforcement (called from main.py chat_completion)
####################


async def enforce_subscription_access(request: Request, user, model_id: str) -> None:
    """Raise HTTP 403 (model not in tier) or 429 (daily quota reached) for a
    non-admin user's managed chat completion. Increments the daily counter when a
    finite limit applies. Admins and disabled subscriptions are no-ops."""
    if not getattr(request.app.state.config, 'ENABLE_SUBSCRIPTIONS', True):
        return
    # Guests are gated separately (per-IP/device, not per-user) by
    # enforce_guest_access — don't apply the shared guest account's tier here.
    from open_webui.utils.guest import is_guest_user

    if is_guest_user(user):
        return
    if getattr(user, 'role', None) == 'admin':
        return

    tier, _ = await get_user_tier(user.id)
    if tier is None:
        # Subscriptions enabled but no tiers configured/seeded yet → don't block.
        return

    # 1) Model allow-list (empty / None = all models allowed). Applies in BOTH
    # billing modes: KyberRouter defines the platform model pool (first filter);
    # the tier's checked models are the second filter — what this plan may use.
    allowed = tier.allowed_model_ids
    if allowed and model_id not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"The model '{model_id}' isn't included in your {tier.name} plan. Upgrade to use it.",
        )

    # P2: when KyberRouter token billing is on, metering/limits/402 happen natively
    # in KyberRouter against the user's wallet — skip ONLY the per-message-count gate.
    if getattr(request.app.state.config, 'ENABLE_KYBER_TOKEN_BILLING', False):
        return

    # 2) Daily message quota
    limit = tier.daily_message_limit
    if limit is not None:
        date = utc_date()
        used = await SubscriptionUsage.get_count(user.id, date)
        if used >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"You've reached your daily limit of {limit} messages on the {tier.name} plan. "
                    'Upgrade your subscription for more.'
                ),
            )
        await SubscriptionUsage.increment(user.id, date)


def filter_models_by_tier(models: list, tier: Optional[SubscriptionTierModel]) -> list:
    """Drop models not permitted by the tier (used to shape the visible model list).
    Each item is a model dict with an 'id'. Empty/None allow-list = no filtering."""
    if tier is None:
        return models
    allowed = tier.allowed_model_ids
    if not allowed:
        return models
    allowed_set = set(allowed)
    return [m for m in models if (m.get('id') if isinstance(m, dict) else getattr(m, 'id', None)) in allowed_set]


####################
# payment_service client
####################


def _payment_base(request: Request) -> str:
    return str(request.app.state.config.PAYMENT_SERVICE_URL).rstrip('/')


def _is_payment_error(data) -> Optional[str]:
    """payment_service returns OrderResponseDTO on success and a ResultDTO
    ({code, message}) on error (both HTTP 200). Return an error message if this
    looks like an error envelope, else None."""
    if not isinstance(data, dict):
        return 'Invalid response from payment service'
    if 'address' in data or 'status' in data:
        return None
    if 'message' in data:
        return str(data.get('message'))
    if 'code' in data:
        return f"payment service error (code {data.get('code')})"
    return 'Unexpected response from payment service'


async def _payment_create(request: Request, order_id: str, chain_id: str, amount: str) -> dict:
    url = f'{_payment_base(request)}/payment/create'
    payload = {'orderId': order_id, 'chainId': chain_id, 'amount': amount}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=25)) as session:
        async with session.post(url, json=payload) as resp:
            return await resp.json(content_type=None)


async def _payment_status(request: Request, order_id: str) -> dict:
    url = f'{_payment_base(request)}/payment/status/{order_id}'
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
        async with session.get(url) as resp:
            return await resp.json(content_type=None)


####################
# Subscription flow
####################


async def create_subscription_order(request: Request, user, tier_id: str, chain_id: str) -> dict:
    """Create a payment intent for `tier_id` on `chain_id`, register it with the
    Java payment_service, persist it, and return the checkout payload for the UI."""
    tier = await SubscriptionTiers.get_tier(tier_id)
    if tier is None or not tier.enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Subscription plan not found')
    if tier.price_usd <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='This plan is free and cannot be purchased')

    valid_chains = {c.get('id') for c in (request.app.state.config.SUBSCRIPTION_CHAINS or [])}
    if valid_chains and chain_id not in valid_chains:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Unsupported payment chain')

    logical_id = f'owui-{uuid.uuid4().hex}'
    amount = _fmt_amount(tier.price_usd)

    try:
        data = await _payment_create(request, logical_id, chain_id, amount)
    except Exception as e:
        log.exception('payment_service create failed')
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f'Could not reach payment service: {e}',
        )

    err = _is_payment_error(data)
    if err:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=err)

    composite_id = data.get('orderId') or f'{logical_id}_{chain_id}'
    address = data.get('address')
    if not address:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail='Payment service did not return an address')

    qr = data.get('qrCodeImage')
    order_status = data.get('status', 'PENDING')
    expires_at = int(time.time()) + ORDER_TTL_SECONDS

    await SubscriptionOrders.insert(
        order_id=composite_id,
        logical_order_id=logical_id,
        user_id=user.id,
        tier_id=tier_id,
        chain_id=chain_id,
        amount=amount,
        address=address,
        status=order_status,
        expires_at=expires_at,
    )

    return {
        'order_id': composite_id,
        'tier_id': tier_id,
        'tier_name': tier.name,
        'chain_id': chain_id,
        'amount': amount,
        'address': address,
        'qr_code_image': qr,
        'status': order_status,
        'expires_at': expires_at,
    }


async def sync_order(request: Request, user, order_id: str) -> dict:
    """Poll the payment_service for `order_id`; on first PAID, grant/extend the
    subscription (idempotent). Returns order status + current subscription state."""
    order = await SubscriptionOrders.get(order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Order not found')

    activated_now = False
    current_status = order.status
    tx_hash = order.tx_hash

    if not order.activated:
        try:
            data = await _payment_status(request, order_id)
            err = _is_payment_error(data)
            if not err:
                current_status = data.get('status', order.status)
                tx_hash = data.get('txHash', tx_hash)
        except Exception:
            log.exception('payment_service status check failed for %s', order_id)
            current_status = order.status

        if current_status != order.status or tx_hash != order.tx_hash:
            await SubscriptionOrders.update_status(order_id, current_status, tx_hash=tx_hash)

        if current_status == 'PAID':
            tier = await SubscriptionTiers.get_tier(order.tier_id)
            duration = tier.duration_days if tier else 30
            await UserSubscriptions.create_or_extend(user.id, order.tier_id, duration, order_id=order_id)
            await SubscriptionOrders.update_status(order_id, 'PAID', tx_hash=tx_hash, activated=True)
            # P4: push the new tier's rate limits to KyberRouter.
            await sync_user_rate_limits_to_kyber(request, user.id)
            activated_now = True

    state = await get_subscription_state(user.id, is_admin=(getattr(user, 'role', None) == 'admin'))
    return {
        'order_id': order_id,
        'status': current_status if not order.activated else 'PAID',
        'tx_hash': tx_hash,
        'activated': activated_now or order.activated,
        'subscription_state': state,
    }


####################
# Gift cards / redemption codes
####################

GIFT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'  # Crockford-ish: no 0/O/1/I/L
GIFT_CODE_GROUPS = 4
GIFT_CODE_GROUP_LEN = 4
GIFT_CODE_LEN = GIFT_CODE_GROUPS * GIFT_CODE_GROUP_LEN
MAX_GIFT_CARDS_PER_BATCH = 1000


def _generate_gift_code() -> str:
    parts = [
        ''.join(secrets.choice(GIFT_CODE_ALPHABET) for _ in range(GIFT_CODE_GROUP_LEN))
        for _ in range(GIFT_CODE_GROUPS)
    ]
    return '-'.join(parts)


def normalize_gift_code(raw: str) -> str:
    """Canonicalize user input (lowercase, spaces, with/without dashes) into the stored
    'XXXX-XXXX-XXXX-XXXX' form. Returns '' when the input has no usable characters."""
    cleaned = ''.join(ch for ch in (raw or '').upper() if ch.isalnum())
    if not cleaned:
        return ''
    groups = [
        cleaned[i : i + GIFT_CODE_GROUP_LEN]
        for i in range(0, len(cleaned), GIFT_CODE_GROUP_LEN)
    ]
    return '-'.join(groups)


async def generate_gift_cards(
    admin_user,
    tier_id: str,
    count: int,
    duration_days: Optional[int] = None,
    note: Optional[str] = None,
) -> list[GiftCardModel]:
    """Generate `count` unique single-use gift cards for `tier_id`. Duration defaults to the
    tier's configured length. Returns the new GiftCardModel list (codes included, for export)."""
    tier = await SubscriptionTiers.get_tier(tier_id)
    if tier is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Subscription plan not found')

    try:
        count = int(count)
    except (TypeError, ValueError):
        count = 0
    if count < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Count must be at least 1')
    if count > MAX_GIFT_CARDS_PER_BATCH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'At most {MAX_GIFT_CARDS_PER_BATCH} gift cards can be generated at once',
        )

    duration = int(duration_days) if duration_days else 0
    if duration <= 0:
        duration = tier.duration_days or 30

    batch_id = f'batch-{uuid.uuid4().hex[:12]}'
    created_by = getattr(admin_user, 'id', None)

    # Build a set of unique codes, deduped in-memory and against the DB. The code space is
    # 32^16, so collisions are astronomically rare — round 1 fills the batch in practice.
    codes: set[str] = set()
    attempts = 0
    max_attempts = count * 50 + 100
    while len(codes) < count and attempts < max_attempts:
        attempts += 1
        batch = {_generate_gift_code() for _ in range(count - len(codes))}
        batch -= codes
        if batch:
            batch -= await GiftCards.existing(list(batch))
        codes |= batch

    if len(codes) < count:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Could not generate unique gift card codes. Please try again.',
        )

    cards = [
        {
            'code': c,
            'tier_id': tier_id,
            'duration_days': duration,
            'batch_id': batch_id,
            'note': (note or None),
            'created_by': created_by,
        }
        for c in list(codes)[:count]
    ]
    return await GiftCards.insert_many(cards)


async def redeem_gift_card(request: Request, user, raw_code: str) -> dict:
    """Redeem a gift card for `user`: atomically claim the code, then grant/extend the tier.
    Double-spend is prevented by the atomic claim in GiftCards.claim(); on a grant failure the
    claim is released so the code stays usable."""
    code = normalize_gift_code(raw_code)
    if not code or len(code.replace('-', '')) != GIFT_CODE_LEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail='Please enter a valid gift card code'
        )

    claimed = await GiftCards.claim(code, user.id)
    if claimed is None:
        existing = await GiftCards.get(code)
        if existing is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Invalid gift card code')
        if not existing.enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail='This gift card has been deactivated'
            )
        if existing.redeemed_by == user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail='You have already redeemed this gift card'
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail='This gift card has already been redeemed'
        )

    tier = await SubscriptionTiers.get_tier(claimed.tier_id)
    if tier is None:
        await GiftCards.release(code)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail='The plan for this gift card no longer exists'
        )

    try:
        sub = await UserSubscriptions.create_or_extend(
            user.id, claimed.tier_id, claimed.duration_days, order_id=f'gift:{code}'
        )
    except Exception:
        log.exception('gift card grant failed; releasing claim for %s', code)
        await GiftCards.release(code)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail='Could not activate your subscription. Please try again.',
        )

    # P4: push the granted tier's rate limits to KyberRouter.
    await sync_user_rate_limits_to_kyber(request, user.id)

    state = await get_subscription_state(user.id, is_admin=(getattr(user, 'role', None) == 'admin'))
    return {
        'success': True,
        'tier_id': claimed.tier_id,
        'tier_name': tier.name,
        'duration_days': claimed.duration_days,
        'expires_at': sub.expires_at if sub else None,
        'subscription_state': state,
    }


####################
# Seeding
####################

DEFAULT_TIERS = [
    SubscriptionTierForm(
        id='free', name='Free', description='Get started — a small token quota.',
        price_usd=0.0, duration_days=36500, daily_message_limit=10,
        token_limit_5h=40000, token_limit_week=250000,
        allowed_model_ids=[], enabled=True, sort_order=0,
    ),
    SubscriptionTierForm(
        id='pro', name='Pro', description='For regular use.',
        price_usd=9.99, duration_days=30, daily_message_limit=100,
        token_limit_5h=400000, token_limit_week=3000000,
        allowed_model_ids=[], enabled=True, sort_order=1,
    ),
    SubscriptionTierForm(
        id='max', name='Max', description='For power users.',
        price_usd=29.99, duration_days=30, daily_message_limit=500,
        token_limit_5h=2000000, token_limit_week=15000000,
        allowed_model_ids=[], enabled=True, sort_order=2,
    ),
    SubscriptionTierForm(
        id='ultra', name='Ultra', description='Unlimited tokens.',
        price_usd=99.99, duration_days=30, daily_message_limit=None,
        token_limit_5h=None, token_limit_week=None,
        allowed_model_ids=[], enabled=True, sort_order=3,
    ),
]


async def seed_default_tiers() -> None:
    """Create the default Free/Pro/Max/Ultra tiers if none exist. Admin-editable afterwards."""
    try:
        if await SubscriptionTiers.count() > 0:
            return
        for form in DEFAULT_TIERS:
            await SubscriptionTiers.upsert_tier(form)
        log.info('Seeded %d default subscription tiers', len(DEFAULT_TIERS))
    except Exception:
        log.exception('Failed to seed default subscription tiers')
