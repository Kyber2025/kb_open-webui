"""Admin attribution filters/counts execute against isolated SQLite, before pagination."""
import datetime
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from fastapi import Depends
from test_admin_user_link import lift
import test_reseller_invites as reseller_tests


class AdminResellerUsersTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await reseller_tests.ResellerTests.asyncSetUp(self)
        namespace = dict(vars(sa))
        namespace.update(Base=self.models.Base, BaseModel=BaseModel, ConfigDict=ConfigDict,
            field_validator=field_validator, model_validator=model_validator, datetime=datetime,
            _DEFAULT_PROFILE_IMAGE_URL='/user/{user_id}',
            get_async_db_context=self.models.get_async_db_context,
            throttle=lambda _: lambda fn: fn, DATABASE_USER_ACTIVE_STATUS_UPDATE_INTERVAL=1)
        self.users = lift('models/users.py', {'User','UserSettings','UserModel','UsersTable',
            'ResellerAttribution','UserGroupIdsModel'}, namespace)
        for name in ('UserModel','UserGroupIdsModel'):
            getattr(self.users,name).model_rebuild(_types_namespace=self.users.__dict__)
        async with self.engine.begin() as conn: await conn.run_sync(self.models.Base.metadata.create_all)
        self.other = await self.invites.create('Disabled reseller')
        await self.invites.set_enabled(self.other['id'], False)
        async with AsyncSession(self.engine) as db:
            for uid in ('ordinary','customer','customer2','disabled'):
                db.add(self.users.User(id=uid,email=uid+'@test.invalid',name=uid,role='user',
                    last_active_at=1,created_at=1,updated_at=1))
            db.add_all([self.models.ResellerCustomer(user_id='customer2',invite_id=self.invite['id'],created_at=1),
                self.models.ResellerCustomer(user_id='disabled',invite_id=self.other['id'],created_at=1)])
            await db.commit()
        self.dependencies = patch.dict('sys.modules', {
            'open_webui.models.channels':SimpleNamespace(ChannelMember=None),
            'open_webui.models.groups':SimpleNamespace(GroupMember=None),
            'open_webui.utils.subscription':SimpleNamespace(DEFAULT_TIER_ID='free')})
        self.dependencies.start()
        self.route = lift('routers/users.py', {'get_users'}, dict(Depends=Depends,
            get_admin_user=lambda: None, get_async_session=lambda: None,
            PAGE_ITEM_COUNT=30, Users=self.users.UsersTable(),
            Groups=SimpleNamespace(get_groups_by_member_ids=AsyncMock(return_value={})),
            UserSubscriptions=SimpleNamespace(paid_tier_by_user=AsyncMock(return_value={'customer':'pro','ordinary':'pro'})),
            ResellerInvites=self.invites, UserGroupIdsModel=self.users.UserGroupIdsModel))

    async def asyncTearDown(self):
        self.dependencies.stop()
        await reseller_tests.ResellerTests.asyncTearDown(self)

    async def list(self, **filters):
        async with AsyncSession(self.engine) as db:
            return await self.route.get_users(order_by='name',direction='asc',db=db,user=None,**filters)

    async def test_source_and_agent_filter_before_pagination_and_total(self):
        page = await self.list(source='reseller',limit=1,page=2)
        self.assertEqual(page['total'],3)
        self.assertEqual([u.id for u in page['users']],['customer2'])
        self.assertEqual((await self.list(source='ordinary'))['total'],1)
        self.assertEqual((await self.list(reseller_invite_id=self.invite['id']))['total'],2)
        self.assertEqual((await self.list(reseller_invite_id='missing'))['total'],0)

    async def test_source_combines_with_name_and_effective_plan(self):
        result = await self.list(source='reseller',query='customer',plan='pro')
        self.assertEqual([u.id for u in result['users']],['customer'])
        result = await self.list(source='reseller',reseller_invite_id=self.invite['id'],plan='free')
        self.assertEqual([u.id for u in result['users']],['customer2'])
        self.assertEqual((await self.list(source='ordinary',plan='free'))['total'],0)

    async def test_disabled_invitation_keeps_label_without_invitation_secrets(self):
        result=await self.list(reseller_invite_id=self.other['id'])
        row=result['users'][0].model_dump()
        self.assertEqual(row['reseller']['name'],'Disabled reseller')
        self.assertFalse(row['reseller']['enabled'])
        self.assertNotIn('token',row['reseller'])
        self.assertNotIn('short_code',row['reseller'])
        ordinary=(await self.list(source='ordinary'))['users'][0]
        self.assertIsNone(ordinary.reseller)
        self.assertNotIn('reseller', self.users.UserModel.model_validate(ordinary.model_dump()).model_dump())

    async def test_no_filters_keeps_all_users_and_names_are_server_owned(self):
        result=await self.list()
        self.assertEqual(result['total'],4)
        self.assertEqual(next(u for u in result['users'] if u.id=='customer').reseller.name,'Agent test')

if __name__ == '__main__': unittest.main()
