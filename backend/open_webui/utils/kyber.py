"""KyberRouter account-bridge client (SESSION-HANDOFF §12.7, P1).

KyberRouter is the account/wallet/billing source of truth. When ENABLE_KYBER_AUTH_BRIDGE
is on, open-webui proxies KyberRouter's auth API for signin/signup, provisions a local
shadow user, and stores the user's `sk-or-` API key (Fernet-encrypted) for P2 per-user
token billing. All functions here are no-ops unless the bridge is enabled by the caller."""

import logging
import time
from typing import Optional
from urllib.parse import urlparse

import aiohttp
from fastapi import Request

from open_webui.models.kyber_accounts import UserKyberAccounts
from open_webui.utils.oauth import decrypt_data, encrypt_data

log = logging.getLogger(__name__)

_TIMEOUT = aiohttp.ClientTimeout(total=20)


class KyberError(Exception):
    """A user-facing error from a KyberRouter API call (message + HTTP status to surface)."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


def kyber_base(request: Request) -> str:
    return str(
        getattr(request.app.state.config, 'KYBERROUTER_API_URL', 'http://127.0.0.1:18000/api')
    ).rstrip('/')


def _err_message(data, default: str = 'KyberRouter request failed') -> str:
    if not isinstance(data, dict):
        return default
    # Prefer a specific validation issue (Zod/Fastify shapes) over a generic top-level
    # "Validation Error" — so e.g. a too-short password surfaces a useful message.
    for arr_key in ('issues', 'errors', 'details'):
        arr = data.get(arr_key)
        if isinstance(arr, list):
            for item in arr:
                if isinstance(item, dict) and isinstance(item.get('message'), str) and item['message']:
                    return item['message']
                if isinstance(item, str) and item:
                    return item
    for k in ('message', 'error'):
        v = data.get(k)
        if isinstance(v, str) and v:
            return v
        if isinstance(v, dict) and isinstance(v.get('message'), str) and v['message']:
            return v['message']
    return default


async def _post(base: str, path: str, payload: dict, jwt: Optional[str] = None):
    headers = {'Content-Type': 'application/json'}
    if jwt:
        headers['Authorization'] = f'Bearer {jwt}'
    async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
        async with session.post(f'{base}{path}', json=payload, headers=headers) as resp:
            try:
                data = await resp.json(content_type=None)
            except Exception:
                data = {}
            return resp.status, (data if isinstance(data, dict) else {})


async def _get(base: str, path: str, bearer: str):
    """GET with a Bearer token. KyberRouter's authenticate middleware accepts both
    JWTs and sk-or- keys, so a user's stored key works for their own usage/summary."""
    headers = {'Authorization': f'Bearer {bearer}'}
    async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
        async with session.get(f'{base}{path}', headers=headers) as resp:
            try:
                data = await resp.json(content_type=None)
            except Exception:
                data = {}
            return resp.status, (data if isinstance(data, dict) else {})


####################
# Auth API
####################


async def kyber_login(base: str, email: str, password: str) -> Optional[dict]:
    """Return KyberRouter's auth payload {accessToken, refreshToken, user} on success, or
    None when authentication did not succeed for ANY reason (bad creds or service issue).
    The caller falls back to local auth on None, so a KyberRouter outage never locks out
    existing local accounts (e.g. the admin)."""
    try:
        status_code, data = await _post(base, '/auth/login', {'email': email, 'password': password})
    except Exception as e:
        # Expected fallback path (KyberRouter unreachable) — concise warning, no stack spam.
        log.warning('KyberRouter unreachable for login of %s: %s', email, e)
        return None
    if status_code == 200 and data.get('accessToken'):
        return data
    log.info('KyberRouter login non-success (%s) for %s: %s', status_code, email, _err_message(data))
    return None


async def kyber_send_register_code(base: str, email: str) -> dict:
    try:
        status_code, data = await _post(base, '/auth/register/send-code', {'email': email})
    except Exception as e:
        raise KyberError('Could not reach the account service. Please try again.', 502) from e
    if status_code in (200, 201):
        return data
    raise KyberError(_err_message(data, 'Could not send the verification code'), 400)


