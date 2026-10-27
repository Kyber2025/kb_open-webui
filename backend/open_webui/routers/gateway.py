"""Subscriber-owned Gateway material; identity always comes from the session."""
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict

from open_webui.routers.desktop_keys import _call, _target
from open_webui.utils.auth import get_verified_user
from open_webui.utils.subscription import get_user_tier

router = APIRouter()


class GatewayRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')


async def _subscribed(user) -> bool:
    if user.email == 'guest@guest.local':
        return False
    tier, subscription = await get_user_tier(user.id)
    return bool(subscription and tier and tier.enabled and tier.id != 'free')


async def _subscriber_target(user) -> str:
    if not await _subscribed(user):
        raise HTTPException(403, 'Gateway 需要有效订阅，请先开通或续费。',
                            headers={'Cache-Control': 'no-store'})
    return await _target(user.id)


@router.get('/gateway')
async def gateway_status(request: Request, response: Response, user=Depends(get_verified_user)):
    response.headers['Cache-Control'] = 'no-store'
    if not await _subscribed(user):
        return {'subscribed': False, 'eligible': False, 'keys': [],
                'reason': 'Gateway 需要有效订阅，请先开通或续费。'}
    target = await _target(user.id)
    state = await _call(request, response, 'GET', f'/internal/users/{target}/desktop-keys')
    return {**state, 'subscribed': True}


@router.post('/gateway/keys/{key_id}/download')
async def download_gateway(request: Request, response: Response, key_id: str, form: GatewayRequest,
                           user=Depends(get_verified_user)):
    target = await _subscriber_target(user)
    return await _call(request, response, 'POST',
                       f'/internal/users/{target}/gateway/{quote(key_id, safe="")}/download',
                       {'actorId': user.id})
