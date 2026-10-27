"""Subscription business logic: tier resolution, enforcement, payment_service client,
activation and default-tier seeding. See SUBSCRIPTION.md."""

import asyncio
import logging
import secrets
import time
import uuid
from typing import Optional
from open_webui.utils.subscription_model_ids import canonical_model_id, normalize_model_ids, individual_grant_only

from open_webui.utils.claude_allocation import change_subscription, reserve_order, cancel_reservation, reconcile_allocations, latest_change, propagate

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
    UserSubscription,
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


async def sync_user_rate_limits_to_kyber(request: Request, user_id: str) -> bool:
    """P4 (Mode B): push the user's effective tier's 5h/week token caps to KyberRouter
    as a per-user override AND mark the account subscription-managed, so KyberRouter
    limits the user by these token rate caps instead of their wallet balance.
    get_user_tier already falls back to the Free tier, so free users get Free's
    configured caps. The override is ALWAYS non-null when the user has a tier — even
    unlimited tiers (caps None) send {tp5h: 0, tpw: 0} (0 = unlimited per KyberRouter
    convention) so the managed flag and a concrete cap are always set. The non-tier
    token windows (tph/tp4h/tpd) are pinned to 0 so a managed user is bound only by the
    per-tier 5h/weekly caps, never by KyberRouter's global hourly/4h/daily defaults.
    Admin roles do not bypass subscription token allowances. No-op
    when token billing is off; best-effort (never raises into the subscription/login flow).
    Returns True only when KyberRouter acknowledged the PUT (False on skip/failure) so
    bulk callers can report how many users actually got the new caps."""
    try:
        if not getattr(request.app.state.config, 'ENABLE_KYBER_TOKEN_BILLING', False):
            return False
        change = await latest_change(user_id)
        if change and not change.synced:
            await propagate(request, change.id)
        tier, _ = await get_user_tier(user_id)
        from open_webui.utils.kyber import kyber_set_user_rate_limits

        if tier is None:
            # No tier configured/seeded yet → clear any override, leave management off.
            return await kyber_set_user_rate_limits(request, user_id, None)

        # Roles are preserved; token allowances follow the effective subscription.

        # Always send a NON-NULL override + subscription_managed=True. 0 = unlimited.
        # Pin the non-tier token windows (tph/tp4h/tpd) to 0 so a managed user is bound
        # ONLY by the per-tier 5h/weekly caps, never by a global hourly/4h/daily default
        # (KyberRouter merges any window absent from the override over its GLOBAL defaults).
        # Don't send rpm (KyberRouter requires rpm>=1) — let it inherit the global.
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

        # Did the user's caps actually change? Read what KyberRouter holds BEFORE
        # overwriting it. This runs on every sync (login included), so comparing is
        # the only way to tell a real tier change from a routine re-push — resetting
        # unconditionally would clear the window on every login.
        #
        # Comparing stored-vs-new caps rather than tracking the last synced tier
        # keeps this self-correcting: a cap changed out of band (SQL, a missed sync,
        # an edited tier) still counts as a change and still gets a clean window.
        caps_changed = await _caps_differ(request, link, override)

        ok = await kyber_set_user_rate_limits(
            request, user_id, override, subscription_managed=True,
            extra_usage_enabled=extra_enabled, extra_usage_multiplier=multiplier,
            subscription_version=change.version if change else 0, subscription_tier=tier.id,
        )

        # Tier changed → the 5h/weekly counters start fresh (user decision
        # 2026-09-03). Without this an upgrade inherits the old plan's consumption
        # and reads as a nonsense percentage of the new cap, and an expiring user
        # stays locked out of their free window for days by tokens they paid for.
        # Best-effort and strictly after the caps land: a failed reset leaves the
        # correct caps in place, which is the safe half.
        if ok and caps_changed:
            try:
                from open_webui.utils.kyber import kyber_reset_user_usage

                kyber_uid = getattr(link, 'kyber_user_id', None)
                if kyber_uid:
                    await kyber_reset_user_usage(request, kyber_uid)
                    log.info('rate-limit windows reset for %s (caps changed)', user_id)
            except Exception:
                log.warning('caps changed for %s but window reset failed', user_id, exc_info=True)
        return ok
    except Exception:
        log.exception('Failed to sync rate limits to KyberRouter for %s', user_id)
        return False


