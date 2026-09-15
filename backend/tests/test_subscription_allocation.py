"""PostgreSQL integration checks; run only in an isolated disposable container."""
import asyncio
import os
import time
import unittest
from types import SimpleNamespace
from urllib.parse import urlparse
from sqlalchemy import select

assert urlparse(os.environ.get('DATABASE_URL', '')).path == '/owui_subscription_test', 'Disposable database required'
from open_webui.internal.db import Base, engine, get_async_db
from open_webui.models.users import User
from open_webui.models.kyber_accounts import UserKyberAccount
from open_webui.models.subscriptions import SubscriptionTier, UserSubscription, GiftCard, SubscriptionOrder
from open_webui.models.subscription_changes import SubscriptionChange
from open_webui.utils import claude_allocation as allocation


class AllocationTests(unittest.IsolatedAsyncioTestCase):
    async def test_atomic_grants_and_outbox(self):
        # Exercise the actual new Alembic migration before creating the other tables.
        import importlib.util
        from pathlib import Path
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        path = Path(__file__).parents[1] / 'open_webui/migrations/versions/f3c4d5e6a7b8_add_subscription_change_outbox.py'
        spec = importlib.util.spec_from_file_location('allocation_migration', path)
        migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
        Base.metadata.create_all(engine)
        now = int(time.time())
        async with get_async_db() as db:
            for i in range(1, 5):
                db.add(User(id=f'u{i}', email=f'u{i}@test.invalid', name=f'Test {i}', role='user'))
                db.add(UserKyberAccount(user_id=f'u{i}', kyber_user_id=f'k{i}', kyber_email=f'u{i}@test.invalid', created_at=now, updated_at=now))
            for tier in ('free','pro','max','ultra'):
                db.add(SubscriptionTier(id=tier,name=tier,enabled=True,price_usd=90,created_at=now,updated_at=now))
            for i in (1,2):
                db.add(GiftCard(code=f'GIFT{i}',tier_id='pro',duration_days=30,enabled=True,created_at=now,updated_at=now))
            db.add(SubscriptionOrder(id='paid-order', logical_order_id='paid-op', user_id='u4', tier_id='pro', chain_id='test', amount='90', status='PAID',activated=False,created_at=now,updated_at=now))
            await db.commit()
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(config=SimpleNamespace(ENABLE_KYBER_TOKEN_BILLING=True))))
        reservations, applied = {}, {}
        fail_commit = set()
        reject_capacity = set()
        async def remote(req, method, path, payload=None):
            if path.endswith('/status'): return 200, {'enabled':True}
            op, uid = payload['operationId'], payload['userId']
            if path.endswith('/reserve'):
                if uid in reject_capacity: return 409, {'message':'账号资源不足，请联系管理员处理'}
                reservations.setdefault(op, payload)
                return 200, {'id':op}
            if path.endswith('/cancel'):
                reservations.pop(op,None); return 200, {}
            if op in fail_commit:
                fail_commit.remove(op); return 503, {}
            applied[op] = payload
            return 200, {'applied':True}
        allocation._internal_request = remote
        # Concurrent polls extend exactly once and commit the activation flag together.
        results = await asyncio.gather(*(allocation.change_subscription(request,'u4','pro',operation_id='paid-op',order_id='paid-order',duration_days=30) for _ in range(8)))
        self.assertEqual(len({r.id for r in results}),1)
        self.assertLessEqual(abs(results[0].expires_at-(now+30*86400)),10)
        # Two users cannot consume one gift. Losing transaction has no paid entitlement.
        cards = await asyncio.gather(*(allocation.change_subscription(request,uid,'pro',operation_id='gift:GIFT1',gift_code='GIFT1') for uid in ('u1','u2')),return_exceptions=True)
        self.assertEqual(sum(not isinstance(r,Exception) for r in cards),1)
        # Capacity failure leaves both local plan and gift unchanged.
        reject_capacity.add('k3')
        with self.assertRaises(Exception): await allocation.change_subscription(request,'u3','pro',operation_id='gift:GIFT2',gift_code='GIFT2')
        async with get_async_db() as db:
            self.assertIsNone((await db.get(GiftCard,'GIFT2')).redeemed_by)
            self.assertIsNone((await db.execute(select(UserSubscription).where(UserSubscription.user_id=='u3'))).scalar_one_or_none())
        reject_capacity.clear()
        # Lost commit response: grant and gift remain durable; retry does not add a month.
        fail_commit.add('gift:GIFT2')
        with self.assertRaises(Exception): await allocation.change_subscription(request,'u3','pro',operation_id='gift:GIFT2',gift_code='GIFT2')
        async with get_async_db() as db:
            change = await db.get(SubscriptionChange,'gift:GIFT2')
            original_expiry = change.expires_at
            self.assertFalse(change.synced)
            self.assertEqual((await db.get(GiftCard,'GIFT2')).redeemed_by,'u3')
        retry = await allocation.change_subscription(request,'u3','pro',operation_id='gift:GIFT2',gift_code='GIFT2')
        self.assertEqual(retry.expires_at,original_expiry)
        await allocation.change_subscription(request,'u3','free',operation_id='cancel-u3')
        self.assertEqual(applied['cancel-u3']['tier'],'free')
        self.assertGreater(applied['cancel-u3']['version'],applied['gift:GIFT2']['version'])
        async with get_async_db() as db:
            self.assertIsNone((await db.execute(select(UserSubscription).where(UserSubscription.user_id=='u3',UserSubscription.status=='active'))).scalar_one_or_none())
        print('PASS: concurrent payment/gift, insufficient capacity, lost commit response, idempotent retry, cancellation outbox')


if __name__ == '__main__': unittest.main()
