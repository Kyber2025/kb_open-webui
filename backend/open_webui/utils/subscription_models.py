"""Publish the subscription editor's model policies to the inference gateway."""
import logging
import aiohttp

log = logging.getLogger(__name__)


async def load_model_catalog(request):
    """Public model metadata, independent of the viewer's inference entitlement."""
    from open_webui.utils.kyber import kyber_base
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
        async with session.get(f'{kyber_base(request)}/v1/models') as response:
            if response.status != 200:
                raise ValueError('Catalog unavailable')
            data = await response.json()
            if not isinstance(data.get('data'), list):
                raise ValueError('Invalid catalog')
            return [{'id': m['id'], 'name': m.get('name') or m['id']}
                    for m in data['data'] if isinstance(m, dict) and isinstance(m.get('id'), str)]


def models_for_tier(tier, catalog):
    def canonical(value):
        return value.strip().lower().split('/', 1)[-1]
    allowed = {canonical(value) for value in (tier.allowed_model_ids or [])}
    return {'tier_id': tier.id, 'tier_name': tier.name, 'all_models': not allowed,
            'models': [m for m in catalog if not allowed or canonical(m['id']) in allowed]}


async def sync_subscription_model_policy(request, removed_tier=None) -> bool:
    from open_webui.config import KYBER_INTERNAL_SECRET
    from open_webui.models.subscriptions import SubscriptionTiers
    from open_webui.utils.kyber import kyber_base

    if not getattr(request.app.state.config, 'ENABLE_KYBER_TOKEN_BILLING', False):
        return True
    if not KYBER_INTERNAL_SECRET:
        return False
    tiers = await SubscriptionTiers.list_tiers(enabled_only=False)
    policies = [dict(id=t.id, name=t.name, enabled=t.enabled,
                     allowedModelIds=t.allowed_model_ids or [], updatedAt=t.updated_at) for t in tiers]
    if removed_tier:
        policies = [p for p in policies if p['id'] != removed_tier['id']] + [removed_tier]
    if not policies:
        return False
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
            async with session.put(
                f'{kyber_base(request)}/internal/subscription-model-policy',
                json={'tiers': policies}, headers={'X-Internal-Secret': KYBER_INTERNAL_SECRET},
            ) as response:
                if response.status == 200:
                    return True
                log.warning('Subscription model policy sync failed: HTTP %s', response.status)
    except Exception:
        log.exception('Subscription model policy sync failed')
    return False
