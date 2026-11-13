"""Run the actual sync function with isolated network/database dependencies."""
import ast
import logging
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

source = Path(__file__).parents[1] / 'open_webui/utils/subscription.py'
tree = ast.parse(source.read_text())
functions = [node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
             and node.name in ('sync_user_rate_limits_to_kyber', '_caps_differ')]


class QuotaSyncTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
            config=SimpleNamespace(ENABLE_KYBER_TOKEN_BILLING=True))))
        self.tier = SimpleNamespace(id='pro', token_limit_5h=7000000,
                                    token_limit_week=35000000, extra_usage_multiplier=1)
        self.link = SimpleNamespace(kyber_user_id='shared-user', extra_usage_enabled=False)
        self.kyber = ModuleType('open_webui.utils.kyber')
        self.kyber.kyber_set_user_rate_limits = AsyncMock(return_value=True)
        self.kyber.kyber_reset_user_usage = AsyncMock()
        self.kyber.kyber_get_users_usage_limits = AsyncMock(return_value={
            'shared-user': {'tp5h': {'limit': 10000000}, 'tpw': {'limit': 50000000}}})
        links = ModuleType('open_webui.models.kyber_accounts')
        links.UserKyberAccounts = SimpleNamespace(get_by_user_id=AsyncMock(return_value=self.link))
        self.modules = patch.dict(sys.modules, {
            'open_webui.utils.kyber': self.kyber, 'open_webui.models.kyber_accounts': links})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.ns = dict(Request=object, log=logging.getLogger('quota-sync-test'),
                       latest_change=AsyncMock(return_value=SimpleNamespace(id='change', synced=True, version=123)),
                       propagate=AsyncMock(), routing_enabled=AsyncMock(return_value=True),
                       get_user_tier=AsyncMock(return_value=(self.tier, None)))
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), self.ns)

    async def sync(self):
        return await self.ns['sync_user_rate_limits_to_kyber'](self.request, 'local-user')

    async def test_shared_upgrade_survives_repeated_syncs(self):
        for _ in range(3):
            self.assertTrue(await self.sync())
        self.assertEqual(self.kyber.kyber_set_user_rate_limits.await_count, 3)
        self.kyber.kyber_get_users_usage_limits.assert_not_awaited()
        self.kyber.kyber_reset_user_usage.assert_not_awaited()

    async def test_dedicated_official_percent_does_not_trigger_token_reset(self):
        self.kyber.kyber_get_users_usage_limits.return_value = {
            'shared-user': {'tp5h': {'limit': 100}, 'tpw': {'limit': 100}}}
        self.assertTrue(await self.sync())
        self.kyber.kyber_reset_user_usage.assert_not_awaited()

    async def test_legacy_cap_change_still_resets(self):
        self.ns['routing_enabled'].return_value = False
        self.assertTrue(await self.sync())
        self.kyber.kyber_reset_user_usage.assert_awaited_once_with(self.request, 'shared-user')

    async def test_legacy_unchanged_caps_keep_usage(self):
        self.ns['routing_enabled'].return_value = False
        self.kyber.kyber_get_users_usage_limits.return_value = {
            'shared-user': {'tp5h': {'limit': 7000000}, 'tpw': {'limit': 35000000}}}
        self.assertTrue(await self.sync())
        self.kyber.kyber_reset_user_usage.assert_not_awaited()

    async def test_unknown_routing_never_resets_on_a_guess(self):
        self.ns['routing_enabled'].side_effect = RuntimeError('unavailable')
        with self.assertLogs('quota-sync-test', level='ERROR'):
            self.assertFalse(await self.sync())
        self.kyber.kyber_set_user_rate_limits.assert_not_awaited()
        self.kyber.kyber_reset_user_usage.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
