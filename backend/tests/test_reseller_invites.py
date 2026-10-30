"""Reseller security regression tests on isolated SQLite; no live services or keys."""
import importlib.util
import sys
import time
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException, Response, Depends
from sqlalchemy import event, select, func
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import declarative_base
from test_admin_user_link import lift, AtomicPersistenceTests

ROOT = Path(__file__).parents[1] / 'open_webui'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class ResellerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        base = declarative_base()
        @asynccontextmanager
        async def context(db=None):
            if db is not None: yield db
            else:
                async with AsyncSession(self.engine, expire_on_commit=False) as session: yield session
        dbmodule = ModuleType('open_webui.internal.db')
        dbmodule.Base, dbmodule.get_async_db_context = base, context
        self.patch = patch.dict(sys.modules, {'open_webui.internal.db': dbmodule})
        self.patch.start()
        self.models = load('open_webui.models.reseller_invites', 'models/reseller_invites.py')
        self.policy = load('open_webui.utils.reseller_policy', 'utils/reseller_policy.py')
        self.portal = load('open_webui.utils.reseller_portal', 'utils/reseller_portal.py')
        async with self.engine.begin() as conn: await conn.run_sync(base.metadata.create_all)
        self.invites = self.models.ResellerInvites
        self.invite = await self.invites.create('Agent test')
        self.user = SimpleNamespace(id='customer', role='user')
        async with context() as db:
            db.add(self.models.ResellerCustomer(user_id=self.user.id, invite_id=self.invite['id'], created_at=1))
            await db.commit()
        self.state = {'tier': {'id':'pro','name':'Max 5x','price_usd':120,'description':'120 USD',
            'token_limit_5h':1000,'duration_days':30}, 'subscription': {'tier_id':'pro','expires_at':1900000000,'order_id':'private-order'},
            'usage':{'remaining':5},'expires_at':1900000000}

    async def asyncTearDown(self):
        self.patch.stop()
        for name in ('open_webui.models.reseller_invites', 'open_webui.utils.reseller_policy', 'open_webui.utils.reseller_portal'): sys.modules.pop(name, None)
        await self.engine.dispose()

    async def test_email_attribution_survives_removed_token_and_cannot_be_replaced(self):
        await self.invites.reserve(' New@Example.com ', self.invite['token'])
        self.assertEqual(await self.invites.registration_invite('new@example.com'), self.invite['id'])
        await self.invites.reserve('new@example.com', None)
        other = await self.invites.create('Other agent')
        with self.assertRaises(HTTPException): await self.invites.reserve('new@example.com', other['token'])
        self.assertIsNone(await self.invites.registration_invite('ordinary@example.com'))

    async def test_short_code_and_legacy_token_share_one_durable_identity(self):
        code = self.invite['short_code']
        self.assertEqual(len(code), 12)
        self.assertEqual(await self.invites.validate(code), self.invite['id'])
        await self.invites.reserve('short@example.com', code)
        self.assertEqual(await self.invites.registration_invite('short@example.com', self.invite['token']), self.invite['id'])
        self.assertEqual((await self.invites.list())[0]['short_code'], code)
        await self.invites.set_enabled(self.invite['id'], False)
        with self.assertRaises(HTTPException): await self.invites.validate(code)
        with self.assertRaises(HTTPException): await self.invites.validate(self.invite['token'])

    async def test_rollout_legacy_invite_gets_stable_short_code(self):
        async with AsyncSession(self.engine) as db:
            row = await db.get(self.models.ResellerInvite, self.invite['id'])
            row.short_code = None
            await db.commit()
        first = (await self.invites.list())[0]['short_code']
        self.assertEqual(len(first), 12)
        self.assertEqual((await self.invites.list())[0]['short_code'], first)

    async def test_proxy_host_requires_membership_and_invited_registration(self):
        portal = SimpleNamespace(headers={'host':'proxy.kividas.com'})
        original = SimpleNamespace(headers={'host':'chat.kividas.com'})
        ordinary = SimpleNamespace(id='ordinary')
        await self.portal.require_portal_user(portal,self.user)
        with self.assertRaises(HTTPException): await self.portal.require_portal_user(portal,ordinary)
        await self.portal.require_portal_user(original,ordinary)
        with self.assertRaises(HTTPException): await self.portal.require_portal_registration(portal,'new@example.com')
        await self.portal.require_portal_registration(portal,'new@example.com',self.invite['short_code'])
        await self.invites.reserve('new@example.com',self.invite['short_code'])
        await self.portal.require_portal_registration(portal,'new@example.com')

    async def test_disabled_and_forged_tokens_fail_but_existing_members_stay_managed(self):
        with self.assertRaises(HTTPException): await self.invites.validate('forged-token')
        await self.invites.reserve('new@example.com', self.invite['token'])
        await self.invites.set_enabled(self.invite['id'], False)
        with self.assertRaises(HTTPException): await self.invites.registration_invite('new@example.com')
        self.assertTrue(await self.invites.is_customer(self.user.id))
        self.assertEqual((await self.invites.list())[0]['customers'], 1)

    async def test_state_allowlist_preserves_entitlements_without_price_or_order_metadata(self):
        result = self.policy.customer_state(self.state)
        self.assertNotIn('price_usd', result['tier'])
        self.assertNotIn('description', result['tier'])
        self.assertNotIn('order_id', result['subscription'])
        self.assertEqual(result['usage'], self.state['usage'])
        self.assertEqual(result['tier']['token_limit_5h'], 1000)
        self.assertEqual(result['expires_at'], 1900000000)
        self.assertFalse(result['commerce']['can_purchase'])
        self.assertEqual(self.state['tier']['price_usd'],120)

    async def test_signup_handler_applies_saved_invite_without_any_client_flag(self):
        await self.invites.reserve('invited@example.com', self.invite['token'])
        insert = AsyncMock(return_value=self.user)
        route = lift('routers/auths.py', {'signup_handler'}, {'ResellerInvites':self.invites,
            'Auths':SimpleNamespace(insert_new_auth=insert), 'get_password_hash':lambda value:'test-hash',
            'Users':SimpleNamespace(get_num_users=AsyncMock(return_value=2)),
            'apply_default_group_assignment':AsyncMock(),'HTTPException':HTTPException})
        req=SimpleNamespace(cookies={},app=SimpleNamespace(state=SimpleNamespace(config=SimpleNamespace(
            DEFAULT_USER_ROLE='user',WEBHOOK_URL='',DEFAULT_GROUP_ID=''))))
        async with AsyncSession(self.engine) as db:
            await route.signup_handler(req,'invited@example.com','password','Invited',db=db)
            self.assertEqual(insert.await_args.kwargs['reseller_invite_id'],self.invite['id'])
            await route.signup_handler(req,'ordinary@example.com','password','Ordinary',db=db)
            self.assertIsNone(insert.await_args.kwargs['reseller_invite_id'])

    def routes(self):
        self.plans = AsyncMock(return_value=[{'price_usd':120}])
        self.checkout = AsyncMock(return_value={'amount':'120'})
        self.create = AsyncMock(return_value={'amount':'120'})
        self.redeem = AsyncMock(return_value={'success':True})
        names = {'get_tiers','get_chains','get_order','list_my_orders','current_checkout','subscribe',
            'mobile_tiers','mobile_checkout','mobile_subscribe','mobile_order','redeem','mobile_redeem'}
        return lift('routers/subscriptions.py', names, {'ResellerInvites':self.invites,
            'Depends':Depends,'get_verified_user':lambda:None,'get_mobile_subscription_user':lambda:None,
            'require_direct_purchase':self.policy.require_direct_purchase, 'HTTPException':HTTPException,
            'plans_with_capacity':self.plans,'latest_checkout':self.checkout,'create_subscription_order':self.create,
            'sync_order':self.checkout,'SubscriptionOrders':SimpleNamespace(list_for_user=self.checkout),
            'redeem_gift_card':self.redeem,'status':SimpleNamespace(HTTP_403_FORBIDDEN=403)})

    async def test_web_and_mobile_resist_direct_payment_and_order_requests(self):
        r = self.routes(); req = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(config=SimpleNamespace(ENABLE_SUBSCRIPTIONS=True, SUBSCRIPTION_CHAINS=['56']))))
        for user in (self.user, SimpleNamespace(id=self.user.id, role='admin', info={'reseller':False})):
            self.assertEqual(await r.get_tiers(req, Response(), user), [])
            self.assertEqual(await r.mobile_tiers(req, Response(), user), [])
            self.assertEqual(await r.get_chains(req, user), [])
            self.assertIsNone(await r.current_checkout(req, Response(), user, 'ultra'))
            self.assertIsNone(await r.mobile_checkout(req, Response(), user, 'pro'))
            self.assertEqual(await r.list_my_orders(user), [])
            for call in (lambda: r.subscribe(req, SimpleNamespace(tier_id='pro',chain_id='56'),user),
                         lambda: r.mobile_subscribe(req, SimpleNamespace(tier_id='ultra',chain_id='56'),user),
                         lambda: r.get_order(req,'guessed-order',user), lambda: r.mobile_order('guessed-order',req,Response(),user)):
                with self.assertRaises(HTTPException) as err: await call()
                self.assertEqual(err.exception.status_code,403)
        self.plans.assert_not_awaited(); self.checkout.assert_not_awaited(); self.create.assert_not_awaited()
        self.assertEqual(await r.mobile_redeem(req,Response(),SimpleNamespace(code='VALID-CODE'),self.user),{'success':True})
        self.redeem.assert_awaited_once()
        normal=SimpleNamespace(id='ordinary',role='user')
        self.assertEqual(await r.get_tiers(req,Response(),normal),[{'price_usd':120}])
        self.assertEqual(await r.subscribe(req,SimpleNamespace(tier_id='pro',chain_id='56'),normal),{'amount':'120'})


