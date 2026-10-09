"""Use the signed-in Kividas account for the four mobile billing operations.

Gateway tokens are introspected on every request, never decoded locally or
exchanged for a general WebUI session. Identity comes only from the configured
account service; a caller cannot choose a billing user ID or email.
"""
import time
import uuid

import aiohttp
from fastapi import HTTPException, Request
from sqlalchemy import func, select, text

from open_webui.internal.db import get_async_db_context
from open_webui.models.auths import Auth
from open_webui.models.kyber_accounts import UserKyberAccount
from open_webui.models.users import User, UserModel
from open_webui.utils.auth import get_password_hash
from open_webui.utils.kyber import kyber_base


async def gateway_identity(request: Request) -> dict:
    if not getattr(request.app.state.config, 'ENABLE_KYBER_AUTH_BRIDGE', False):
        raise HTTPException(403, 'Account bridge is disabled')
    authorization = request.headers.get('authorization', '')
    scheme, _, token = authorization.partition(' ')
    if scheme.lower() != 'bearer' or not token or len(token) > 8192 or any(c.isspace() for c in token):
        raise HTTPException(401, 'Kividas login required')
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            async with session.get(
                kyber_base(request) + '/auth/me',
                headers={'Authorization': 'Bearer ' + token},
                allow_redirects=False,
            ) as response:
                if response.status in (401, 403, 404):
                    raise HTTPException(403 if response.status == 403 else 401, 'Kividas login is not active')
                if response.status != 200:
                    raise HTTPException(503, 'Account service temporarily unavailable')
                data = await response.json()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, 'Account service temporarily unavailable') from None
    user = data.get('user') if isinstance(data, dict) else None
    if not isinstance(user, dict) or not isinstance(user.get('id'), str) or not user['id'] or not isinstance(user.get('email'), str) or '@' not in user['email']:
        raise HTTPException(503, 'Account service returned an invalid identity')
    return user


async def resolve_billing_user(identity: dict):
    """Resolve stable account linkage, with atomic first-use shadow provisioning.

    Only an unlinked ordinary account may be linked by its authoritative email.
    Existing links are never reassigned; local pending/disabled/admin accounts
    cannot be claimed by first-use provisioning. No API key is minted here.
    """
    kyber_id = identity['id']
    email = identity['email'].strip().lower()
    async with get_async_db_context() as db:
        # The production PostgreSQL lock serializes first use across both nodes.
        if db.bind.dialect.name == 'postgresql':
            await db.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'),
                             {'key': 'mobile-subscription:' + kyber_id})
        links = (await db.execute(select(UserKyberAccount).where(
            UserKyberAccount.kyber_user_id == kyber_id))).scalars().all()
        if len(links) > 1:
            raise HTTPException(409, '订阅账号关联异常，请联系客服。')
        if links:
            user = await db.get(User, links[0].user_id)
        else:
            user = (await db.execute(select(User).where(func.lower(User.email) == email).with_for_update())).scalars().first()
            if user:
                existing = await db.get(UserKyberAccount, user.id)
                if existing or user.role != 'user':
                    raise HTTPException(409, '订阅账号关联异常，请联系客服。')
            else:
                now = int(time.time())
                user = User(id=str(uuid.uuid4()), email=email, role='user',
                            name=str(identity.get('name') or email.split('@')[0]),
                            profile_image_url='/user.png', created_at=now,
                            updated_at=now, last_active_at=now)
                db.add(user)
                db.add(Auth(id=user.id, email=email, active=True,
                            password=get_password_hash(str(uuid.uuid4()))))
            now = int(time.time())
            db.add(UserKyberAccount(user_id=user.id, kyber_user_id=kyber_id,
                                   kyber_email=email, extra_usage_enabled=False,
                                   created_at=now, updated_at=now))
            await db.flush()
        credential = await db.get(Auth, user.id) if user else None
        if not user or user.role not in {'user', 'admin'} or not credential or not credential.active:
            raise HTTPException(403, 'Subscription account is not active')
        result = UserModel.model_validate(user)
        await db.commit()
        return result


async def get_mobile_subscription_user(request: Request):
    return await resolve_billing_user(await gateway_identity(request))
