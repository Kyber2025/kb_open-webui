"""Kividas Code desktop-client download metadata for the /code page.

Server-side proxy for the Tauri auto-updater manifest (dl.kividas.com/latest.json)
so the browser can show the latest desktop version + installer URL without a
cross-origin fetch — the CDN serves the manifest without a CORS header, so a direct
client fetch from chat.kividas.com would be blocked. Result is cached ~10 min; on
any failure the client falls back to its bundled KIVIDAS_CODE_* constants."""

import logging
import time

import aiohttp
from fastapi import APIRouter, Depends

from open_webui.utils.auth import get_verified_user

log = logging.getLogger(__name__)

router = APIRouter()

# Tauri updater feed — single source of truth for the latest desktop release
# (tauri.conf.json → plugins.updater.endpoints points here too).
_MANIFEST_URL = 'https://dl.kividas.com/latest.json'
_TIMEOUT = aiohttp.ClientTimeout(total=10)
_CACHE_TTL_S = 600  # 10 minutes

_cache: dict = {}  # {'exp': float, 'data': {'version', 'url'}}


async def _fetch_latest() -> dict | None:
    """Fetch + normalize the Windows release from the updater manifest.
    Returns ``{version, url}`` or ``None`` when unreachable/malformed."""
    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.get(_MANIFEST_URL) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json(content_type=None)
    except Exception as e:
        log.warning('Kividas Code manifest fetch failed: %s', e)
        return None
    if not isinstance(data, dict):
        return None
    version = data.get('version')
    win = ((data.get('platforms') or {}).get('windows-x86_64')) or {}
    url = win.get('url')
    if not version or not url:
        return None
    return {'version': str(version), 'url': str(url)}


@router.get('/latest')
async def code_latest(user=Depends(get_verified_user)):
    """Latest Kividas Code (Windows) version + installer URL, proxied from the
    Tauri updater feed and cached ~10 min. Returns ``{version, url}``; on a feed
    failure serves the last good value, else ``{version: null, url: null}`` so the
    client falls back to its bundled constant."""
    now = time.time()
    cached = _cache.get('data')
    if cached and _cache.get('exp', 0) > now:
        return cached
    fresh = await _fetch_latest()
    if fresh is None:
        return cached or {'version': None, 'url': None}
    _cache['data'] = fresh
    _cache['exp'] = now + _CACHE_TTL_S
    return fresh
