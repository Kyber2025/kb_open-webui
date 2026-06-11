"""Code mode — Claude-Code-style coding agent surfaced next to Chat.

The heavy lifting runs off-box: each user drives an ``opencode`` process on the
dedicated sandbox node, fronted by the sandbox-manager. open-webui is a thin
authenticating reverse proxy in front of it:

  browser ──/api/v1/code/sandbox/*──▶ open-webui (this router)
                                         │  + x-sandbox-secret (server secret)
                                         │  + x-sandbox-user:  owui user id
                                         │  + x-kyber-key:     user's sk-or- key
                                         ▼
                                   sandbox-manager (VPC) ──▶ opencode (per user)

The client never holds the sandbox secret or a KyberRouter credential. The
agent calls models through KyberRouter with the *user's own* sk-or- key, so
Mode-B token limits / extra-usage / wallet billing all apply unchanged — Code
mode needs no separate metering.

Gating: requires ENABLE_CODE_MODE, a configured CODE_SANDBOX_SECRET, a linked
KyberRouter key, and a subscription tier at/above CODE_MODE_MIN_TIER_RANK
(Code mode spawns a resident sandbox process per active user, so it is paid by
default)."""

import logging

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from open_webui.config import CODE_SANDBOX_SECRET
from open_webui.utils.auth import get_verified_user
from open_webui.utils.kyber import get_user_kyber_api_key
from open_webui.utils.subscription import get_user_tier, filter_models_by_tier

log = logging.getLogger(__name__)

router = APIRouter()

# Streaming proxy needs a generous read timeout: an agent turn (SSE /event) can
# stay open for minutes. Only the connect timeout is short.
_PROXY_TIMEOUT = aiohttp.ClientTimeout(total=None, connect=10, sock_read=None)

# Hop-by-hop / managed headers we never forward in either direction.
_DROP_REQ_HEADERS = {
    'host', 'content-length', 'connection', 'authorization', 'cookie',
    'x-sandbox-secret', 'x-sandbox-user', 'x-kyber-key',
}
# content-type is re-applied via StreamingResponse(media_type=...), so drop it here
# to avoid a duplicate header.
_DROP_RES_HEADERS = {
    'content-length', 'transfer-encoding', 'connection', 'content-encoding', 'content-type',
}


def _enabled(cfg) -> bool:
    return bool(getattr(cfg, 'ENABLE_CODE_MODE', False)) and bool(CODE_SANDBOX_SECRET)


def _sandbox_base(cfg) -> str:
    return str(getattr(cfg, 'CODE_SANDBOX_URL', 'http://127.0.0.1:8990')).rstrip('/')


async def _require_access(request: Request, user):
    """Resolve (sandbox_base, secret, kyber_key) after enforcing every gate, or
    raise HTTPException. Admins bypass the tier check (they bypass all limits)."""
    cfg = request.app.state.config
    if not _enabled(cfg):
        raise HTTPException(status_code=404, detail='Code mode is not enabled')

    is_admin = getattr(user, 'role', None) == 'admin'
    if not is_admin:
        min_rank = int(getattr(cfg, 'CODE_MODE_MIN_TIER_RANK', 1))
        tier, _ = await get_user_tier(user.id)
        rank = int(getattr(tier, 'sort_order', 0)) if tier else 0
        if rank < min_rank:
            raise HTTPException(
                status_code=403,
                detail='Code mode requires a higher subscription tier',
            )

    key = await get_user_kyber_api_key(user.id)
    if not key:
        raise HTTPException(
            status_code=400,
            detail='Your account is not linked to a wallet yet',
        )
    return _sandbox_base(cfg), CODE_SANDBOX_SECRET, key


@router.get('/config')
async def code_config(request: Request, user=Depends(get_verified_user)):
    """What the Code page needs to render: whether the signed-in user may use it,
    and the model ids allowed for their tier (the picker offers exactly these).
    Never raises — a disallowed user just gets ``{enabled: false}`` so the tab hides."""
    cfg = request.app.state.config
    if not _enabled(cfg):
        return {'enabled': False, 'reason': 'disabled'}

    is_admin = getattr(user, 'role', None) == 'admin'
    tier, _ = await get_user_tier(user.id)
    rank = int(getattr(tier, 'sort_order', 0)) if tier else 0
    min_rank = int(getattr(cfg, 'CODE_MODE_MIN_TIER_RANK', 1))
    if not is_admin and rank < min_rank:
        return {'enabled': False, 'reason': 'tier', 'min_tier_rank': min_rank, 'tier_rank': rank}

    if not await get_user_kyber_api_key(user.id):
        return {'enabled': False, 'reason': 'unlinked'}

    # The sandbox's opencode config exposes these coding models; gate by tier so the
    # picker matches Chat (admin / empty allowlist = all of them).
    code_models = [
        {'id': 'gpt-5.3-codex', 'name': 'GPT-5.3 Codex'},
        {'id': 'gpt-5.5', 'name': 'GPT-5.5'},
        {'id': 'gpt-5.4', 'name': 'GPT-5.4'},
        {'id': 'gpt-5.2', 'name': 'GPT-5.2'},
        {'id': 'claude-opus-4-8', 'name': 'Claude Opus 4.8'},
        {'id': 'claude-sonnet-4-6', 'name': 'Claude Sonnet 4.6'},
    ]
    if not is_admin and tier is not None:
        code_models = filter_models_by_tier(code_models, tier)

    return {'enabled': True, 'models': code_models, 'provider': 'kyberrouter'}