async def _caps_differ(request: Request, link, override: dict) -> bool:
    """True when KyberRouter's stored 5h/weekly caps differ from the ones about to be
    written. False on any read failure — an unreadable cap must not be mistaken for a
    tier change and wipe a live counter."""
    kyber_uid = getattr(link, 'kyber_user_id', None)
    if not kyber_uid:
        return False
    try:
        from open_webui.utils.kyber import kyber_get_users_usage_limits

        current = (await kyber_get_users_usage_limits(request, [kyber_uid])).get(kyber_uid)
        if not current:
            return False  # unknown/unreadable: never reset on a guess
        for window, key in (('tp5h', 'tp5h'), ('tpw', 'tpw')):
            stored = (current.get(window) or {}).get('limit')
            if stored is None:
                return False
            if int(stored or 0) != int(override.get(key) or 0):
                return True
        return False
    except Exception:
        log.warning('could not read current caps for %s; skipping window reset', kyber_uid)
        return False


async def sync_all_user_rate_limits_to_kyber(
    request: Request, tier_id: Optional[str] = None, concurrency: int = 4
) -> dict:
    """Re-push the effective tier caps of every KyberRouter-linked user — or, with
    `tier_id`, only the users whose EFFECTIVE tier is that one (for the default free
    tier that means everyone without an active paid subscription).

    Why this exists: KyberRouter's limiter and the usage ring read the per-user
    User.rateLimits override, which is only refreshed by the five per-user sync
    events (login, redeem, payment, extra-usage toggle, gift invalidate). Editing a
    tier's caps changed the plan CARD but left every existing subscriber on the old
    caps until they happened to log in again. Called after an admin saves a tier and
    from the admin resync endpoint. Best-effort per user; returns counts."""
    from open_webui.models.kyber_accounts import UserKyberAccounts

    from open_webui.utils.subscription_models import sync_subscription_model_policy

    policy_synced = await sync_subscription_model_policy(request)
    user_ids = await UserKyberAccounts.list_user_ids()
    sem = asyncio.Semaphore(max(1, concurrency))
    stats = {'model_policy_synced': policy_synced, 'tier_id': tier_id, 'total_linked': len(user_ids), 'matched': 0, 'synced': 0, 'failed': 0}

    async def _one(uid: str) -> None:
        async with sem:
            if tier_id is not None:
                tier, _ = await get_user_tier(uid)
                if tier is None or tier.id != tier_id:
                    return
            stats['matched'] += 1
            ok = await sync_user_rate_limits_to_kyber(request, uid)
            stats['synced' if ok else 'failed'] += 1

    await asyncio.gather(*(_one(uid) for uid in user_ids))
    log.info('rate-limit resync tier=%s: %s', tier_id, stats)
    return stats


async def expire_lapsed_subscriptions() -> int:
    """Flip `status` to 'expired' on rows whose expires_at has passed.

    get_user_tier already ignores lapsed rows, so nothing depended on this column
    being accurate — which is why it silently drifted: rows sat at 'active' months
    past their end date, and the admin list showed a state the limiter did not
    share. Returns the number of rows corrected.
    """
    try:
        from sqlalchemy import update

        from open_webui.internal.db import get_async_db_context

        now = int(time.time())
        async with get_async_db_context(None) as db:
            result = await db.execute(
                update(UserSubscription)
                .where(UserSubscription.status == 'active')
                .where(UserSubscription.expires_at.isnot(None))
                .where(UserSubscription.expires_at < now)
                .values(status='expired', updated_at=now)
            )
            await db.commit()
            n = int(result.rowcount or 0)
        if n:
            log.info('marked %s lapsed subscription(s) expired', n)
        return n
    except Exception:
        log.exception('failed to expire lapsed subscriptions')
        return 0


