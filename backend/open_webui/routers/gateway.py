"""Subscriber-owned Gateway material; identity always comes from the session."""
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from open_webui.routers.desktop_keys import _call, _target, customer_material, customer_usage_url
from open_webui.utils.auth import get_verified_user
from open_webui.utils.subscription import get_user_tier

router = APIRouter()

RESOURCE_FILES = {
    'claude-desktop-macos.pdf': 'application/pdf',
    'claude-desktop-windows.pdf': 'application/pdf',
    'claude-code-cli.pdf': 'application/pdf',
    'kividas-gateway-setup-r3.zip': 'application/zip',
}


@router.get('/gateway/resources/{filename}')
async def download_resource(filename: str, user=Depends(get_verified_user)):
    from open_webui.env import FRONTEND_BUILD_DIR
    if filename not in RESOURCE_FILES:
        raise HTTPException(404, '资料不存在')
    origin = await customer_usage_url(user.id)
    folder = FRONTEND_BUILD_DIR / 'gateway'
    if origin == 'https://proxy.kividas.com/':
        folder = folder / 'reseller'
    path = folder / filename
    if not path.is_file():
        raise HTTPException(503, '资料暂不可用，请稍后重试')
    return FileResponse(path, media_type=RESOURCE_FILES[filename], filename=filename,
                        headers={'Cache-Control': 'private, no-store', 'Vary': 'Authorization, Cookie'})


class GatewayRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')


class GatewayCreate(GatewayRequest):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    label: str = Field(default='Claude Desktop', min_length=1, max_length=80)


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
    usage_url = await customer_usage_url(user.id)
    if not await _subscribed(user):
        return {'subscribed': False, 'eligible': False, 'canCreate': False, 'keys': [],
                'usageUrl': usage_url,
                'reason': 'Gateway 需要有效订阅，请先开通或续费。'}
    target = await _target(user.id)
    state = await _call(request, response, 'GET', f'/internal/users/{target}/gateway')
    return {**state, 'subscribed': True, 'usageUrl': usage_url}


@router.post('/gateway/keys')
async def create_gateway(request: Request, response: Response, form: GatewayCreate,
                         user=Depends(get_verified_user)):
    target = await _subscriber_target(user)
    data = await _call(request, response, 'POST', f'/internal/users/{target}/gateway',
                       {'label': form.label, 'actorId': user.id})
    return await customer_material(data, user.id)


@router.post('/gateway/keys/{key_id}/download')
async def download_gateway(request: Request, response: Response, key_id: str, form: GatewayRequest,
                           user=Depends(get_verified_user)):
    target = await _subscriber_target(user)
    data = await _call(request, response, 'POST',
                       f'/internal/users/{target}/gateway/{quote(key_id, safe="")}/download',
                       {'actorId': user.id})
    return await customer_material(data, user.id)
