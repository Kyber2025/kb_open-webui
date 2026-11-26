"""Exercise real route auth, owner derivation and download authorization."""
import base64
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

transport = AsyncMock()
target = AsyncMock(return_value='alice-gateway')
async def verified(authorization: str = Header(default=None)):
    if authorization != 'Bearer alice-session': raise HTTPException(401, 'Sign in required')
    return SimpleNamespace(id='alice', email='alice@example.test')
def stub(**kw):
    m=types.ModuleType('workspace-test');m.__dict__.update(kw);return m
with patch.dict(sys.modules, {
    'open_webui.routers.desktop_keys':stub(_target=target),
    'open_webui.utils.auth':stub(get_verified_user=verified),
    'open_webui.utils.kyber':stub(_internal_request=transport),
}):
    spec=importlib.util.spec_from_file_location('workspace_routes',Path(__file__).parents[1]/'open_webui/routers/workspaces.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
app=FastAPI();app.include_router(module.router,prefix='/api/v1/code/ssh-workspaces')
client=TestClient(app);base='/api/v1/code/ssh-workspaces';headers={'Authorization':'Bearer alice-session'}
class Workspaces(unittest.TestCase):
    def setUp(self):
        transport.reset_mock();transport.return_value=(200,{'workspaces':[{'instanceId':'i-123abc'}]})
        target.reset_mock();target.side_effect=None;target.return_value='alice-gateway'
    def test_anonymous_cannot_download_any_material(self):
        for suffix in ['', '/resources/kividas-ssh-setup.sh','/resources/kividas-ssh-setup.ps1','/resources/kividas-ssh-setup.cmd','/resources/kividas-ssh-guide.html']:
            self.assertEqual(client.get(base+suffix).status_code,401)
        self.assertEqual(client.post(base+'/i-123abc/download',json={}).status_code,401)
        transport.assert_not_awaited()
    def test_session_is_only_identity_source(self):
        r=client.post(base+'/i-bob/download?userId=bob',headers=headers,json={})
        self.assertEqual(r.status_code,200)
        target.assert_awaited_once_with('alice')
        self.assertEqual(transport.call_args.args[1:3],('POST','/internal/users/alice-gateway/ssh-workspaces/i-bob/download'))
        self.assertIn('no-store',r.headers['cache-control'])
        for payload in [{'userId':'bob'},{'actorId':'bob'},{'version':1}]:
            self.assertEqual(client.post(base+'/i-123abc/download',headers=headers,json=payload).status_code,422)
    def test_unbound_or_expired_cannot_download_scripts(self):
        transport.return_value=(200,{'workspaces':[]})
        for ext in ['sh','ps1','cmd']:
            self.assertEqual(client.get(base+'/resources/kividas-ssh-setup.'+ext,headers=headers).status_code,403)
        transport.return_value=(403,{'message':'expired'})
        self.assertEqual(client.post(base+'/i-123abc/download',headers=headers,json={}).status_code,403)
    def test_scripts_are_generic_and_only_returned_after_live_check(self):
        for ext in ['sh','ps1','cmd']:
            r=client.get(base+'/resources/kividas-ssh-setup.'+ext,headers=headers)
            self.assertEqual(r.status_code,200)
            self.assertIn('no-store',r.headers['cache-control'])
            self.assertNotIn('13.213.13.75',r.text)
            self.assertNotIn('ws_205d72066d905682',r.text)
        self.assertEqual(transport.await_count,3)
    def test_windows_single_file_contains_the_current_tested_installer(self):
        r=client.get(base+'/resources/kividas-ssh-setup.cmd',headers=headers)
        self.assertEqual(r.status_code,200)
        self.assertIn('attachment;',r.headers['content-disposition'])
        self.assertIn('-STA',r.text)
        self.assertNotIn('__KIVIDAS_POWERSHELL_BASE64__',r.text)
        payload=r.text.rsplit(':KIVIDAS_SSH_PAYLOAD',1)[1].strip()
        self.assertEqual(base64.b64decode(payload,validate=True),(module.RESOURCES/'kividas-ssh-setup.ps1').read_bytes())
        self.assertEqual(r.content.count(b'\n'),r.content.count(b'\r\n'))
    def test_guide_is_available_before_binding_and_paths_are_allowlisted(self):
        transport.return_value=(200,{'workspaces':[]})
        r=client.get(base+'/resources/kividas-ssh-guide.html',headers=headers)
        self.assertEqual(r.status_code,200);self.assertIn('订阅到期',r.text)
        self.assertEqual(client.get(base+'/resources/secrets.txt',headers=headers).status_code,404)
        transport.assert_not_awaited()
    def test_upstream_failure_does_not_reveal_diagnostics(self):
        transport.return_value=(500,{'message':'SECRET INTERNAL DETAILS'})
        r=client.get(base,headers=headers)
        self.assertEqual(r.status_code,503);self.assertNotIn('SECRET',r.text)
    def test_common_transport_has_no_credentials_or_arbitrary_paths(self):
        self.assertEqual(client.get(base+'/transport/v1/secrets.txt').status_code,404)
        # A public helper needs no owner token; only the six known binary names
        # can be served. Missing build artifacts fail closed with 503.
        r=client.get(base+'/transport/v1/windows-amd64')
        self.assertIn(r.status_code,(200,503))
        if r.status_code==200:
            self.assertEqual(r.content[:2],b'MZ')
            self.assertIn('no-store',r.headers['cache-control'])
        transport.assert_not_awaited()
if __name__=='__main__':unittest.main()
