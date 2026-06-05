"""KyberRouter account/billing endpoints surfaced to the open-webui client
(SESSION-HANDOFF §12.7). KyberRouter is the wallet/billing source of truth; these
read-only proxies let the chat UI show the signed-in user's balance and usage
without the client ever holding a KyberRouter credential — the request is made
server-side with the user's stored sk-or- key."""

import logging
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request

from open_webui.utils.auth import get_verified_user
from open_webui.utils.kyber import get_user_usage_summary

log = logging.getLogger(__name__)

router = APIRouter()


def _topup_url(request: Request) -> str | None:
    """KyberRouter's top-up page, derived from the billing base URL host so the
    client never hardcodes the domain. e.g. https://ai.kividas.com/topup."""
    base = getattr(request.app.state.config, 'KYBER_BILLING_BASE_URL', '') or ''
    host = urlparse(base).hostname if base else None
    return f'https://{host}/topup' if host else None


@router.get('/usage')
async def kyber_usage(request: Request, user=Depends(get_verified_user)):
    """P3: the signed-in user's KyberRouter wallet balance + token usage for the
    bottom-right widget.

    Returns ``{linked: false}`` when the user has no KyberRouter key yet (e.g. a
    local admin or a pre-bridge account) or KyberRouter is unreachable — the
    widget then simply hides. On success: ``{linked: true, today, thisMonth,
    total, credits, topup_url}`` (credits = USD wallet balance)."""
    summary = await get_user_usage_summary(request, user)
    if summary is None:
        return {'linked': False}
    return {'linked': True, 'topup_url': _topup_url(request), **summary}
