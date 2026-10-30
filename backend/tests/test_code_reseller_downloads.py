"""Account-specific CLI commands must not contaminate the shared release cache."""
import importlib.util
import sys
import time
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

def module(**values):
    result = types.ModuleType('code_test_dependency'); result.__dict__.update(values); return result

usage_url = AsyncMock(return_value='https://proxy.kividas.com/')
stubs = {
    'open_webui.utils.auth': module(get_verified_user=lambda: None),
    'open_webui.routers.desktop_keys': module(customer_usage_url=usage_url),
    'aiohttp': module(ClientTimeout=lambda **kw: None),
}
spec = importlib.util.spec_from_file_location('code_routes_test', Path(__file__).parents[1]/'open_webui/routers/code.py')
route = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, stubs): spec.loader.exec_module(route)

class CodeDownloadsTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_cache_serves_per_account_commands_without_mutating_cached_release(self):
        cached = {'version':'0.2.2', 'install': {'sh':'normal sh', 'ps1':'normal ps1'}, 'platforms':{}}
        route._cli_cache = {'data':cached, 'exp':time.time()+1000}
        route._proxy_cli_cache = {'data':{**cached,'version':'0.2.3'}, 'exp':time.time()+1000}
        user = SimpleNamespace(id='recipient')
        with patch.dict(sys.modules, stubs):
            usage_url.return_value = 'https://proxy.kividas.com/'
            managed = await route.code_cli(user)
            self.assertEqual(managed['version'],'0.2.3')
            self.assertIn('proxy.kividas.com/api/v1/code/cli/install/install.sh', managed['install']['sh'])
            self.assertIn('proxy.kividas.com/api/v1/code/cli/install/install.ps1', managed['install']['ps1'])
            self.assertEqual(cached['install']['sh'], 'normal sh')
            usage_url.assert_awaited_with('recipient')
            usage_url.return_value = 'https://chat.kividas.com/'
            self.assertEqual(await route.code_cli(user), cached)

    async def test_unavailable_feed_still_returns_managed_commands(self):
        route._cli_cache = {}
        route._proxy_cli_cache = {}
        usage_url.return_value = 'https://proxy.kividas.com/'
        with patch.dict(sys.modules, stubs), patch.object(route, '_get_json', AsyncMock(return_value=None)):
            result = await route.code_cli(SimpleNamespace(id='recipient'))
        self.assertIn('proxy.kividas.com/api/v1/code/cli/install/install.sh', result['install']['sh'])

    async def test_proxy_feed_failure_does_not_use_ordinary_desktop_cache(self):
        route._cache = {'data':{'platforms':{'mac':{'url':'ordinary'}}},'exp':time.time()+1000}
        route._proxy_cache = {}
        usage_url.return_value = 'https://proxy.kividas.com/'
        with patch.dict(sys.modules, stubs), patch.object(route, '_get_json', AsyncMock(return_value=None)) as fetch:
            result = await route.code_latest(SimpleNamespace(id='recipient'))
        self.assertEqual(result['platforms'],{})
        fetch.assert_awaited_once_with('https://dl.kividas.com/desktop/proxy/downloads.json')

if __name__ == '__main__': unittest.main()
