"""Real HTTP introspection + transactional SQL tests for mobile billing identity.

Runs with aiohttp, FastAPI, SQLAlchemy and aiosqlite. Lift the production functions
so the test does not initialize the entire inference server or production DB.
"""
import ast
import time
import unittest
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import aiohttp
from aiohttp import web
from fastapi import HTTPException, Request
from sqlalchemy import Boolean, Column, Integer, String, func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class User(Base):
    __tablename__ = 'user'
    id = Column(String, primary_key=True)
    email = Column(String, unique=True)
    role = Column(String)
    name = Column(String)
    profile_image_url = Column(String)
    created_at = Column(Integer)
    updated_at = Column(Integer)
    last_active_at = Column(Integer)


class Auth(Base):
    __tablename__ = 'auth'
    id = Column(String, primary_key=True)
    email = Column(String)
    password = Column(String)
    active = Column(Boolean)


class UserKyberAccount(Base):
    __tablename__ = 'user_kyber_account'
    user_id = Column(String, primary_key=True)
    kyber_user_id = Column(String)
    kyber_email = Column(String)
    extra_usage_enabled = Column(Boolean)
    created_at = Column(Integer)
    updated_at = Column(Integer)


SOURCE = Path(__file__).parents[1] / 'open_webui/utils/mobile_subscription_auth.py'
NODES = [n for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.AsyncFunctionDef)]


class MobileSubscriptionAuthTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        @asynccontextmanager
        async def db_context():
            async with self.sessions() as session:
                yield session

        self.namespace = dict(globals(), get_async_db_context=db_context,
            UserModel=SimpleNamespace(model_validate=lambda user: SimpleNamespace(id=user.id, role=user.role, email=user.email)),
            get_password_hash=lambda password: 'test-hash:' + password,
            kyber_base=lambda request: self.base)
        exec(compile(ast.Module(body=NODES, type_ignores=[]), str(SOURCE), 'exec'), self.namespace)
        self.resolve = self.namespace['resolve_billing_user']
        self.introspect = self.namespace['gateway_identity']
        self.status, self.payload, self.calls = 200, {'user': {'id': 'gateway-a', 'email': 'a@example.test'}}, []
        self.redirects = 0
        async def identity(request):
            self.calls.append(dict(request.headers))
            if self.status == 302:
                return web.Response(status=302, headers={'Location': '/redirected'})
            return web.json_response(self.payload, status=self.status)
        async def redirected(request):
            self.redirects += 1
            return web.json_response(self.payload)
        app = web.Application()
        app.router.add_get('/auth/me', identity)
        app.router.add_get('/redirected', redirected)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, '127.0.0.1', 0)
        await site.start()
        self.base = 'http://127.0.0.1:' + str(site._server.sockets[0].getsockname()[1])

    async def asyncTearDown(self):
        await self.runner.cleanup()
        await self.engine.dispose()

    def request(self, auth='Bearer app-jwt', enabled=True):
        return SimpleNamespace(headers={'authorization': auth, 'x-user-id': 'victim'},
            app=SimpleNamespace(state=SimpleNamespace(config=SimpleNamespace(ENABLE_KYBER_AUTH_BRIDGE=enabled))))

    async def seed(self, uid='local-a', kyber='gateway-a', email='a@example.test', role='user', active=True):
        async with self.sessions() as db:
            db.add(User(id=uid, email=email, role=role, name='Fixture'))
            db.add(Auth(id=uid, email=email, active=active))
            if kyber:
                db.add(UserKyberAccount(user_id=uid, kyber_user_id=kyber, kyber_email=email))
            await db.commit()

    async def reject(self, awaitable, status):
        with self.assertRaises(HTTPException) as caught:
            await awaitable
        self.assertEqual(caught.exception.status_code, status)

    async def test_existing_login_uses_server_identity_and_stable_link(self):
        await self.seed()
        identity = await self.introspect(self.request())
        user = await self.resolve(identity)
        self.assertEqual(user.id, 'local-a')
        self.assertEqual(self.calls[0]['Authorization'], 'Bearer app-jwt')
        self.assertNotIn('x-user-id', self.calls[0])
        # Email changes do not move a durable account link to another user.
        identity['email'] = 'changed@example.test'
        self.assertEqual((await self.resolve(identity)).id, 'local-a')

    async def test_missing_malformed_and_disabled_credentials_are_rejected(self):
        for auth in ['', 'Basic test', 'Bearer ', 'Bearer bad token']:
            await self.reject(self.introspect(self.request(auth)), 401)
        await self.reject(self.introspect(self.request(enabled=False)), 403)
        self.assertFalse(self.calls)

    async def test_expired_deleted_and_banned_account_cannot_enter_billing(self):
        for upstream, expected in [(401,401), (404,401), (403,403), (500,503)]:
            self.status = upstream
            await self.reject(self.introspect(self.request()), expected)

    async def test_redirect_never_receives_account_token(self):
        self.status = 302
        await self.reject(self.introspect(self.request()), 503)
        self.assertEqual(self.redirects, 0)

    async def test_malformed_identity_fails_closed(self):
        for payload in [[], {}, {'user': {}}, {'user': {'id':'a','email':None}}]:
            self.payload = payload
            await self.reject(self.introspect(self.request()), 503)

    async def test_first_use_creates_one_ordinary_shadow_without_admin_or_api_key(self):
        identity = self.payload['user']
        first = await self.resolve(identity)
        second = await self.resolve(identity)
        self.assertEqual(first.id, second.id)
        self.assertEqual(first.role, 'user')
        async with self.sessions() as db:
            self.assertEqual(len((await db.execute(select(User))).scalars().all()), 1)
            self.assertEqual((await db.get(UserKyberAccount, first.id)).kyber_user_id, 'gateway-a')
            self.assertTrue((await db.get(Auth, first.id)).active)

    async def test_active_unlinked_ordinary_account_keeps_existing_subscription_owner(self):
        await self.seed(kyber=None)
        self.assertEqual((await self.resolve(self.payload['user'])).id, 'local-a')

    async def test_foreign_link_cannot_be_reassigned_by_matching_email(self):
        await self.seed(kyber='gateway-victim')
        await self.reject(self.resolve(self.payload['user']), 409)
        async with self.sessions() as db:
            self.assertEqual((await db.get(UserKyberAccount, 'local-a')).kyber_user_id, 'gateway-victim')

    async def test_unlinked_admin_pending_and_disabled_are_not_activated(self):
        for index, (role, active) in enumerate([('admin',True), ('pending',True), ('user',False)]):
            email = f'account{index}@example.test'
            await self.seed(uid=f'local-{index}', kyber=None, email=email, role=role, active=active)
            await self.reject(self.resolve({'id':f'gateway-{index}','email':email}), 403 if role == 'user' else 409)
        async with self.sessions() as db:
            self.assertFalse((await db.execute(select(UserKyberAccount))).scalars().all())

    async def test_existing_disabled_link_and_ambiguous_link_fail_closed(self):
        await self.seed(active=False)
        await self.reject(self.resolve(self.payload['user']), 403)
        await self.seed(uid='local-b', email='b@example.test')
        await self.reject(self.resolve(self.payload['user']), 409)

    async def test_mobile_scope_is_four_billing_routes_only(self):
        tree = ast.parse((SOURCE.parents[1] / 'routers/subscriptions.py').read_text())
        routes = []
        for node in tree.body:
            if isinstance(node, ast.AsyncFunctionDef):
                for decorator in node.decorator_list:
                    if isinstance(decorator, ast.Call) and decorator.args and isinstance(decorator.args[0], ast.Constant):
                        path = decorator.args[0].value
                        if path.startswith('/mobile/'):
                            routes.append(path)
                            self.assertIn('Depends(get_mobile_subscription_user)', ast.unparse(node.args))
        self.assertEqual(set(routes), {'/mobile/me','/mobile/tiers','/mobile/tiers/{tier_id}/models','/mobile/redeem'})


if __name__ == '__main__':
    unittest.main()
