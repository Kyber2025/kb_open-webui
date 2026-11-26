"""Personal SSH downloads. Ownership is derived exclusively from the signed-in user."""
import base64
import re
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

@router.get('/transport/{version}/{platform}')
async def transport_binary(version: str, platform: str):
    # Common executable only, no account data. Installers verify a pinned SHA256;
    # scripts and personal TXT retain their authenticated, owner-scoped downloads.
    if platform not in ('windows-amd64', 'windows-arm64', 'darwin-amd64', 'darwin-arm64', 'linux-amd64', 'linux-arm64'):
        raise HTTPException(404, '文件不存在', headers=HEADERS)
    if version != 'v1' and not re.fullmatch(r'[a-f0-9]{64}', version):
        raise HTTPException(404, '文件不存在', headers=HEADERS)
    # Keep v1 downloads compatible with previously issued scripts. New scripts
    # request immutable hash-addressed artifacts, including during rolling deploys.
    path = RESOURCES / 'transport' / platform if version == 'v1' else RESOURCES / 'transport' / version / platform
    if not path.is_file():
        raise HTTPException(503, '连接组件暂不可用', headers=HEADERS)
    return FileResponse(path, filename='transport.exe' if platform.startswith('windows-') else 'transport',
                        media_type='application/octet-stream', headers=HEADERS)

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
    if filename not in ('kividas-ssh-setup.sh', 'kividas-ssh-setup.ps1', 'kividas-ssh-setup.cmd', 'kividas-ssh-guide.html'):
        raise HTTPException(404, '文件不存在', headers=HEADERS)
    # The tutorial is readable before binding; both executable downloads require
    # a current, confirmed binding and an active subscription on every request.
    if filename != 'kividas-ssh-guide.html':
        data = await call(request, response, user)
        if not data.get('workspaces'):
            raise HTTPException(403, '请先开通有效订阅并绑定 SSH 账号', headers=HEADERS)
    if filename == 'kividas-ssh-setup.cmd':
        # One portable download, generated from the same PS1 that we test and
        # serve. The payload has no customer credentials or per-instance data.
        payload = base64.b64encode((RESOURCES / 'kividas-ssh-setup.ps1').read_bytes()).decode('ascii')
        launcher = (RESOURCES / filename).read_text(encoding='ascii').replace('__KIVIDAS_POWERSHELL_BASE64__', payload)
        return Response(launcher.replace('\r\n', '\n').replace('\n', '\r\n').encode('ascii'),
                        media_type='application/octet-stream',
                        headers={**HEADERS, 'Content-Disposition': f'attachment; filename="{filename}"'})
    return FileResponse(RESOURCES / filename, filename=filename, media_type='application/octet-stream', headers=HEADERS)
