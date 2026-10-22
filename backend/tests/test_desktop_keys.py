"""FastAPI contract tests with the account store/internal transport isolated.
Run: python3 backend/tests/test_desktop_keys.py (no database or production access).
"""
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

users = SimpleNamespace(get_user_by_id=AsyncMock(return_value=SimpleNamespace(id='web-user')))
links = SimpleNamespace(get_by_user_id=AsyncMock(return_value=SimpleNamespace(kyber_user_id='gateway-user')))
transport = AsyncMock(return_value=(200, {'ok': True}))
async def admin(authorization: str = Header(default=None)):
    if authorization != 'Bearer admin-test':
        raise HTTPException(403, 'Admin required')
    return SimpleNamespace(id='acting-admin')

def module(**kwargs):
    m=types.ModuleType('isolated_test_dependency'); m.__dict__.update(kwargs); return m

stubs={
 'open_webui.models.users':module(Users=users),
 'open_webui.models.kyber_accounts':module(UserKyberAccounts=links),
 'open_webui.utils.auth':module(get_admin_user=admin),
 'open_webui.utils.kyber':module(_internal_request=transport),
}
spec=importlib.util.spec_from_file_location('desktop_keys_under_test',Path(__file__).parents[1]/'open_webui/routers/desktop_keys.py')
route=importlib.util.module_from_spec(spec)
with patch.dict(sys.modules,stubs): spec.loader.exec_module(route)
app=FastAPI(); app.include_router(route.router,prefix='/api/v1/kyber')
client=TestClient(app)
path='/api/v1/kyber/admin/users/web-user/desktop-keys'
headers={'Authorization':'Bearer admin-test'}

class DesktopKeysTests(unittest.TestCase):
    def setUp(self):
        transport.reset_mock();transport.return_value=(200,{'ok':True})
        links.get_by_user_id.return_value=SimpleNamespace(kyber_user_id='gateway-user')
        users.get_user_by_id.return_value=SimpleNamespace(id='web-user')
    def test_admin_required_for_every_operation(self):
        for method,url,data in [('GET',path,None),('POST',path,{'label':'Mac','days':30}),('POST',path+'/key-id/revoke',None)]:
            self.assertEqual(client.request(method,url,json=data).status_code,403)
        transport.assert_not_awaited()
    def test_target_and_actor_are_server_resolved(self):
        response=client.post(path,headers=headers,json={'label':'Mac','days':30})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(transport.call_args.args[1:],('POST','/internal/users/gateway-user/desktop-keys',{'label':'Mac','days':30,'actorId':'acting-admin'}))
        response=client.post(path,headers=headers,json={'label':'Mac','days':30,'actorId':'victim','userId':'victim'})
        self.assertEqual(response.status_code,422)
    def test_link_required_no_implicit_credentials(self):
        links.get_by_user_id.return_value=None
        self.assertEqual(client.get(path,headers=headers).status_code,409)
        transport.assert_not_awaited()
    def test_missing_user_and_error_redaction(self):
        users.get_user_by_id.return_value=None
        self.assertEqual(client.get(path,headers=headers).status_code,404)
        users.get_user_by_id.return_value=SimpleNamespace(id='web-user')
        transport.return_value=(0,{'message':'secret transport details','error':'raw secret'})
        response=client.get(path,headers=headers)
        self.assertEqual(response.status_code,503); self.assertNotIn('secret',response.text)
    def test_expiry_validation_and_revoke_scope(self):
        for days in [0,91,True,'30']:
            self.assertEqual(client.post(path,headers=headers,json={'label':'Mac','days':days}).status_code,422)
        self.assertEqual(client.post(path+'/key-id/revoke',headers=headers).status_code,200)
        self.assertEqual(transport.call_args.args[1:],('POST','/internal/users/gateway-user/desktop-keys/key-id/revoke',{'actorId':'acting-admin'}))

if __name__=='__main__':unittest.main()
