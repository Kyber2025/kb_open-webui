"""HTTP contracts with only the internal transport and admin identity mocked."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

transport = AsyncMock(return_value=(200, {'ok': True}))


async def admin(authorization: str | None = Header(default=None)):
    if authorization != 'Bearer local-admin':
        raise HTTPException(403, 'Admin required')
    return SimpleNamespace(id='local-admin-id')


def module(**kwargs):
    m = types.ModuleType('test_dependency')
    m.__dict__.update(kwargs)
    return m


spec = importlib.util.spec_from_file_location('request_risk_under_test', Path(__file__).parents[1] / 'open_webui/routers/request_risk.py')
route = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'open_webui.utils.auth': module(get_admin_user=admin),
                             'open_webui.utils.kyber': module(_internal_request=transport)}):
    spec.loader.exec_module(route)
app = FastAPI()
app.include_router(route.router, prefix='/api/v1/kyber')
client = TestClient(app)
base = '/api/v1/kyber/admin/risk'
headers = {'Authorization': 'Bearer local-admin'}
policy = {'enabled': True, 'rules': []}


class RiskProxyTests(unittest.TestCase):
    def setUp(self):
        transport.reset_mock()
        transport.return_value = (200, {'ok': True})

    def test_all_endpoints_require_admin(self):
        for method, path in [('GET', '/policy'), ('PUT', '/policy'), ('GET', '/events'), ('GET', '/overrides'), ('PUT', '/override'), ('POST', '/test')]:
            self.assertEqual(client.request(method, base + path, json={}).status_code, 403)
        transport.assert_not_awaited()

    def test_actor_is_server_supplied_and_no_cross_site_writes(self):
        form = {'version': 1, 'config': policy, 'reason': '管理员核查'}
        r = client.put(base + '/policy', headers=headers, json=form)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers['cache-control'], 'no-store')
        self.assertEqual(transport.call_args.args[-1]['actorId'], 'owui:local-admin-id')
        self.assertEqual(client.put(base + '/policy', headers=headers, json={**form, 'actorId': 'spoof'}).status_code, 422)
        self.assertEqual(client.put(base + '/policy', headers={**headers, 'Origin': 'https://other.invalid'}, json=form).status_code, 403)

    def test_transport_failure_is_redacted_and_conflicts_are_visible(self):
        transport.return_value = (0, {'error': 'private network credentials', 'message': 'private details'})
        r = client.get(base + '/policy', headers=headers)
        self.assertEqual(r.status_code, 503)
        self.assertNotIn('private', r.text)
        transport.return_value = (409, {'message': '配置已更新，请刷新'})
        self.assertEqual(client.get(base + '/policy', headers=headers).json()['detail'], '配置已更新，请刷新')

    def test_filter_encoding_override_actor_and_preview_scope(self):
        r = client.get(base + '/events', headers=headers, params={'search': 'user+27@example.invalid', 'action': 'blocked'})
        self.assertEqual(r.status_code, 200)
        self.assertIn('user%2B27%40example.invalid', transport.call_args.args[2])
        form = {'version': 0, 'email': 'local@example.invalid', 'mode': 'allow', 'expiresAt': None, 'reason': '核查后放行'}
        self.assertEqual(client.put(base + '/override', headers=headers, json=form).status_code, 200)
        self.assertEqual(transport.call_args.args[-1], {**form, 'actorId': 'owui:local-admin-id'})
        self.assertEqual(client.post(base + '/test', headers=headers, json={'config': policy, 'text': 'sample only'}).status_code, 200)
        self.assertEqual(transport.call_args.args[2], '/internal/risk/test')
        self.assertEqual(client.get(base + '/events?page=-1', headers=headers).status_code, 422)


if __name__ == '__main__':
    unittest.main()
