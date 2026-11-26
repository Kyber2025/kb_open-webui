"""Personal SSH downloads. Ownership is derived exclusively from the signed-in user."""
from pathlib import Path
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from open_webui.routers.desktop_keys import _target
from open_webui.utils.auth import get_verified_user
from open_webui.utils.kyber import _internal_request

router = APIRouter()
RESOURCES = Path(__file__).resolve().parents[1] / 'resources' / 'workspace'
HEADERS = {'Cache-Control': 'private, no-store', 'Vary': 'Authorization, Cookie', 'X-Content-Type-Options': 'nosniff'}

class DownloadRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

async def call(request, response, user, method='GET', instance=None):
    response.headers.update(HEADERS)
    if user.email == 'guest@guest.local':
        raise HTTPException(403, '请登录并绑定 SSH 账号', headers=HEADERS)
    try:
        target = await _target(user.id)
    except HTTPException as error:
        if method == 'GET' and error.status_code == 409:
            return {'workspaces': [], 'reason': '请联系管理员绑定 SSH 账号'}
        raise
    path = f'/internal/users/{target}/ssh-workspaces'
    if instance is not None:
        path += '/' + quote(instance, safe='') + '/download'
    status, data = await _internal_request(request, method, path, {})
    if status != 200:
        message = data.get('message') if 400 <= status < 500 else None
        raise HTTPException(status if 400 <= status < 500 else 503,
                            message if isinstance(message, str) else 'SSH 服务暂不可用，请稍后重试', headers=HEADERS)
    return data

@router.get('')
async def status(request: Request, response: Response, user=Depends(get_verified_user)):
    return await call(request, response, user)

@router.post('/{instance_id}/download')
async def download(request: Request, response: Response, instance_id: str, form: DownloadRequest, user=Depends(get_verified_user)):
    return await call(request, response, user, 'POST', instance_id)

@router.get('/resources/{filename}')
async def resource(request: Request, response: Response, filename: str, user=Depends(get_verified_user)):
    if filename not in ('kividas-ssh-setup.sh', 'kividas-ssh-setup.ps1', 'kividas-ssh-guide.html'):
        raise HTTPException(404, '文件不存在', headers=HEADERS)
    # The tutorial is readable before binding; both executable downloads require
    # a current, confirmed binding and an active subscription on every request.
    if filename != 'kividas-ssh-guide.html':
        data = await call(request, response, user)
        if not data.get('workspaces'):
            raise HTTPException(403, '请先开通有效订阅并绑定 SSH 账号', headers=HEADERS)
    return FileResponse(RESOURCES / filename, filename=filename, media_type='application/octet-stream', headers=HEADERS)