async def kyber_register_verify(
    base: str, email: str, code: str, password: str, name: Optional[str] = None
) -> dict:
    payload = {'email': email, 'code': code, 'password': password}
    if name:
        payload['name'] = name
    try:
        status_code, data = await _post(base, '/auth/register/verify', payload)
    except Exception as e:
        raise KyberError('Could not reach the account service. Please try again.', 502) from e
    if status_code in (200, 201) and data.get('accessToken'):
        return data
    raise KyberError(_err_message(data, 'Verification failed'), 400)


async def kyber_forgot_password(base: str, email: str) -> dict:
    """Ask KyberRouter to email a password-reset code (anti-enumeration: 200 even if
    the email is unknown)."""
    try:
        status_code, data = await _post(base, '/auth/forgot-password', {'email': email})
    except Exception as e:
        raise KyberError('Could not reach the account service. Please try again.', 502) from e
    if status_code in (200, 201):
        return data
    raise KyberError(_err_message(data, 'Could not send the reset code'), 400)


async def kyber_reset_password(base: str, email: str, code: str, new_password: str) -> dict:
    """Complete a password reset against KyberRouter (the account source of truth)."""
    payload = {'email': email, 'code': code, 'newPassword': new_password}
    try:
        status_code, data = await _post(base, '/auth/reset-password', payload)
    except Exception as e:
        raise KyberError('Could not reach the account service. Please try again.', 502) from e
    if status_code in (200, 201):
        return data
    raise KyberError(_err_message(data, 'Password reset failed'), 400)


async def kyber_create_api_key(base: str, jwt: str, name: str = 'open-webui') -> Optional[str]:
    """Create a personal sk-or- key for the user (auth'd by their JWT). Returns the raw key
    string (only available at creation time) or None on failure."""
    try:
        status_code, data = await _post(base, '/keys', {'name': name}, jwt=jwt)
    except Exception as e:
        log.warning('KyberRouter create-api-key request failed: %s', e)
        return None
    if status_code in (200, 201):
        key = data.get('key')
        return key if isinstance(key, str) and key else None
    log.info('KyberRouter create-api-key non-success (%s): %s', status_code, _err_message(data))
    return None


####################
# Linkage helpers
####################


async def ensure_kyber_link(owui_user_id: str, kyber_user: dict, base: str, jwt: str) -> None:
    """Upsert the open-webui↔KyberRouter link for `owui_user_id`. Provisions and stores a
    personal sk-or- key (encrypted) the first time, if none is stored yet."""
    kyber_user_id = str(kyber_user.get('id') or '')
    kyber_email = str(kyber_user.get('email') or '')
    if not kyber_user_id:
        log.warning('ensure_kyber_link called without a KyberRouter user id')
        return

    existing = await UserKyberAccounts.get_by_user_id(owui_user_id)
    api_key_enc = existing.api_key_enc if existing else None

    if not api_key_enc and jwt:
        key = await kyber_create_api_key(base, jwt)
        if key:
            try:
                api_key_enc = encrypt_data(key)
            except Exception:
                log.exception('Failed to encrypt KyberRouter api key for %s', owui_user_id)

    await UserKyberAccounts.upsert(
        user_id=owui_user_id,
        kyber_user_id=kyber_user_id,
        kyber_email=kyber_email,
        api_key_enc=api_key_enc,
    )


async def get_user_kyber_api_key(owui_user_id: str) -> Optional[str]:
    """Decrypt and return the user's stored sk-or- key, or None. (Used by P2 billing.)"""
    link = await UserKyberAccounts.get_by_user_id(owui_user_id)
    if not link or not link.api_key_enc:
        return None
    try:
        return decrypt_data(link.api_key_enc)
    except Exception:
        log.exception('Failed to decrypt KyberRouter api key for %s', owui_user_id)
        return None


def _host_matches(url: str, base: str) -> bool:
    """True when an upstream `url` should be billed via KyberRouter. Empty base
    matches any OpenAI connection (single-upstream deployment); otherwise compare
    hostnames so trailing path/slash differences don't matter."""
    if not base:
        return True
    try:
        return urlparse(url).hostname == urlparse(base).hostname
    except Exception:
        return url.rstrip('/').startswith(base.rstrip('/'))


