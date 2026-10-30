"""Additional entry-point restrictions; account-level commerce policy remains authoritative."""
from fastapi import HTTPException


def is_reseller_portal(request):
    return getattr(request, 'headers', {}).get('host', '').lower().split(':')[0] == 'proxy.kividas.com'


async def require_portal_user(request, user, db=None):
    if not is_reseller_portal(request):
        return
    from open_webui.models.reseller_invites import ResellerInvites
    if not user or not await ResellerInvites.is_customer(user.id, db=db):
        raise HTTPException(403, '此入口仅供代理邀请客户使用，请使用受邀账号登录。')


async def require_portal_registration(request, email, token=None, db=None):
    if not is_reseller_portal(request):
        return
    from open_webui.models.reseller_invites import ResellerInvites
    if not await ResellerInvites.registration_invite(email, token, db=db):
        raise HTTPException(403, '请通过服务商提供的邀请链接注册。')