@router.post('/fs/upload')
async def code_fs_upload(request: Request, user=Depends(get_verified_user)):
    """Upload a project zip into the user's sandbox workspace. The raw request
    body is the zip; the manager validates entries (no traversal), enforces the
    quota, and unzips into the workspace root."""
    base, secret, key = await _require_access(request, user)
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail='Empty upload')
    headers = {
        'x-sandbox-secret': secret, 'x-sandbox-user': user.id, 'x-kyber-key': key,
        'content-type': 'application/zip',
    }
    session = aiohttp.ClientSession(timeout=_PROXY_TIMEOUT)
    try:
        resp = await session.request('POST', f'{base}/fs/upload', headers=headers, data=body)
        text = await resp.text()
        return Response(content=text, status_code=resp.status, media_type='application/json')
    except aiohttp.ClientError as e:
        log.warning('Code upload unreachable for %s: %s', user.id, e)
        raise HTTPException(status_code=502, detail='Sandbox is unreachable') from e
    finally:
        await session.close()


@router.get('/fs/download')
async def code_fs_download(request: Request, user=Depends(get_verified_user)):
    """Stream the user's sandbox workspace back as a zip (opencode state dirs and
    node_modules/.git excluded by the manager)."""
    base, secret, key = await _require_access(request, user)
    headers = {'x-sandbox-secret': secret, 'x-sandbox-user': user.id, 'x-kyber-key': key}
    session = aiohttp.ClientSession(timeout=_PROXY_TIMEOUT)
    try:
        resp = await session.request('GET', f'{base}/fs/download', headers=headers)
    except aiohttp.ClientError as e:
        await session.close()
        log.warning('Code download unreachable for %s: %s', user.id, e)
        raise HTTPException(status_code=502, detail='Sandbox is unreachable') from e
    if resp.status != 200:
        text = await resp.text()
        await session.close()
        raise HTTPException(status_code=resp.status, detail=(text[:200] or 'download failed'))

    async def stream():
        try:
            async for chunk in resp.content.iter_any():
                yield chunk
        finally:
            resp.release()
            await session.close()

    return StreamingResponse(
        stream(),
        media_type='application/zip',
        headers={'content-disposition': resp.headers.get(
            'Content-Disposition', 'attachment; filename="workspace.zip"')},
    )


@router.api_route(
    '/sandbox/{path:path}',
    methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
)
async def code_sandbox_proxy(request: Request, path: str, user=Depends(get_verified_user)):
    """Authenticating reverse proxy to the sandbox-manager's ``/u/*`` surface.

    Forwards method, path, query, body and streams the response back verbatim
    (so opencode's SSE ``/event`` stream and chunked tool output pass through).
    The acting identity is asserted by trusted server-set headers; the upstream
    URL is fixed, so the client cannot pivot to another user or host."""
    base, secret, key = await _require_access(request, user)

    upstream = f'{base}/u/{path}'
    if request.url.query:
        upstream = f'{upstream}?{request.url.query}'

    fwd_headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _DROP_REQ_HEADERS
    }
    fwd_headers['x-sandbox-secret'] = secret
    fwd_headers['x-sandbox-user'] = user.id
    fwd_headers['x-kyber-key'] = key

    body = await request.body()

    session = aiohttp.ClientSession(timeout=_PROXY_TIMEOUT)
    try:
        resp = await session.request(
            request.method, upstream, headers=fwd_headers, data=body or None,
        )
    except aiohttp.ClientError as e:
        await session.close()
        log.warning('Code sandbox unreachable for %s: %s', user.id, e)
        raise HTTPException(status_code=502, detail='Sandbox is unreachable') from e

    async def stream():
        try:
            async for chunk in resp.content.iter_any():
                yield chunk
        finally:
            resp.release()
            await session.close()

    out_headers = {
        k: v for k, v in resp.headers.items() if k.lower() not in _DROP_RES_HEADERS
    }
    return StreamingResponse(
        stream(),
        status_code=resp.status,
        headers=out_headers,
        media_type=resp.headers.get('Content-Type'),
    )
