"""KyberRouter account/billing endpoints surfaced to the open-webui client
(SESSION-HANDOFF §12.7). KyberRouter is the wallet/billing source of truth; these
read-only proxies let the chat UI show the signed-in user's balance and usage
without the client ever holding a KyberRouter credential — the request is made
server-side with the user's stored sk-or- key."""

import logging
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from open_webui.utils.auth import get_verified_user
from open_webui.utils.kyber import (
    get_user_usage_summary,
    kyber_topup_create,
    kyber_topup_status,
)

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


class TopUpForm(BaseModel):
    amount_usd: float
    chain_id: str


@router.post('/topup')
async def kyber_topup(request: Request, form_data: TopUpForm, user=Depends(get_verified_user)):
    """P5: create a USDT top-up for the signed-in user (proxied server-side with
    their sk-or- key, so KyberRouter credits their wallet). Returns the deposit
    {id, address, qrCodeImage, usdtAmount, chainId, status}."""
    status_code, data = await kyber_topup_create(request, user, form_data.amount_usd, form_data.chain_id)
    if status_code != 200:
        raise HTTPException(
            status_code=(status_code if 400 <= status_code < 600 else 502),
            detail=(data.get('message') or data.get('error') or 'Top-up failed'),
        )
    return data


@router.get('/topup/{topup_id}')
async def kyber_topup_poll(request: Request, topup_id: str, user=Depends(get_verified_user)):
    """P5: poll a top-up's status. KyberRouter credits the wallet exactly once on PAID."""
    status_code, data = await kyber_topup_status(request, user, topup_id)
    if status_code != 200:
        raise HTTPException(status_code=(404 if status_code == 404 else 502), detail='Top-up not found')
    return data
