"""A positive allow-list keeps price and payment metadata out of customer responses."""
from fastapi import HTTPException
from open_webui.models.reseller_invites import ResellerInvites

TIER_FIELDS = frozenset(('id', 'name', 'duration_days', 'daily_message_limit',
    'token_limit_5h', 'token_limit_week', 'allowed_model_ids', 'enabled', 'sort_order'))
SUBSCRIPTION_FIELDS = frozenset(('id', 'tier_id', 'expires_at', 'created_at', 'updated_at'))


def customer_state(state):
    result = dict(state)
    if state.get('tier'):
        result['tier'] = {key: value for key, value in state['tier'].items() if key in TIER_FIELDS}
    if state.get('subscription'):
        result['subscription'] = {key: value for key, value in state['subscription'].items() if key in SUBSCRIPTION_FIELDS}
    result['commerce'] = {'show_prices': False, 'can_purchase': False, 'managed_by_reseller': True}
    return result


async def require_direct_purchase(user):
    if await ResellerInvites.is_customer(user.id):
        raise HTTPException(403, '此账号由服务商管理，请使用兑换码或联系服务商续费。')
