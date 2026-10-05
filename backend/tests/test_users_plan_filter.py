"""Admin user list filtered by EFFECTIVE plan, against a disposable sqlite database."""
import os
import time
import unittest

assert os.environ.get('DATABASE_URL') == 'sqlite:////tmp/plan-filter-test.db', 'Disposable test database required'
from open_webui.internal.db import Base, engine
from open_webui.models.subscriptions import SubscriptionTier, UserSubscription
from open_webui.models.users import User
from open_webui.routers.users import get_users

Base.metadata.create_all(engine, tables=[User.__table__, SubscriptionTier.__table__, UserSubscription.__table__])


class PlanFilterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        now = int(time.time())
        from open_webui.internal.db import get_async_db_context

        async with get_async_db_context() as db:
            for table in (UserSubscription, SubscriptionTier, User):
                await db.execute(table.__table__.delete())
            for tid, enabled in (('free', True), ('pro', True), ('max', True), ('gone', False)):
                db.add(SubscriptionTier(id=tid, name=tid, enabled=enabled, created_at=now, updated_at=now))
            for uid in ('free-user', 'pro-user', 'max-user', 'expired', 'disabled', 'upgraded'):
                db.add(User(id=uid, name=uid, email=f'{uid}@test.invalid', role='user',
                            profile_image_url='', last_active_at=now, created_at=now, updated_at=now))
            subs = [
                ('pro-user', 'pro', 'active', now + 86400),
                ('max-user', 'max', 'active', now + 86400),
                ('expired', 'max', 'active', now - 10),
                ('disabled', 'gone', 'active', now + 86400),
                # furthest-out active subscription wins, as in the list's plan column
                ('upgraded', 'pro', 'active', now + 86400),
                ('upgraded', 'max', 'active', now + 2 * 86400),
            ]
            for i, (uid, tid, st, exp) in enumerate(subs):
                db.add(UserSubscription(id=f's{i}', user_id=uid, tier_id=tid, status=st,
                                        started_at=now, expires_at=exp, created_at=now, updated_at=now))
            await db.commit()

    async def list(self, plan=None, page=1, limit=None):
        from open_webui.internal.db import get_async_db_context

        async with get_async_db_context() as db:
            return await get_users(query=None, order_by='name', direction='asc', page=page,
                                   plan=plan, limit=limit, user=None, db=db)

    async def ids(self, plan):
        result = await self.list(plan)
        ids = sorted(u.id for u in result['users'])
        self.assertEqual(result['total'], len(ids))
        return ids

    async def test_paid_plans(self):
        self.assertEqual(await self.ids('pro'), ['pro-user'])
        self.assertEqual(await self.ids('MAX'), ['max-user', 'upgraded'])

    async def test_free_is_everyone_without_a_usable_paid_plan(self):
        self.assertEqual(await self.ids('free'), ['disabled', 'expired', 'free-user'])

    async def test_unknown_plan_is_empty_and_no_plan_is_everyone(self):
        self.assertEqual(await self.ids('nope'), [])
        self.assertEqual(len(await self.ids(None)), 6)

    async def test_page_size(self):
        first, last = await self.list(limit=4), await self.list(page=2, limit=4)
        self.assertEqual((len(first['users']), len(last['users']), first['total']), (4, 2, 6))
        self.assertEqual(len((await self.list(limit=0))['users']), 6)  # 0 → default page size
        self.assertEqual(len((await self.list(limit=-5))['users']), 1)


if __name__ == '__main__':
    unittest.main()
