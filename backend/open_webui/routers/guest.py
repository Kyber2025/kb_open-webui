"""Guest (anonymous) access — admin config, IP blacklist, and a status probe.

Admin endpoints manage the feature (enable, daily cap, allowed/blocked models)
and the IP blacklist. The `/status` endpoint lets the frontend show a guest
their remaining daily quota.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from open_webui.models.guest import GuestBlacklist, GuestIpBlacklistModel
from open_webui.utils.auth import get_admin_user, get_verified_user
from open_webui.utils.guest import guest_usage_status, is_guest_user

log = logging.getLogger(__name__)

router = APIRouter()


def _config_dict(c) -> dict:
    return {
        'ENABLE_GUEST_ACCESS': bool(getattr(c, 'ENABLE_GUEST_ACCESS', False)),
        'GUEST_DAILY_LIMIT': int(getattr(c, 'GUEST_DAILY_LIMIT', 5) or 0),
        'GUEST_ALLOWED_MODEL_IDS': list(getattr(c, 'GUEST_ALLOWED_MODEL_IDS', None) or []),
        'GUEST_BLOCKED_MODEL_IDS': list(getattr(c, 'GUEST_BLOCKED_MODEL_IDS', None) or []),
    }


class GuestConfigForm(BaseModel):
    ENABLE_GUEST_ACCESS: bool
    GUEST_DAILY_LIMIT: int
    GUEST_ALLOWED_MODEL_IDS: list[str] = []
    GUEST_BLOCKED_MODEL_IDS: list[str] = []


@router.get('/config')
async def get_guest_config(request: Request, user=Depends(get_admin_user)):
    return _config_dict(request.app.state.config)


@router.post('/config')
async def update_guest_config(
    request: Request, form_data: GuestConfigForm, user=Depends(get_admin_user)
):
    c = request.app.state.config
    # Assigning through AppConfig persists each ConfigVar to the DB.
    c.ENABLE_GUEST_ACCESS = bool(form_data.ENABLE_GUEST_ACCESS)
    c.GUEST_DAILY_LIMIT = max(0, int(form_data.GUEST_DAILY_LIMIT))
    c.GUEST_ALLOWED_MODEL_IDS = form_data.GUEST_ALLOWED_MODEL_IDS or []
    c.GUEST_BLOCKED_MODEL_IDS = form_data.GUEST_BLOCKED_MODEL_IDS or []
    return _config_dict(c)


@router.get('/blacklist', response_model=list[GuestIpBlacklistModel])
async def list_blacklist(user=Depends(get_admin_user)):
    return await GuestBlacklist.list()


class BlacklistAddForm(BaseModel):
    ip: str
    reason: Optional[str] = None


@router.post('/blacklist', response_model=GuestIpBlacklistModel)
async def add_blacklist(form_data: BlacklistAddForm, user=Depends(get_admin_user)):
    row = await GuestBlacklist.add(form_data.ip, form_data.reason, created_by=user.id)
    if not row:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail='Invalid IP address')
    return row


@router.delete('/blacklist/{ip}')
async def remove_blacklist(ip: str, user=Depends(get_admin_user)):
    ok = await GuestBlacklist.remove(ip)
    return {'success': bool(ok)}


@router.get('/status')
async def guest_status(request: Request, user=Depends(get_verified_user)):
    """Remaining daily quota for the current session (meaningful for guests)."""
    data = await guest_usage_status(request, user)
    data['enabled'] = bool(getattr(request.app.state.config, 'ENABLE_GUEST_ACCESS', False))
    data['is_guest'] = is_guest_user(user)
    return data