async def subscription_reconcile_loop(app, interval_seconds: int = 900) -> None:
    """Periodically re-push every linked user's effective caps to KyberRouter.

    The five per-user sync events (login, redeem, payment, extra-usage toggle, gift
    invalidate) all fire on something the USER does. Expiry is the one transition
    nobody triggers: a lapsed subscriber who stays signed in or drives the API by
    key kept their old paid caps indefinitely — four accounts were found holding
    Ultra's 100M weekly cap on the free tier, 100x over.

    The resync recomputes each user's effective tier (which does account for
    expiry) and pushes it, so this closes that hole without a new code path — and,
    because sync now resets the windows when caps change, an expiring user also
    gets their free-tier window instead of staying locked out by tokens they used
    while paying.
    """
    from starlette.requests import Request as StarletteRequest

    # sync_all_user_rate_limits_to_kyber only ever reads request.app.state.config,
    # so a minimal scope is enough — there is no live HTTP request here.
    request = StarletteRequest({'type': 'http', 'app': app, 'headers': []})
    while True:
        try:
            await asyncio.sleep(min(interval_seconds, 60))
            await reconcile_allocations(request)
            await expire_lapsed_subscriptions()
            stats = await sync_all_user_rate_limits_to_kyber(request, None)
            if stats.get('failed') or not stats.get('model_policy_synced'):
                log.warning('subscription reconcile: %s', stats)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception('subscription reconcile pass failed')


