"""Kividas Code desktop-client download metadata for the /code page.

Server-side proxy for the desktop release feeds on dl.kividas.com so the browser can
show the latest version + installer URL per platform without a cross-origin fetch —
the CDN serves those files without a CORS header, so a direct client fetch from
chat.kividas.com would be blocked. Result is cached ~10 min; on any failure the client
falls back to its bundled KIVIDAS_CODE_* constants.

Two feeds, different jobs:
  * ``downloads.json`` — per-platform *installer* index, which is what this page wants:
    each platform carries its own version, so a Windows-only or macOS-only release
    never hides the other platform's download. Written by publish.sh on every release.
  * ``latest.json`` — the Tauri updater manifest, single-version by design: platform
    entries that are not part of that release get dropped on purpose (a stale entry
    would make clients reinstall an old build in a loop). Used here only as a Windows
    fallback so this endpoint still works if downloads.json is ever missing."""

import logging
import time

import aiohttp
from fastapi import APIRouter, Depends

from open_webui.utils.auth import get_verified_user

log = logging.getLogger(__name__)

router = APIRouter()

_BASE_URL = 'https://dl.kividas.com'
_DOWNLOADS_URL = f'{_BASE_URL}/downloads.json'
# Tauri updater feed — tauri.conf.json → plugins.updater.endpoints points here too.
_MANIFEST_URL = f'{_BASE_URL}/latest.json'
_TIMEOUT = aiohttp.ClientTimeout(total=10)
_CACHE_TTL_S = 600  # 10 minutes

# Feed platform key -> key exposed to the client.
_PLATFORM_KEYS = {
    'windows-x86_64': 'windows',
    'darwin-aarch64': 'mac',
}

_cache: dict = {}  # {'exp': float, 'data': <response payload>}


async def _get_json(url: str):
    """GET + parse JSON, or ``None`` when unreachable/non-200/malformed."""
    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    return None
                return await resp.json(content_type=None)
    except Exception as e:
        log.warning('Kividas Code feed fetch failed (%s): %s', url, e)
        return None


def _entry(raw, fallback_version=None) -> dict | None:
    """Normalize one platform entry to ``{version, url}``."""
    if not isinstance(raw, dict):
        return None
    version = raw.get('version') or fallback_version
    url = raw.get('url')
    if not version or not url:
        return None
    return {'version': str(version), 'url': str(url)}


async def _fetch_platforms() -> dict | None:
    """Latest installer per platform as ``{'windows': {...}, 'mac': {...}}``.
    Returns ``None`` only when nothing at all could be resolved."""
    platforms: dict = {}

    data = await _get_json(_DOWNLOADS_URL)
    if isinstance(data, dict):
        for feed_key, out_key in _PLATFORM_KEYS.items():
            entry = _entry((data.get('platforms') or {}).get(feed_key))
            if entry:
                platforms[out_key] = entry

    # Fallback: derive Windows from the updater manifest if downloads.json lacked it.
    if 'windows' not in platforms:
        manifest = await _get_json(_MANIFEST_URL)
        if isinstance(manifest, dict):
            entry = _entry(
                (manifest.get('platforms') or {}).get('windows-x86_64'),
                fallback_version=manifest.get('version'),
            )
            if entry:
                platforms['windows'] = entry

    return platforms or None


@router.get('/latest')
async def code_latest(user=Depends(get_verified_user)):
    """Latest Kividas Code installer per platform, proxied from the dl.kividas.com
    feeds and cached ~10 min.

    Returns ``{version, url, platforms: {windows: {version, url}, mac: {...}}}``. The
    top-level ``version``/``url`` mirror the Windows entry and exist only so a browser
    still running the previous page bundle keeps working during a rollout. On a feed
    failure the last good value is served, else nulls so the client falls back to its
    bundled constants."""
    now = time.time()
    cached = _cache.get('data')
    if cached and _cache.get('exp', 0) > now:
        return cached

    platforms = await _fetch_platforms()
    if platforms is None:
        return cached or {'version': None, 'url': None, 'platforms': {}}

    windows = platforms.get('windows') or {}
    payload = {
        'version': windows.get('version'),
        'url': windows.get('url'),
        'platforms': platforms,
    }
    _cache['data'] = payload
    _cache['exp'] = now + _CACHE_TTL_S
    return payload