async def get_kyber_billing_key(request: Request, user, url: str) -> Optional[str]:
    """P2: return the user's own sk-or- key for a chat completion to the KyberRouter
    model API, so usage is metered/limited against their wallet (402 on empty balance).

    Returns None — and the caller keeps the shared connection key, so chat never
    breaks — when token billing is off, the upstream isn't KyberRouter, or the user
    has no linked key yet (e.g. local admins, pre-bridge accounts)."""
    cfg = request.app.state.config
    if not getattr(cfg, 'ENABLE_KYBER_TOKEN_BILLING', False):
        return None
    base = getattr(cfg, 'KYBER_BILLING_BASE_URL', '') or ''
    if not _host_matches(url, base):
        return None
    user_id = getattr(user, 'id', None)
    if not user_id:
        return None
    return await get_user_kyber_api_key(user_id)


async def get_user_usage_summary(request: Request, user) -> Optional[dict]:
    """P3: fetch the user's KyberRouter wallet balance + token usage for the
    bottom-right widget. Returns KyberRouter's /usage/summary payload
    ({today, thisMonth, total, credits}) or None when the user has no linked key
    or KyberRouter is unreachable. Auth'd by the user's own stored sk-or- key."""
    user_id = getattr(user, 'id', None)
    if not user_id:
        return None
    key = await get_user_kyber_api_key(user_id)
    if not key:
        return None
    base = kyber_base(request)
    try:
        status_code, data = await _get(base, '/usage/summary', key)
    except Exception as e:
        log.warning('KyberRouter usage summary unreachable for %s: %s', user_id, e)
        return None
    if status_code == 200:
        return data
    log.info('KyberRouter usage summary non-success (%s) for %s', status_code, user_id)
    return None


async def get_user_usage_limits(request: Request, user) -> Optional[dict]:
    """Fetch the user's token-window usage vs caps + wallet/extra-usage state for the
    Settings Usage panel and the bottom-right widget. Returns KyberRouter's
    /usage/limits payload ({tp5h, tpw, credits, extraUsageEnabled, extraUsageMultiplier})
    or None when unlinked / unreachable. Auth'd by the user's own sk-or- key so the
    numbers match what the rate limiter enforces for that key."""
    user_id = getattr(user, 'id', None)
    if not user_id:
        return None
    key = await get_user_kyber_api_key(user_id)
    if not key:
        return None
    base = kyber_base(request)
    try:
        status_code, data = await _get(base, '/usage/limits', key)
    except Exception as e:
        log.warning('KyberRouter usage limits unreachable for %s: %s', user_id, e)
        return None
    if status_code == 200:
        return data
    log.info('KyberRouter usage limits non-success (%s) for %s', status_code, user_id)
    return None


async def kyber_topup_create(request: Request, user, amount_usd: float, chain_id: str):
    """P5: create a USDT top-up on KyberRouter for the chat user (proxied with their
    own sk-or- key, so it credits their wallet). Returns (status, data); data has
    {id, address, qrCodeImage, usdtAmount, ...} on success."""
    key = await get_user_kyber_api_key(getattr(user, 'id', None))
    if not key:
        return 400, {'error': 'Your account is not linked to a wallet yet'}
    try:
        return await _post(kyber_base(request), '/usdt-topup', {'amountUsd': amount_usd, 'chainId': chain_id}, jwt=key)
    except Exception as e:
        log.warning('KyberRouter topup create failed for %s: %s', getattr(user, 'id', '?'), e)
        return 502, {'error': f'Could not reach payment service: {e}'}


async def kyber_topup_status(request: Request, user, topup_id: str):
    """P5: poll a USDT top-up's status (KyberRouter credits the wallet on PAID)."""
    key = await get_user_kyber_api_key(getattr(user, 'id', None))
    if not key:
        return 400, {'error': 'Your account is not linked to a wallet yet'}
    try:
        return await _get(kyber_base(request), f'/usdt-topup/{topup_id}', key)
    except Exception as e:
        return 502, {'error': str(e)}


