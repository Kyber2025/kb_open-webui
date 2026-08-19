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


# ── Kividas CLI (standalone terminal) ─────────────────────────────────────────
# The launcher + Claude Code mirror published by desktop-cc-gui/scripts/release/
# publish-cli.sh. Same CORS story as the desktop feeds, hence the proxy.
_CLI_MANIFEST_URL = f'{_BASE_URL}/cli/latest.json'
_CLI_INSTALL_SH = f'{_BASE_URL}/cli/install.sh'
_CLI_INSTALL_PS1 = f'{_BASE_URL}/cli/install.ps1'
_CLI_PLATFORM_KEYS = {
    'darwin-universal': 'mac',
    'windows-x64': 'windows',
    'linux-x64': 'linux_x64',
    'linux-arm64': 'linux_arm64',
}
_cli_cache: dict = {}


@router.get('/cli')
async def code_cli(user=Depends(get_verified_user)):
    """Latest standalone Kividas CLI, proxied from dl.kividas.com/cli/latest.json and
    cached ~10 min. Returns ``{version, claude_version, install: {sh, ps1}, platforms:
    {mac|windows|linux_x64|linux_arm64: {url, sha256}}}``; ``version`` is null when the
    feed is unreachable and nothing was cached, so the page can still show the one-line
    install commands (those URLs never change)."""
    now = time.time()
    cached = _cli_cache.get('data')
    if cached and _cli_cache.get('exp', 0) > now:
        return cached

    base = {
        'version': None,
        'claude_version': None,
        'install': {
            'sh': f'curl -fsSL {_CLI_INSTALL_SH} | sh',
            'ps1': f'irm {_CLI_INSTALL_PS1} | iex',
        },
        'platforms': {},
    }
    manifest = await _get_json(_CLI_MANIFEST_URL)
    if not isinstance(manifest, dict):
        return cached or base

    launcher = manifest.get('launcher') or {}
    claude = manifest.get('claude') or {}
    platforms: dict = {}
    for feed_key, out_key in _CLI_PLATFORM_KEYS.items():
        raw = (launcher.get('platforms') or {}).get(feed_key)
        if isinstance(raw, dict) and raw.get('url'):
            # macOS: the browser download is "Kividas CLI.app" (signed, notarized,
            # stapled) — Gatekeeper lets Finder open only bundles, never a bare
            # executable, however it is signed. Double-clicking the app installs
            # the CLI into ~/.kividas/bin and opens a Terminal.
            url, sha = raw['url'], raw.get('sha256')
            if out_key == 'mac':
                if raw.get('app_url'):
                    url, sha = raw['app_url'], raw.get('app_sha256')
                elif raw.get('zip_url'):
                    url, sha = raw['zip_url'], raw.get('zip_sha256')
            platforms[out_key] = {'url': str(url), 'sha256': sha}
    payload = {
        **base,
        'version': launcher.get('version'),
        'claude_version': claude.get('version'),
        'platforms': platforms,
    }
    _cli_cache['data'] = payload
    _cli_cache['exp'] = now + _CACHE_TTL_S
    return payload
