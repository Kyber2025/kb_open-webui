"""Exercise subscription enforcement with isolated dependencies; no live requests."""
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

assert os.environ.get('DATABASE_URL') == 'sqlite:////tmp/access-test.db', 'Disposable test database required'
from open_webui.internal.db import engine
from open_webui.internal.config import ConfigTable

ConfigTable.__table__.create(engine, checkfirst=True)
from open_webui.utils import kyber, subscription


def request(**values):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(config=SimpleNamespace(
        ENABLE_SUBSCRIPTIONS=True,
        ENABLE_KYBER_TOKEN_BILLING=values.get('billing', True),
        KYBER_BILLING_BASE_URL='https://ai.example/api/v1',
    ))))


class SubscriptionAccessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.admin = SimpleNamespace(id='admin-test', email='admin@test.invalid', role='admin')
        self.tier = SimpleNamespace(id='free', name='Free', enabled=True,
                                    daily_message_limit=2, allowed_model_ids=['allowed'])

    async def test_admin_obeys_model_allow_list(self):
        with patch.object(subscription, 'get_user_tier', AsyncMock(return_value=(self.tier, None))), \
                patch.object(kyber, 'is_kyber_enterprise_member', AsyncMock(return_value=False)):
            with self.assertRaises(HTTPException) as caught:
                await subscription.enforce_subscription_access(request(), self.admin, 'excluded')
            self.assertEqual(caught.exception.status_code, 403)

    async def test_admin_obeys_daily_limit_when_message_billing_enabled(self):
        with patch.object(subscription, 'get_user_tier', AsyncMock(return_value=(self.tier, None))), \
                patch.object(kyber, 'is_kyber_enterprise_member', AsyncMock(return_value=False)), \
                patch.object(subscription.SubscriptionUsage, 'get_count', AsyncMock(return_value=2)):
            with self.assertRaises(HTTPException) as caught:
                await subscription.enforce_subscription_access(request(billing=False), self.admin, 'allowed')
            self.assertEqual(caught.exception.status_code, 429)

    async def test_admin_state_reports_the_same_remaining_allowance(self):
        self.tier.model_dump = lambda: {'id': 'free'}
        with patch.object(subscription, 'get_user_tier', AsyncMock(return_value=(self.tier, None))), \
                patch.object(subscription.SubscriptionUsage, 'get_count', AsyncMock(return_value=1)), \
                patch.object(kyber.UserKyberAccounts, 'get_by_user_id', AsyncMock(return_value=None)):
            state = await subscription.get_subscription_state(self.admin.id, is_admin=True)
            self.assertTrue(state['is_admin'])
            self.assertEqual(state['usage']['limit'], 2)
            self.assertEqual(state['usage']['remaining'], 1)

    async def test_unlinked_admin_and_regular_user_cannot_borrow_shared_key(self):
        with patch.object(kyber, 'get_user_kyber_api_key', AsyncMock(return_value=None)):
            for role in ('admin', 'user'):
                self.admin.role = role
                with self.assertRaises(HTTPException) as caught:
                    await kyber.get_kyber_billing_key(request(), self.admin, 'https://ai.example/api/v1')
                self.assertEqual(caught.exception.status_code, 403)

    async def test_linked_admin_uses_personal_key(self):
        with patch.object(kyber, 'get_user_kyber_api_key', AsyncMock(return_value='personal-test-key')):
            self.assertEqual(await kyber.get_kyber_billing_key(request(), self.admin, 'https://ai.example/api/v1'), 'personal-test-key')

    async def test_separately_limited_guests_and_unrelated_upstreams_are_preserved(self):
        with patch.object(kyber, 'get_user_kyber_api_key', AsyncMock(side_effect=AssertionError('unexpected lookup'))):
            guest = SimpleNamespace(id='guest-test', email='guest@guest.local', role='user')
            self.assertIsNone(await kyber.get_kyber_billing_key(request(), guest, 'https://ai.example/api/v1'))
            self.assertIsNone(await kyber.get_kyber_billing_key(request(), self.admin, 'https://other.example/v1'))
            self.assertIsNone(await kyber.get_kyber_billing_key(request(billing=False), self.admin, 'https://ai.example/api/v1'))

    async def test_obsolete_or_free_gift_tiers_cannot_generate_codes(self):
        with patch.object(subscription.GiftCards, 'insert_many', AsyncMock(side_effect=AssertionError('must not insert'))):
            for tier_id, enabled in [('max_plus', False), ('max_plus', True), ('free', True), ('pro', False)]:
                tier = SimpleNamespace(id=tier_id, enabled=enabled)
                with patch.object(subscription.SubscriptionTiers, 'get_tier', AsyncMock(return_value=tier)):
                    with self.assertRaises(HTTPException) as caught:
                        await subscription.generate_gift_cards(self.admin, tier_id, 1)
                    self.assertEqual(caught.exception.status_code, 409)