async def kyber_set_user_rate_limits(
    request: Request,
    owui_user_id: str,
    override,
    subscription_managed: Optional[bool] = None,
    extra_usage_enabled: Optional[bool] = None,
    extra_usage_multiplier: Optional[float] = None,
) -> bool:
    """P4: set or clear the user's per-tier rate-limit override on KyberRouter via
    the shared-secret internal endpoint. ``override`` is a dict like
    {tp5h?, tpw?, ...} (merged over KyberRouter's globals) or None to clear it.

    ``subscription_managed`` (when not None) marks the KyberRouter account as managed
    by an open-webui subscription, so KyberRouter limits the user by the synced token
    rate caps instead of their wallet balance. Included in the PUT body only when set.

    No-op (returns False) when no internal secret is configured or the user has no
    linked KyberRouter account — so it never raises into the subscription flow."""
    from open_webui.config import KYBER_INTERNAL_SECRET

    if not KYBER_INTERNAL_SECRET:
        return False
    link = await UserKyberAccounts.get_by_user_id(owui_user_id)
    if not link or not link.kyber_user_id:
        return False
    url = f'{kyber_base(request)}/internal/users/{link.kyber_user_id}/rate-limits'
    body = {'rateLimits': override}
    # Tell KyberRouter which key is the open-webui-linked subscription key, so ONLY
    # chat traffic via it is metered against the subscription token window — the user's
    # own keys + the playground stay plain pay-as-you-go. Best-effort: omitted when no
    # key is stored yet (KyberRouter then leaves the flag untouched).
    sub_key = await get_user_kyber_api_key(owui_user_id)
    if sub_key:
        body['subscriptionKey'] = sub_key
    if subscription_managed is not None:
        body['subscriptionManaged'] = subscription_managed
    # Extra-usage (paid overflow): the per-user opt-in + the per-tier multiplier.
    # Included only when set so a rate-limit-only sync never clobbers them.
    if extra_usage_enabled is not None:
        body['extraUsageEnabled'] = extra_usage_enabled
    if extra_usage_multiplier is not None:
        body['extraUsageMultiplier'] = extra_usage_multiplier
    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.put(
                url,
                json=body,
                headers={'Content-Type': 'application/json', 'X-Internal-Secret': KYBER_INTERNAL_SECRET},
            ) as resp:
                if resp.status == 200:
                    return True
                log.warning('KyberRouter set rate-limits non-200 (%s) for %s', resp.status, owui_user_id)
                return False
    except Exception as e:
        log.warning('KyberRouter set rate-limits failed for %s: %s', owui_user_id, e)
        return False


####################
# Enterprise (org-seat) — desktop parity on the web
####################

# In-process TTL cache for the org-seat lookup. The model-list filter and the
# chat gate both run on hot paths, so we must NOT hit KyberRouter on every call.
# Staleness is bounded by _ORG_SEAT_TTL_S (org membership changes are rare, and
# KyberRouter's own getOrgContext is likewise short-TTL cached).
_ORG_SEAT_TTL_S = 60.0
_ORG_SEAT_CACHE_MAX = 50_000
_org_seat_cache: dict = {}


async def kyber_get_user_org_seat(request: Request, owui_user_id: str) -> Optional[dict]:
    """Fetch the user's KyberRouter enterprise (org-seat) context via the internal
    endpoint, or None. Cached in-process for _ORG_SEAT_TTL_S. Best-effort: any
    failure (no internal secret, no linked account, KyberRouter unreachable, non-200)
    returns None, so a caller falls back to the normal subscription tier and this
    never blocks the model list or a chat."""
    from open_webui.config import KYBER_INTERNAL_SECRET

    if not KYBER_INTERNAL_SECRET:
        return None
    now = time.time()
    hit = _org_seat_cache.get(owui_user_id)
    if hit and hit[0] > now:
        return hit[1]
    link = await UserKyberAccounts.get_by_user_id(owui_user_id)
    if not link or not link.kyber_user_id:
        return None
    url = f'{kyber_base(request)}/internal/users/{link.kyber_user_id}/org-seat'
    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.get(
                url, headers={'X-Internal-Secret': KYBER_INTERNAL_SECRET}
            ) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json(content_type=None)
    except Exception as e:
        log.warning('KyberRouter org-seat lookup failed for %s: %s', owui_user_id, e)
        return None
    if not isinstance(data, dict):
        return None
    if _ORG_SEAT_TTL_S > 0:
        if len(_org_seat_cache) >= _ORG_SEAT_CACHE_MAX:
            _org_seat_cache.clear()
        _org_seat_cache[owui_user_id] = (now + _ORG_SEAT_TTL_S, data)
    return data


async def is_kyber_enterprise_member(request: Request, owui_user_id: str) -> bool:
    """True when the user holds an ACTIVE KyberRouter org seat in an active org.
    Such users get desktop parity on the web (all models, no per-tier model
    allow-list or daily message cap); actual usage is governed by KyberRouter's
    seat quota + org wallet, exactly as when the desktop client hits it directly."""
    data = await kyber_get_user_org_seat(request, owui_user_id)
    return bool(data and data.get('isEnterprise'))
