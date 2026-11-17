"""Admin-only request admission controls; credentials stay on the server."""
from typing import Literal
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from open_webui.utils.auth import get_admin_user
from open_webui.utils.kyber import _internal_request

router = APIRouter(prefix='/admin/risk', dependencies=[Depends(get_admin_user)])


async def write_guard(request: Request):
    if not request.headers.get('authorization', '').startswith('Bearer '):
        raise HTTPException(401, '请重新登录后操作')
    origin = request.headers.get('origin')
    if origin and urlsplit(origin).netloc != request.headers.get('host'):
        raise HTTPException(403, '不允许跨站修改')


class StrictForm(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RiskRule(StrictForm):
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,64}$')
    name: str = Field(min_length=1, max_length=100)
    enabled: bool = Field(strict=True)
    action: Literal['block', 'observe']
    groups: list[list[str]] = Field(min_length=1, max_length=8)


class Policy(StrictForm):
    enabled: bool = Field(strict=True)
    rules: list[RiskRule] = Field(max_length=32)


class PolicyUpdate(StrictForm):
    version: int = Field(ge=1, strict=True)
    config: Policy
    reason: str = Field(min_length=3, max_length=500)


class OverrideUpdate(StrictForm):
    email: str = Field(min_length=3, max_length=254)
    mode: Literal['block', 'allow', 'inherit']
    version: int = Field(ge=0, strict=True)
    expiresAt: str | None = Field(default=None, max_length=40)
    reason: str = Field(min_length=3, max_length=500)


class TestRule(StrictForm):
    config: Policy
    text: str = Field(max_length=500000)


async def call(request, response, method, path, body=None):
    response.headers['Cache-Control'] = 'no-store'
    status, data = await _internal_request(request, method, '/internal/risk/' + path, body)
    if status != 200:
        message = data.get('message') if 400 <= status < 500 else None
        raise HTTPException(status if 400 <= status < 500 else 503,
                            message if isinstance(message, str) else '风控服务暂不可用，请稍后重试',
                            headers={'Cache-Control': 'no-store'})
    return data


@router.get('/policy')
async def policy(request: Request, response: Response):
    return await call(request, response, 'GET', 'policy')


@router.put('/policy', dependencies=[Depends(write_guard)])
async def update_policy(request: Request, response: Response, form: PolicyUpdate, user=Depends(get_admin_user)):
    return await call(request, response, 'PUT', 'policy', {**form.model_dump(), 'actorId': 'owui:' + user.id})


@router.get('/events')
async def events(request: Request, response: Response, page: int = Query(1, ge=1, le=10000),
                 search: str = Query('', max_length=200), action: str = Query('', max_length=40)):
    return await call(request, response, 'GET', 'events?' + urlencode({'page': page, 'search': search, 'action': action}))


@router.get('/overrides')
async def overrides(request: Request, response: Response, page: int = Query(1, ge=1, le=10000), search: str = Query('', max_length=200)):
    return await call(request, response, 'GET', 'overrides?' + urlencode({'page': page, 'search': search}))


@router.put('/override', dependencies=[Depends(write_guard)])
async def update_override(request: Request, response: Response, form: OverrideUpdate, user=Depends(get_admin_user)):
    return await call(request, response, 'PUT', 'override', {**form.model_dump(), 'actorId': 'owui:' + user.id})


@router.post('/test', dependencies=[Depends(write_guard)])
async def test_rule(request: Request, response: Response, form: TestRule):
    return await call(request, response, 'POST', 'test', form.model_dump())