async def get_subscription_state(user_id: str, is_admin: bool = False) -> dict:
    """State for the /me endpoint: effective tier, today's usage, remaining, expiry."""
    tier, sub = await get_user_tier(user_id)
    limit = None if tier is None else tier.daily_message_limit
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
    user's managed chat completion, including administrators. Increments the daily
    counter when a finite limit applies. Disabled subscriptions are a no-op."""
    if individual_grant_only(model_id):
        from open_webui.utils.model_grants import enforce_individual_grant
        await enforce_individual_grant(request, user, model_id)
        return  # Personal grants are independent of tiers and daily message quotas.
    if not getattr(request.app.state.config, 'ENABLE_SUBSCRIPTIONS', True):
        return
    # Guests are gated separately (per-IP/device, not per-user) by
    # enforce_guest_access — don't apply the shared guest account's tier here.
    from open_webui.utils.guest import is_guest_user

    if is_guest_user(user):
        return
    # Enterprise (KyberRouter org-seat) members get desktop parity: skip the
    # per-tier model allow-list AND the daily message cap — KyberRouter's seat
    # quota + org wallet govern usage instead (same as the desktop client).
    from open_webui.utils.kyber import is_kyber_enterprise_member

    if await is_kyber_enterprise_member(request, user.id):
        return

    tier, _ = await get_user_tier(user.id)
    if tier is None:
        # Subscriptions enabled but no tiers configured/seeded yet → don't block.
        return

    # 1) Model allow-list (empty / None = all models allowed). Applies in BOTH
    # billing modes: KyberRouter defines the platform model pool (first filter);
    # the tier's checked models are the second filter — what this plan may use.
    allowed = normalize_model_ids(tier.allowed_model_ids)
    if allowed and canonical_model_id(model_id) not in allowed:
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


def filter_models_by_tier(models: list, tier: Optional[SubscriptionTierModel], granted_ids=()) -> list:
    """Tier permissions apply to ordinary models; GPT requires a verified personal grant."""
    grants = {canonical_model_id(m) for m in granted_ids}
    allowed = set(normalize_model_ids(tier.allowed_model_ids) or []) if tier else set()
    result = []
    for model in models:
        mid = canonical_model_id((model.get('id') if isinstance(model, dict) else getattr(model, 'id', None)) or '')
        if (mid in grants if individual_grant_only(mid) else not allowed or mid in allowed):
            result.append(model)
    return result


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
    from open_webui.utils.subscription_payments import create_checkout
    return await create_checkout(request, user, tier_id, chain_id)


async def sync_order(request: Request, user, order_id: str) -> dict:
    from open_webui.utils.subscription_payments import sync_checkout
    return await sync_checkout(request, user, order_id)


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

    if not tier.enabled or tier.id not in ('pro', 'ultra'):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='请选择有效的付费订阅档位')

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

    claimed = await GiftCards.get(code)
    if claimed is None:
        raise HTTPException(404, 'Invalid gift card code')
    tier = await SubscriptionTiers.get_tier(claimed.tier_id)
    if tier is None or not tier.enabled:
        raise HTTPException(409, '此兑换码的订阅档位已停用，请联系管理员处理')
    sub = await change_subscription(request, user.id, claimed.tier_id,
        operation_id=f'gift:{code}', gift_code=code)

    # The grant is durable and idempotent by gift code. Do not report complete
    # activation while the gateway is still enforcing the previous allowance.
    synced = await sync_user_rate_limits_to_kyber(request, user.id)
    if getattr(request.app.state.config, 'ENABLE_KYBER_TOKEN_BILLING', False) and not synced:
        raise HTTPException(
            503,
            '订阅已保存，但使用权限同步尚未完成。请稍后使用同一激活码重试，不会重复扣除或延长订阅。',
        )

    state = await get_subscription_state(user.id, is_admin=(getattr(user, 'role', None) == 'admin'))
    return {
        'success': True,
        'tier_id': claimed.tier_id,
        'tier_name': tier.name,
        'duration_days': claimed.duration_days,
        'expires_at': sub.expires_at if sub else None,
        'subscription_state': state,
    }


async def invalidate_gift_card(request: Request, raw_code: str) -> dict:
    """Refund a REDEEMED gift card (admin action): void the code AND revoke the
    subscription it granted, so the redeemer reverts to the default tier — the
    in-system half of a refund (the actual money refund is handled out-of-band).

    Steps: disable the card (so it reads as 'invalidated' and can't be re-enabled
    casually), cancel/expire the subscription tagged order_id 'gift:<code>', then
    re-sync the affected user's rate limits to KyberRouter so their caps drop back to
    Free. Idempotent: re-running just re-disables + re-cancels. Raises 404 if the code
    is missing, 400 if it was never redeemed (use the enable/disable toggle for those).
    """
    code = normalize_gift_code(raw_code)
    card = await GiftCards.get(code) if code else None
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Gift card not found')
    if not card.redeemed_by:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Only redeemed gift cards can be refunded. Disable unredeemed cards instead.',
        )

    # 1) Void the code.
    await GiftCards.set_enabled(code, False)

    # 2) Revoke the subscription this redemption granted (tagged 'gift:<code>').
    current = await UserSubscriptions.get_active_for_user(card.redeemed_by)
    affected = [card.redeemed_by] if current and current.order_id == f'gift:{code}' else []
    if affected:
        await change_subscription(request, card.redeemed_by, 'free',
                                  operation_id=f'refund:{code}', revoke_order_id=f'gift:{code}')

    # 3) Re-sync each affected user's rate limits to KyberRouter (tier reverts to Free).
    # Fall back to the card's redeemed_by if no subscription row was found (e.g. it was
    # already superseded) so the managed caps are still re-derived for that user.
    targets = affected or ([card.redeemed_by] if card.redeemed_by else [])
    for user_id in targets:
        await sync_user_rate_limits_to_kyber(request, user_id)

    return {
        'success': True,
        'code': code,
        'redeemed_by': card.redeemed_by,
        'revoked_user_ids': affected,
    }


####################
# Seeding
####################

# Platform subscription quotas. These are local limits, not upstream usage guarantees.
DEFAULT_TIERS = [
    SubscriptionTierForm(
        id='free', name='Free', description='Get started — a small token quota.',
        price_usd=0.0, duration_days=36500, daily_message_limit=None,
        token_limit_5h=200_000, token_limit_week=1_000_000,
        allowed_model_ids=[], enabled=True, sort_order=0,
    ),
    SubscriptionTierForm(
        id='pro', name='Max 5x', description='For regular use.',
        price_usd=120.0, duration_days=30, daily_message_limit=None,
        token_limit_5h=7_000_000, token_limit_week=35_000_000,
        allowed_model_ids=[], enabled=True, sort_order=1,
    ),
    SubscriptionTierForm(
        id='ultra', name='Max 20x', description='Dedicated Claude account.',
        price_usd=360.0, duration_days=30, daily_message_limit=None,
        token_limit_5h=20_000_000, token_limit_week=100_000_000,
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
