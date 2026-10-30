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
resellers = SimpleNamespace(is_customer=AsyncMock(return_value=False))
async def admin(authorization: str = Header(default=None)):
    if authorization != 'Bearer admin-test':
        raise HTTPException(403, 'Admin required')
    return SimpleNamespace(id='acting-admin')

def module(**kwargs):
    m=types.ModuleType('isolated_test_dependency'); m.__dict__.update(kwargs); return m

stubs={
 'open_webui.models.users':module(Users=users),
 'open_webui.models.kyber_accounts':module(UserKyberAccounts=links),
 'open_webui.models.reseller_invites':module(ResellerInvites=resellers),
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
        resellers.is_customer.reset_mock();resellers.is_customer.return_value=False
        transport.reset_mock();transport.return_value=(200,{'ok':True})
        links.get_by_user_id.return_value=SimpleNamespace(kyber_user_id='gateway-user')
        users.get_user_by_id.return_value=SimpleNamespace(id='web-user')
    def test_admin_required_for_every_operation(self):
        for method,url,data in [('GET',path,None),('POST',path,{'label':'Mac',}),('POST',path+'/key-id/revoke',None),('POST',path+'/key-id/delete',None),('POST',path+'/key-id/reveal',None),('POST',path+'/key-id/policy',{'concurrentLimit':0})]:
            self.assertEqual(client.request(method,url,json=data).status_code,403)
        transport.assert_not_awaited()
    def test_target_and_actor_are_server_resolved(self):
        response=client.post(path,headers=headers,json={'label':'Mac',})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(transport.call_args.args[1:],('POST','/internal/users/gateway-user/desktop-keys',{'label':'Mac','actorId':'acting-admin','concurrentLimit':0}))
        response=client.post(path,headers=headers,json={'label':'Mac','actorId':'victim','userId':'victim'})
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
    def test_no_manual_expiry_and_revoke_scope(self):
        for days in [0,91,True,'30']:
            self.assertEqual(client.post(path,headers=headers,json={'label':'Mac','days':days}).status_code,422)
        self.assertEqual(client.post(path+'/key-id/revoke',headers=headers).status_code,200)
        self.assertEqual(transport.call_args.args[1:],('POST','/internal/users/gateway-user/desktop-keys/key-id/revoke',{'actorId':'acting-admin'}))

    def test_delete_scope(self):
        self.assertEqual(client.post(path+'/key-id/delete',headers=headers).status_code,200)
        self.assertEqual(transport.call_args.args[1:],('POST','/internal/users/gateway-user/desktop-keys/key-id/delete',{'actorId':'acting-admin'}))

    def test_manual_concurrency_zero_and_arbitrary_values(self):
        for value in [0,1,12,24,32,1234]:
            self.assertEqual(client.post(path+'/key-id/policy',headers=headers,json={'concurrentLimit':value}).status_code,200)
            self.assertEqual(transport.call_args.args[-1],{'actorId':'acting-admin','concurrentLimit':value})
        for value in [-1,1.5,True,'12']:
            self.assertEqual(client.post(path+'/key-id/policy',headers=headers,json={'concurrentLimit':value}).status_code,422)

    def test_admin_create_and_redownload_use_recipient_not_admin_origin(self):
        payload={'key':{'id':'same-key'},'token':'test-token','usageUrl':'https://chat.kividas.com/'}
        transport.return_value=(200,payload)
        for managed,host in [(True,'proxy'),(False,'chat')]:
            resellers.is_customer.return_value=managed
            for suffix in ['', '/key-id/reveal']:
                response=client.post(path+suffix,headers={**headers,'Host':'chat.kividas.com'},json={} if not suffix else None)
                self.assertEqual(response.status_code,200)
                self.assertEqual(response.json(),{**payload,'usageUrl':f'https://{host}.kividas.com/'})
                resellers.is_customer.assert_awaited_with('web-user')

if __name__=='__main__':unittest.main()