class AtomicResellerTests(AtomicPersistenceTests):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        import sqlalchemy as sa
        self.resellers = lift('models/reseller_invites.py', {'ResellerCustomer'}, {
            'Base':self.base, **{n:getattr(sa,n) for n in ('Column','String','BigInteger')}})
        self.reseller_patch = patch.dict(sys.modules, {'open_webui.models.reseller_invites':self.resellers})
        self.reseller_patch.start()
        async with self.engine.begin() as conn: await conn.run_sync(self.base.metadata.create_all)

    async def asyncTearDown(self):
        self.reseller_patch.stop(); await super().asyncTearDown()

    async def test_membership_failure_never_leaves_an_unmanaged_account(self):
        async def create():
            async with AsyncSession(self.engine) as db:
                return await self.auths.insert_new_auth('invited@example.com','hash','Customer',role='user',db=db,reseller_invite_id='agent')
        def fail(conn,cursor,statement,parameters,context,executemany):
            if statement.startswith('INSERT INTO reseller_customer'): raise RuntimeError('membership failed')
        event.listen(self.engine.sync_engine,'before_cursor_execute',fail)
        with self.assertRaises(RuntimeError): await create()
        self.assertEqual(await self.counts(),[0,0,0])
        event.remove(self.engine.sync_engine,'before_cursor_execute',fail)
        user=await create()
        async with AsyncSession(self.engine) as db:
            self.assertEqual((await db.get(self.resellers.ResellerCustomer,user.id)).invite_id,'agent')
        self.assertEqual(await self.counts(),[1,1,0])


if __name__ == '__main__': unittest.main()