class SubscriptionPolicySyncTests(unittest.IsolatedAsyncioTestCase):
    async def run_sync(self, status=200, removed=None):
        from open_webui.utils import subscription_models
        from open_webui import config
        from open_webui.models.subscriptions import SubscriptionTiers
        tier = SimpleNamespace(id='free', name='Free', enabled=True,
                               allowed_model_ids=['gpt-5.2'], updated_at=10)
        response = MagicMock(status=status)
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=response)
        ctx.__aexit__ = AsyncMock(return_value=False)
        session = MagicMock()
        session.put.return_value = ctx
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)
        with patch.object(config, 'KYBER_INTERNAL_SECRET', 'isolated-test-secret'), \
                patch.object(SubscriptionTiers, 'list_tiers', AsyncMock(return_value=[tier])), \
                patch.object(subscription_models.aiohttp, 'ClientSession', return_value=session):
            ok = await subscription_models.sync_subscription_model_policy(request(), removed)
        return ok, session.put.call_args.kwargs['json']

    async def test_policy_transmits_whitelist_and_revision(self):
        ok, payload = await self.run_sync()
        self.assertTrue(ok)
        self.assertEqual(payload['tiers'][0]['allowedModelIds'], ['gpt-5.2'])
        self.assertEqual(payload['tiers'][0]['updatedAt'], 10)

    async def test_failed_sync_is_reported(self):
        ok, _ = await self.run_sync(status=503)
        self.assertFalse(ok)

    async def test_deleted_tier_publishes_disabled_policy(self):
        removed = dict(id='pro', name='Max 7x', enabled=False, allowedModelIds=[], updatedAt=11)
        ok, payload = await self.run_sync(removed=removed)
        self.assertTrue(ok)
        self.assertEqual(payload['tiers'][-1], removed)


class TierModelPreviewTests(unittest.TestCase):
    def test_preview_uses_the_selected_tier_not_viewer_permissions(self):
        from open_webui.utils.subscription_models import models_for_tier
        catalog = [{'id': 'gpt-5.5', 'name': 'GPT-5.5'}, {'id': 'claude-sonnet-5', 'name': 'Sonnet 5'}]
        tier = SimpleNamespace(id='ultra', name='Max 20x', allowed_model_ids=['OpenAI/GPT-5.5', 'missing'])
        result = models_for_tier(tier, catalog)
        self.assertEqual(result['models'], [catalog[0]])
        self.assertEqual(result['tier_id'], 'ultra')
        self.assertFalse(result['all_models'])
        self.assertEqual(tier.allowed_model_ids, ['OpenAI/GPT-5.5', 'missing'])

    def test_unrestricted_plan_previews_the_full_catalog(self):
        from open_webui.utils.subscription_models import models_for_tier
        catalog = [{'id': 'gpt-5.5', 'name': 'GPT-5.5'}]
        tier = SimpleNamespace(id='custom', name='Custom', allowed_model_ids=[])
        self.assertEqual(models_for_tier(tier,catalog), {
            'tier_id':'custom','tier_name':'Custom','all_models':True,'models':catalog})


if __name__ == '__main__':
    unittest.main()
