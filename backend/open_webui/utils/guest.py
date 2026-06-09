"""Guest (anonymous) access helpers.

A single shared "guest" user account backs all anonymous sessions, so the
entire authenticated chat pipeline works unchanged — we just mint a normal
(short-lived) JWT for that account. Guest-specific limits are enforced here:

  * IP blacklist  -> 403
  * per-IP AND per-device daily message cap -> 429 ("please log in")
  * an allow/block list of models guests may use -> 403

Identifying a guest request: the user's email == GUEST_EMAIL (robust across
restarts, no DB lookup needed). The device id is supplied by the client in the
`X-Guest-Device-Id` header.
"""

import ipaddress
import logging
import time
import uuid

from fastapi import HTTPException, Request, status

from open_webui.models.auths import Auths
from open_webui.models.guest import GuestBlacklist, GuestUsage
from open_webui.models.users import Users

log = logging.getLogger(__name__)

GUEST_EMAIL = 'guest@guest.local'
GUEST_NAME = 'Guest'
GUEST_DEVICE_HEADER = 'X-Guest-Device-Id'


def is_guest_user(user) -> bool:
    """True if `user` is the shared guest account."""
    return bool(user) and getattr(user, 'email', None) == GUEST_EMAIL


def _bearer_token(request: Request) -> str:
    auth = request.headers.get('authorization') or ''
    if auth.lower().startswith('bearer '):
        return auth[7:].strip()
    return request.cookies.get('token') or ''


def get_guest_device_id(request: Request) -> str:
    """The device id the frontend baked into the guest JWT at sign-in
    (`guest_device` claim). Falls back to the X-Guest-Device-Id header."""
    from open_webui.utils.auth import decode_token

    token = _bearer_token(request)
    if token:
        try:
            data = decode_token(token) or {}
            dev = str(data.get('guest_device') or '').strip()
            if dev:
                return dev
        except Exception:
            pass
    return (request.headers.get(GUEST_DEVICE_HEADER) or '').strip()


def _utc_date() -> str:
    return time.strftime('%Y-%m-%d', time.gmtime())


def get_client_ip(request: Request) -> str:
    """Best-effort real client IP behind ALB + nginx.

    X-Forwarded-For looks like "<maybe-spoofed>, <real-client>, <alb>, <nginx>".
    Trusted proxies (ALB/nginx/loopback) use private/loopback addresses, so we
    walk the chain from the RIGHT and return the first PUBLIC address — that is
    the IP the edge proxy actually observed, which a client cannot forge by
    pre-seeding its own X-Forwarded-For (the edge appends the real peer after
    any client-supplied value).
    """
    xff = request.headers.get('x-forwarded-for', '')
    candidates = [p.strip() for p in xff.split(',') if p.strip()]
    for raw in reversed(candidates):
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            continue
        return raw
    # Fallbacks: first XFF entry, then the socket peer.
    if candidates:
        return candidates[0]
    try:
        return request.client.host if request.client else ''
    except Exception:
        return ''


def guest_model_allowed(config, model_id: str) -> bool:
    allowed = getattr(config, 'GUEST_ALLOWED_MODEL_IDS', None) or []
    if allowed:
        return model_id in allowed
    blocked = getattr(config, 'GUEST_BLOCKED_MODEL_IDS', None) or []
    return model_id not in blocked


async def ensure_guest_user(db=None):
    """Get (or lazily create) the shared guest user account. role='user' so the
    normal chat pipeline accepts it; it never logs in via password."""
    user = await Users.get_user_by_email(GUEST_EMAIL, db=db)
    if user is None:
        user = await Auths.insert_new_auth(
            email=GUEST_EMAIL,
            password=str(uuid.uuid4()),  # unguessable; guest never password-logs-in
            name=GUEST_NAME,
            profile_image_url='/user.png',
            role='user',
            db=db,
        )
    return user


async def guest_usage_status(request: Request, user) -> dict:
    """Remaining-quota summary for the UI. {limit, used, remaining}."""
    config = request.app.state.config
    limit = int(getattr(config, 'GUEST_DAILY_LIMIT', 5) or 0)
    ip = get_client_ip(request)
    device = get_guest_device_id(request)
    date = _utc_date()
    ip_used = await GuestUsage.get_count('ip', ip, date) if ip else 0
    dev_used = await GuestUsage.get_count('device', device, date) if device else 0
    used = max(ip_used, dev_used)
    return {
        'limit': limit,
        'used': used,
        'remaining': max(0, limit - used) if limit > 0 else None,
    }


async def enforce_guest_access(request: Request, user, model_id: str) -> None:
    """Gate a guest chat request. No-op for real users.

    Order: feature-on -> IP blacklist -> allowed model -> per-IP/device daily
    cap (increments both counters on success). Raises HTTPException otherwise.
    """
    if not is_guest_user(user):
        return

    config = request.app.state.config
    if not getattr(config, 'ENABLE_GUEST_ACCESS', False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Guest access is disabled. Please log in.',
        )

    ip = get_client_ip(request)
    device = get_guest_device_id(request)

    if ip and await GuestBlacklist.is_blacklisted(ip):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Access denied.',
        )

    if not guest_model_allowed(config, model_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='This model is not available for guests. Please log in to use it.',
        )

    limit = int(getattr(config, 'GUEST_DAILY_LIMIT', 5) or 0)
    if limit > 0:
        date = _utc_date()
        ip_used = await GuestUsage.get_count('ip', ip, date) if ip else 0
        dev_used = await GuestUsage.get_count('device', device, date) if device else 0
        if ip_used >= limit or dev_used >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail='guest_limit_reached',
            )
        if ip:
            await GuestUsage.increment('ip', ip, date)
        if device:
            await GuestUsage.increment('device', device, date)
