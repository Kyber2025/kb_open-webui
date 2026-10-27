"""Gateway downloads: session ownership, subscription checks, and no user writes."""
from __future__ import annotations
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

users = SimpleNamespace(get_user_by_id=AsyncMock(return_value=SimpleNamespace(id='alice')))
links = SimpleNamespace(get_by_user_id=AsyncMock(return_value=SimpleNamespace(kyber_user_id='alice-gateway')))
tier = AsyncMock(return_value=(SimpleNamespace(id='max', enabled=True), SimpleNamespace(id='active-subscription')))
transport = AsyncMock(return_value=(200, {'eligible': True, 'keys': [{'id': 'alice-key', 'suffix': 'test'}]}))

async def verified(authorization: str = Header(default=None)):
    if authorization != 'Bearer alice-session':
        raise HTTPException(401, 'Sign in required')
    return SimpleNamespace(id='alice', email='alice@example.test', role='user')

async def admin(authorization: str = Header(default=None)):
    raise HTTPException(403, 'Admin required')

def stub(**kwargs):
    module = types.ModuleType('gateway_test_dependency'); module.__dict__.update(kwargs); return module

def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1]/'open_webui/routers'/f'{name}.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

stubs = {
    'open_webui.models.users': stub(Users=users),
    'open_webui.models.kyber_accounts': stub(UserKyberAccounts=links),
    'open_webui.utils.auth': stub(get_verified_user=verified, get_admin_user=admin),
    'open_webui.utils.kyber': stub(_internal_request=transport),
    'open_webui.utils.subscription': stub(get_user_tier=tier),
}
with patch.dict(sys.modules, stubs):
    desktop = load('desktop_keys')
    with patch.dict(sys.modules, {'open_webui.routers.desktop_keys': desktop}):
        gateway = load('gateway')
app = FastAPI(); app.include_router(gateway.router, prefix='/api/v1/kyber'); app.include_router(desktop.router, prefix='/api/v1/kyber')
client = TestClient(app); headers = {'Authorization': 'Bearer alice-session'}
path = '/api/v1/kyber/gateway'


class GatewayTests(unittest.TestCase):
    def setUp(self):
        transport.reset_mock(); transport.return_value = (200, {'eligible': True, 'keys': [{'id': 'alice-key'}]})
        tier.return_value = (SimpleNamespace(id='max', enabled=True), SimpleNamespace(id='active-subscription'))

    def test_authentication_required(self):
        for method, url in [('GET', path), ('POST', path+'/keys/alice-key/download')]:
            self.assertEqual(client.request(method, url, json={}).status_code, 401)
        transport.assert_not_awaited()

    def test_list_uses_session_owner_even_with_forged_query(self):
        response = client.get(path+'?user_id=bob&actorId=bob', headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['subscribed'])
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(transport.call_args.args[1:3], ('GET', '/internal/users/alice-gateway/desktop-keys'))

    def test_repeat_download_does_not_create_rotate_or_revoke(self):
        payload = {'key': {'id': 'alice-key', 'installationId': 'same-installation'}, 'token': 'same-test-token'}
        transport.return_value = (200, payload)
        responses = [client.post(path+'/keys/alice-key/download', headers=headers, json={}) for _ in range(3)]
        self.assertTrue(all(r.json() == payload for r in responses))
        self.assertTrue(all(r.headers['cache-control'] == 'no-store' for r in responses))
        for call in transport.call_args_list:
            self.assertEqual(call.args[1:], ('POST', '/internal/users/alice-gateway/gateway/alice-key/download', {'actorId': 'alice'}))

    def test_foreign_key_stays_under_session_owner(self):
        transport.return_value = (404, {'message': '桌面 Key 不存在'})
        response = client.post(path+'/keys/bob-key/download', headers=headers, json={})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(transport.call_args.args[2], '/internal/users/alice-gateway/gateway/bob-key/download')

    def test_no_subscriber_credential_management_endpoints(self):
        for suffix in ['', '/keys/alice-key/revoke', '/keys/alice-key/delete', '/keys/alice-key/policy']:
            self.assertIn(client.post(path+suffix, headers=headers, json={}).status_code, [404, 405])
        self.assertEqual(client.post('/api/v1/kyber/admin/users/alice/desktop-keys', headers=headers, json={}).status_code, 403)
        transport.assert_not_awaited()

    def test_unsubscribed_disabled_and_free_users_cannot_download(self):
        for plan, subscription in [(SimpleNamespace(id='max', enabled=True), None), (SimpleNamespace(id='free', enabled=True), SimpleNamespace()), (SimpleNamespace(id='max', enabled=False), SimpleNamespace())]:
            tier.return_value = (plan, subscription)
            state = client.get(path, headers=headers)
            self.assertEqual(state.json()['keys'], [])
            self.assertFalse(state.json()['subscribed'])
            response = client.post(path+'/keys/alice-key/download', headers=headers, json={})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.headers['cache-control'], 'no-store')
        transport.assert_not_awaited()

    def test_no_actor_identity_or_policy_override(self):
        response = client.post(path+'/keys/alice-key/download', headers=headers,
                               json={'actorId': 'bob', 'userId': 'bob', 'concurrentLimit': 100})
        self.assertEqual(response.status_code, 422)
        transport.assert_not_awaited()


if __name__ == '__main__': unittest.main()
