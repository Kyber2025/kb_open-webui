"""Resolve individual GPT access with the caller's own gateway credential."""
from fastapi import HTTPException
from open_webui.utils.subscription_model_ids import canonical_model_id, individual_grant_only


async def granted_models(request, user):
    from open_webui.utils.kyber import get_user_kyber_api_key, _get, kyber_base
    from open_webui.utils.guest import is_guest_user
    if not getattr(request.app.state.config, 'ENABLE_KYBER_TOKEN_BILLING', False) or is_guest_user(user):
        return []
    # Request-local only: never reuse another user's catalogue or a revoked grant.
    cached = getattr(request.state, 'individual_model_grants', None)
    if cached is not None and cached[0] == user.id:
        return cached[1]
    key = await get_user_kyber_api_key(user.id)
    models = []
    if key:
        try:
            status, data = await _get(kyber_base(request), '/v1/models', key)
            if status == 200 and isinstance(data.get('data'), list):
                models = [m for m in data['data'] if isinstance(m, dict) and
                          isinstance(m.get('id'), str) and individual_grant_only(m['id'])]
        except Exception:
            pass  # Fail closed; the picker and completion must not borrow a shared key.
    request.state.individual_model_grants = (user.id, models)
    return models


async def enforce_individual_grant(request, user, model_id):
    allowed = {canonical_model_id(m['id']) for m in await granted_models(request, user)}
    if canonical_model_id(model_id) not in allowed:
        raise HTTPException(403, '此模型需要管理员为当前账号单独开通访问权限。')


async def apply_individual_grants(request, user, models):
    from open_webui.utils.kyber import _host_matches
    cfg = request.app.state.config
    result = [m for m in models if not individual_grant_only(m['id'])]
    granted = await granted_models(request, user)
    base = getattr(cfg, 'KYBER_BILLING_BASE_URL', '')
    urls = getattr(cfg, 'OPENAI_API_BASE_URLS', [])
    # Routing metadata is not authorization. Every completion rechecks the grant.
    for idx, url in enumerate(urls):
        if base and _host_matches(url, base):
            for source in granted:
                model = {**source, 'name': source.get('name') or source['id'],
                         'owned_by': 'openai', 'openai': source, 'urlIdx': idx,
                         'connection_type': 'external'}
                result.append(model)
                request.app.state.OPENAI_MODELS[model['id']] = model
                request.app.state.MODELS[model['id']] = model
            break
    return result
