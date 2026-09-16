"""Exercise the actual redemption functions without booting database/ML services."""
import ast
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException, status

source = Path(__file__).parents[1] / 'open_webui/utils/subscription.py'
tree = ast.parse(source.read_text())
functions = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
             and node.name in ('normalize_gift_code', 'redeem_gift_card')]
subscription = ModuleType('isolated_redemption')
subscription.__dict__.update(Request=SimpleNamespace, HTTPException=HTTPException, status=status,
    GIFT_CODE_LEN=16, GIFT_CODE_GROUP_LEN=4,
    GiftCards=SimpleNamespace(get=None), SubscriptionTiers=SimpleNamespace(get_tier=None),
    change_subscription=None, sync_user_rate_limits_to_kyber=None, get_subscription_state=None)
exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), subscription.__dict__)


def request(billing=True):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        config=SimpleNamespace(ENABLE_KYBER_TOKEN_BILLING=billing))))


class RedemptionRefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_waits_for_gateway_sync_and_returns_current_state(self):
        user = SimpleNamespace(id='redeem-test', role='user')
        card = SimpleNamespace(tier_id='pro', duration_days=30)
        tier = SimpleNamespace(name='Max 7x', enabled=True)
        sub = SimpleNamespace(expires_at=1900000000)
        events = []

        async def grant(*args, **kwargs):
            events.append(('grant', kwargs['operation_id']))
            return sub

        async def sync(*args):
            events.append(('sync', user.id))
            return True

        with patch.object(subscription.GiftCards, 'get', AsyncMock(return_value=card)), \
                patch.object(subscription.SubscriptionTiers, 'get_tier', AsyncMock(return_value=tier)), \
                patch.object(subscription, 'change_subscription', AsyncMock(side_effect=grant)), \
                patch.object(subscription, 'sync_user_rate_limits_to_kyber', AsyncMock(side_effect=sync)), \
                patch.object(subscription, 'get_subscription_state', AsyncMock(return_value={'tier': {'id': 'pro'}})):
            result = await subscription.redeem_gift_card(request(), user, 'ABCDEFGHIJKLMNOP')
            self.assertTrue(result['success'])
            self.assertEqual(result['subscription_state']['tier']['id'], 'pro')
            self.assertEqual(events, [('grant', 'gift:ABCD-EFGH-IJKL-MNOP'), ('sync', user.id)])

    async def test_failed_sync_is_not_success_and_retry_uses_the_same_grant_id(self):
        user = SimpleNamespace(id='redeem-test', role='user')
        grant = AsyncMock(return_value=SimpleNamespace(expires_at=1900000000))
        with patch.object(subscription.GiftCards, 'get', AsyncMock(return_value=SimpleNamespace(tier_id='pro', duration_days=30))), \
                patch.object(subscription.SubscriptionTiers, 'get_tier', AsyncMock(return_value=SimpleNamespace(name='Max 7x', enabled=True))), \
                patch.object(subscription, 'change_subscription', grant), \
                patch.object(subscription, 'sync_user_rate_limits_to_kyber', AsyncMock(side_effect=[False, True])), \
                patch.object(subscription, 'get_subscription_state', AsyncMock(return_value={})) as state:
            with self.assertRaises(HTTPException) as caught:
                await subscription.redeem_gift_card(request(), user, 'ABCDEFGHIJKLMNOP')
            self.assertEqual(caught.exception.status_code, 503)
            state.assert_not_awaited()
            result = await subscription.redeem_gift_card(request(), user, 'ABCD-EFGH-IJKL-MNOP')
            self.assertTrue(result['success'])
            self.assertEqual([c.kwargs['operation_id'] for c in grant.await_args_list],
                             ['gift:ABCD-EFGH-IJKL-MNOP'] * 2)


