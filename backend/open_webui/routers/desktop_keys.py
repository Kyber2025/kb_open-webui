"""Admin-only desktop credentials. The browser never receives the Chat key."""
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from open_webui.models.users import Users
from open_webui.models.kyber_accounts import UserKyberAccounts
from open_webui.utils.auth import get_admin_user
from open_webui.utils.kyber import _internal_request

router = APIRouter()


class DesktopKeyPolicy(BaseModel):
    model_config = ConfigDict(extra='forbid')
    concurrentLimit: int = Field(default=0, ge=0, le=2147483647, strict=True)


class DesktopKeyCreate(DesktopKeyPolicy):
    model_config = ConfigDict(extra='forbid')
    label: str = Field(default='Claude Desktop', min_length=1, max_length=80)


async def _target(user_id: str) -> str:
    if not await Users.get_user_by_id(user_id):
        raise HTTPException(404, 'User not found')
    link = await UserKyberAccounts.get_by_user_id(user_id)
    if not link or not link.kyber_user_id:
        raise HTTPException(409, '该用户尚未关联平台账号，请先让用户登录 Chat。')
    return quote(link.kyber_user_id, safe='')


async def _call(request: Request, response: Response, method: str, path: str, payload=None):
    response.headers['Cache-Control'] = 'no-store'
    status, data = await _internal_request(request, method, path, payload)
    if status != 200:
        # Never expose transport diagnostics, headers, or upstream credentials.
        message = data.get('message') if 400 <= status < 500 else None
        raise HTTPException(status if 400 <= status < 500 else 503,
                            message if isinstance(message, str) else '桌面 Key 服务暂不可用，请稍后重试',
                            headers={'Cache-Control': 'no-store'})
    return data


@router.get('/admin/users/{user_id}/desktop-keys')
async def list_keys(request: Request, response: Response, user_id: str, user=Depends(get_admin_user)):
    target = await _target(user_id)
    return await _call(request, response, 'GET', f'/internal/users/{target}/desktop-keys')


@router.post('/admin/users/{user_id}/desktop-keys')
async def create_key(request: Request, response: Response, user_id: str, form: DesktopKeyCreate, user=Depends(get_admin_user)):
    target = await _target(user_id)
    return await _call(request, response, 'POST', f'/internal/users/{target}/desktop-keys',
                       {'label': form.label.strip(), 'actorId': user.id, 'concurrentLimit': form.concurrentLimit})


@router.post('/admin/users/{user_id}/desktop-keys/{key_id}/revoke')
async def revoke_key(request: Request, response: Response, user_id: str, key_id: str, user=Depends(get_admin_user)):
    target = await _target(user_id)
    return await _call(request, response, 'POST',
                       f'/internal/users/{target}/desktop-keys/{quote(key_id, safe="")}/revoke', {'actorId': user.id})


@router.post('/admin/users/{user_id}/desktop-keys/{key_id}/reveal')
async def reveal_key(request: Request, response: Response, user_id: str, key_id: str, user=Depends(get_admin_user)):
    target = await _target(user_id)
    return await _call(request, response, 'POST',
                       f'/internal/users/{target}/desktop-keys/{quote(key_id, safe="")}/reveal', {'actorId': user.id})


@router.post('/admin/users/{user_id}/desktop-keys/{key_id}/delete')
async def delete_key(request: Request, response: Response, user_id: str, key_id: str, user=Depends(get_admin_user)):
    target = await _target(user_id)
    return await _call(request, response, 'POST',
                       f'/internal/users/{target}/desktop-keys/{quote(key_id, safe="")}/delete', {'actorId': user.id})


@router.post('/admin/users/{user_id}/desktop-keys/{key_id}/policy')
async def update_policy(request: Request, response: Response, user_id: str, key_id: str, form: DesktopKeyPolicy, user=Depends(get_admin_user)):
    target = await _target(user_id)
    return await _call(request, response, 'POST',
                       f'/internal/users/{target}/desktop-keys/{quote(key_id, safe="")}/policy',
                       {'actorId': user.id, 'concurrentLimit': form.concurrentLimit})
