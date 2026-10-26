"""Admin creation must be linked before success, with retryable remote preparation
and atomic local credentials/profile/link persistence. No production configuration.

Run: python -m unittest discover -s backend/tests -p test_admin_user_link.py -v
Requires the application's SQLAlchemy, aiosqlite and Pydantic dependencies.
"""
import __future__
import ast
import datetime
import logging
import sys
import time
import unittest
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import declarative_base
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

ROOT = Path(__file__).parents[1] / 'open_webui'


def lift(path, names, namespace):
    source = ROOT / path
    nodes = [n for n in ast.parse(source.read_text()).body
             if isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
    assert {n.name for n in nodes} == set(names)
    for node in nodes:
        node.decorator_list = []
    module = ModuleType('isolated_' + source.stem)
    module.__dict__.update(namespace)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec',
                 flags=__future__.annotations.compiler_flag), module.__dict__)
    return module


class HTTPException(Exception):
    def __init__(self, status_code, detail=None):
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.calls = []
        self.status = 200
        self.data = {'user': {'id': 'gateway-1', 'email': 'new@example.com'}, 'key': 'sk-or-fixture'}
        owner = self

        class Response:
            @property
            def status(self): return owner.status
            async def json(self, **kwargs): return owner.data
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass

        class Session(Response):
            def __init__(self, **kwargs): pass
            def post(self, url, **kwargs):
                owner.calls.append((url, kwargs))
                return Response()

        self.bridge = lift('utils/kyber.py', {'KyberError', 'kyber_provision_admin_user'}, {
            'aiohttp': SimpleNamespace(ClientSession=Session), '_TIMEOUT': None,
            'kyber_base': lambda request: 'http://gateway.invalid/api',
            'encrypt_data': lambda value: 'encrypted:' + value, 'log': logging.getLogger(__name__),
        })
        self.config = SimpleNamespace(KYBER_INTERNAL_SECRET='internal-fixture')
        self.patch = patch.dict(sys.modules, {'open_webui.config': self.config})
        self.patch.start()
        self.addCleanup(self.patch.stop)

    async def call(self):
        return await self.bridge.kyber_provision_admin_user(None, 'new@example.com', 'password-fixture', 'New')

    async def test_internal_request_and_encryption(self):
        result = await self.call()
        self.assertEqual(result, {'kyber_user_id': 'gateway-1', 'kyber_email': 'new@example.com', 'api_key_enc': 'encrypted:sk-or-fixture'})
        url, request = self.calls[0]
        self.assertEqual(url, 'http://gateway.invalid/api/internal/users/provision')
        self.assertEqual(request['headers']['X-Internal-Secret'], 'internal-fixture')

    async def test_failure_never_returns_partial_link_or_secret(self):
        for code, expected in [(409, 409), (400, 400), (500, 503), (401, 503)]:
            self.status = code
            with self.assertRaises(self.bridge.KyberError) as error: await self.call()
            self.assertEqual(error.exception.status, expected)
            self.assertNotIn('sk-or-', str(error.exception))
        self.status = 200
        self.data['user']['email'] = 'wrong@example.com'
        with self.assertRaises(self.bridge.KyberError): await self.call()
        self.config.KYBER_INTERNAL_SECRET = ''
        before = len(self.calls)
        with self.assertRaises(self.bridge.KyberError): await self.call()
        self.assertEqual(len(self.calls), before)


class RouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.link = {'kyber_user_id': 'gateway-1', 'kyber_email': 'new@example.com', 'api_key_enc': 'encrypted-fixture'}
        self.bridge_error = lift('utils/kyber.py', {'KyberError'}, {}).KyberError
        self.create = AsyncMock(return_value=SimpleNamespace(id='local-1', email='new@example.com', name='New', role='user'))
        self.provision = AsyncMock(return_value=self.link)
        self.lookup = AsyncMock(return_value=None)
        self.route = lift('routers/auths.py', {'add_user'}, {
            'Depends': lambda dep: None, 'get_admin_user': None, 'get_async_session': None,
            'HTTPException': HTTPException, 'status': SimpleNamespace(HTTP_400_BAD_REQUEST=400),
            'ERROR_MESSAGES': SimpleNamespace(INVALID_EMAIL_FORMAT='bad email', EMAIL_TAKEN='email taken', CREATE_USER_ERROR='failed'),
            'Users': SimpleNamespace(get_user_by_email=self.lookup),
            'Auths': SimpleNamespace(insert_new_auth=self.create),
            'validate_email_format': lambda email: '@' in email,
            'validate_password': lambda password: None, 'get_password_hash': lambda password: 'hashed-fixture',
            'kyber_provision_admin_user': self.provision, 'KyberError': self.bridge_error,
            'apply_default_group_assignment': AsyncMock(), 'parse_duration': lambda value: None,
            'create_token': lambda **kwargs: 'fixture-token', 'log': logging.getLogger(__name__),
        })
        self.config = SimpleNamespace(ENABLE_KYBER_AUTH_BRIDGE=True, DEFAULT_GROUP_ID=None, JWT_EXPIRES_IN='1d')
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(config=self.config)))
        self.form = SimpleNamespace(email=' New@Example.com ', password='password-fixture', name='New', profile_image_url='/user.png', role='user')

    async def test_success_passes_encrypted_link_to_atomic_create(self):
        result = await self.route.add_user(self.request, self.form, db=None)
        self.assertEqual(result['email'], 'new@example.com')
        self.provision.assert_awaited_once_with(self.request, 'new@example.com', 'password-fixture', 'New')
        self.assertEqual(self.create.await_args.kwargs['kyber_account'], self.link)
        self.assertEqual(self.create.await_args.args[1], 'hashed-fixture')

    async def test_remote_failure_does_not_create_local_user(self):
        self.provision.side_effect = self.bridge_error('retry provisioning', 503)
        with self.assertRaises(HTTPException) as error:
            await self.route.add_user(self.request, self.form, db=None)
        self.assertEqual(error.exception.status_code, 503)
        self.create.assert_not_awaited()
        self.provision.side_effect = None
        self.assertEqual((await self.route.add_user(self.request, self.form, db=None))['id'], 'local-1')

    async def test_duplicate_local_user_does_not_touch_gateway(self):
        self.lookup.return_value = SimpleNamespace(id='existing')
        with self.assertRaises(HTTPException): await self.route.add_user(self.request, self.form, db=None)
        self.provision.assert_not_awaited(); self.create.assert_not_awaited()

    async def test_bridge_disabled_and_pending_accounts_keep_local_flow(self):
        self.config.ENABLE_KYBER_AUTH_BRIDGE = False
        await self.route.add_user(self.request, self.form, db=None)
        self.provision.assert_not_awaited()
        self.assertIsNone(self.create.await_args.kwargs['kyber_account'])
        self.config.ENABLE_KYBER_AUTH_BRIDGE = True; self.form.role = 'pending'
        await self.route.add_user(self.request, self.form, db=None)
        self.provision.assert_not_awaited()


class AtomicPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.base = declarative_base()
        namespace = {name: getattr(sa, name) for name in ('Column', 'String', 'Text', 'Boolean', 'BigInteger', 'Date', 'JSON')}
        namespace.update(Base=self.base, BaseModel=BaseModel, ConfigDict=ConfigDict,
                         field_validator=field_validator, model_validator=model_validator, datetime=datetime,
                         _DEFAULT_PROFILE_IMAGE_URL='/api/v1/users/{user_id}/profile/image')
        users = lift('models/users.py', {'User', 'UserModel', 'UserSettings'}, namespace)
        users.UserModel.model_rebuild(_types_namespace=users.__dict__)
        links = lift('models/kyber_accounts.py', {'UserKyberAccount'}, namespace)
        self.link_model = links.UserKyberAccount

        @asynccontextmanager
        async def context(db): yield db

        auths = lift('models/auths.py', {'Auth', 'AuthsTable'}, {
            **namespace, 'User': users.User, 'UserModel': users.UserModel,
            'get_async_db_context': context, 'uuid': uuid, 'time': time, 'log': logging.getLogger(__name__),
        })
        self.auths = auths.AuthsTable()
        self.models = (auths.Auth, users.User, links.UserKyberAccount)
        self.engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with self.engine.begin() as conn: await conn.run_sync(self.base.metadata.create_all)
        self.patch = patch.dict(sys.modules, {'open_webui.models.kyber_accounts': links})
        self.patch.start()

    async def asyncTearDown(self):
        self.patch.stop(); await self.engine.dispose()

    async def create(self):
        async with AsyncSession(self.engine) as session:
            return await self.auths.insert_new_auth('new@example.com', 'hash-fixture', 'New', role='user', db=session,
                kyber_account={'kyber_user_id': 'gateway-1', 'kyber_email': 'new@example.com', 'api_key_enc': 'encrypted-fixture'})

    async def counts(self):
        async with AsyncSession(self.engine) as session:
            return [await session.scalar(sa.select(sa.func.count()).select_from(model)) for model in self.models]

    async def test_local_identity_credentials_and_link_are_committed_together(self):
        user = await self.create()
        self.assertEqual(await self.counts(), [1, 1, 1])
        async with AsyncSession(self.engine) as session:
            link = await session.get(self.link_model, user.id)
            self.assertEqual(link.kyber_user_id, 'gateway-1')
            self.assertEqual(link.api_key_enc, 'encrypted-fixture')

    async def test_link_insert_failure_rolls_back_auth_and_user_then_retry_works(self):
        def fail_link(conn, cursor, statement, parameters, context, executemany):
            if statement.startswith('INSERT INTO user_kyber_account'): raise RuntimeError('simulated link persistence failure')
        sa.event.listen(self.engine.sync_engine, 'before_cursor_execute', fail_link)
        with self.assertRaises(RuntimeError): await self.create()
        self.assertEqual(await self.counts(), [0, 0, 0])
        sa.event.remove(self.engine.sync_engine, 'before_cursor_execute', fail_link)
        await self.create()
        self.assertEqual(await self.counts(), [1, 1, 1])


if __name__ == '__main__':
    unittest.main()
