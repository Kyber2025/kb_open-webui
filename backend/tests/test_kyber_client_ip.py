"""Sign-up and password-reset relays must carry the end user's IP to KyberRouter.

KyberRouter limits code emails (20/hour) and account creation (3/hour, 5/day) per
client IP, read from X-Forwarded-For. Without the header every user behind one
app node shares those limits. Runs on the standard library alone: the functions
under test are lifted from their modules and given stand-ins for aiohttp,
FastAPI and the database."""
import ast
import ipaddress
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Optional
from unittest.mock import AsyncMock

ROOT = Path(__file__).parents[1] / 'open_webui'


def lift(relative: str, names: set, namespace: dict) -> ModuleType:
    source = ROOT / relative
    tree = ast.parse(source.read_text())
    nodes = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name in names:
            node.decorator_list = []  # route decorators need a live router
            nodes.append(node)
    assert {n.name for n in nodes} == names, f'missing in {relative}: {names - {n.name for n in nodes}}'
    module = ModuleType('isolated_' + source.stem)
    module.__dict__.update(namespace)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), module.__dict__)
    return module


calls = []


class FakeResponse:
    status = 200

    async def json(self, content_type=None):
        return {'accessToken': 'jwt', 'cooldownSec': 60, 'user': {}}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    def __init__(self, timeout=None):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def post(self, url, json=None, headers=None):
        calls.append({'url': url, 'headers': dict(headers or {})})
        return FakeResponse()


kyber = lift(
    'utils/kyber.py',
    {'KyberError', '_err_message', '_post', 'kyber_send_register_code', 'kyber_register_verify',
     'kyber_forgot_password', 'kyber_reset_password'},
    {'ipaddress': ipaddress, 'Optional': Optional, 'aiohttp': SimpleNamespace(ClientSession=FakeSession),
     '_TIMEOUT': None},
)
guest = lift('utils/guest.py', {'get_client_ip'}, {'ipaddress': ipaddress, 'Request': object})


class HTTPException(Exception):
    def __init__(self, status_code, detail=None):
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


relay = {name: AsyncMock(return_value={'cooldownSec': 60, 'user': {}, 'accessToken': 'jwt'})
         for name in ('kyber_send_register_code', 'kyber_register_verify', 'kyber_forgot_password',
                      'kyber_reset_password')}
auths = lift(
    'routers/auths.py',
    {'register_send_code', 'register_verify', 'password_forgot', 'password_reset'},
    {**relay,
     'Request': object, 'Response': object, 'AsyncSession': object, 'RegisterSendCodeForm': object,
     'RegisterVerifyForm': object, 'ForgotPasswordForm': object, 'ResetPasswordForm': object,
     'Depends': lambda dependency=None: None, 'get_async_session': None,
     'HTTPException': HTTPException, 'status': SimpleNamespace(HTTP_403_FORBIDDEN=403, HTTP_400_BAD_REQUEST=400),
     'ERROR_MESSAGES': SimpleNamespace(ACCESS_PROHIBITED='prohibited', INVALID_EMAIL_FORMAT='bad email'),
     'validate_email_format': lambda email: '@' in email, 'KyberError': kyber.KyberError,
     'kyber_base': lambda request: 'http://kyber.invalid/api', 'get_client_ip': guest.get_client_ip,
     'Users': SimpleNamespace(get_user_by_email=AsyncMock(return_value=SimpleNamespace(id='u1', role='user'))),
     'ensure_kyber_link': AsyncMock(), 'create_session_response': AsyncMock(return_value='session'),
     'signup_handler': AsyncMock(), 'log': SimpleNamespace(exception=lambda *a, **k: None)},
)


class ForwardedForTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        calls.clear()

    async def test_every_relay_call_carries_the_client_ip(self):
        base = 'http://kyber.invalid/api'
        await kyber.kyber_send_register_code(base, 'a@example.com', client_ip='203.0.113.9')
        await kyber.kyber_register_verify(base, 'a@example.com', '123456', 'password1', client_ip='203.0.113.9')
        await kyber.kyber_forgot_password(base, 'a@example.com', client_ip='203.0.113.9')
        await kyber.kyber_reset_password(base, 'a@example.com', '123456', 'password1', client_ip='203.0.113.9')
        self.assertEqual([c['url'].removeprefix(base) for c in calls],
                         ['/auth/register/send-code', '/auth/register/verify', '/auth/forgot-password',
                          '/auth/reset-password'])
        self.assertEqual({c['headers'].get('X-Forwarded-For') for c in calls}, {'203.0.113.9'})

    async def test_only_a_well_formed_address_is_forwarded(self):
        base = 'http://kyber.invalid/api'
        for value in (None, '', 'unknown', '198.51.100.1, 203.0.113.9'):
            await kyber.kyber_send_register_code(base, 'a@example.com', client_ip=value)
        await kyber.kyber_send_register_code(base, 'a@example.com', client_ip=' 2001:db8::1 ')
        self.assertEqual([c['headers'].get('X-Forwarded-For') for c in calls], [None] * 4 + ['2001:db8::1'])


class RouteTests(unittest.IsolatedAsyncioTestCase):
    def request(self, xff):
        config = SimpleNamespace(ENABLE_KYBER_AUTH_BRIDGE=True)
        return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(config=config)),
                               headers={'x-forwarded-for': xff}, client=SimpleNamespace(host='172.17.0.1'))

    async def test_routes_pass_the_edge_observed_address_not_a_client_supplied_one(self):
        # A client-supplied first hop, the address the ALB saw, then the private proxies.
        # (Documentation ranges such as 198.51.100.0/24 count as non-public here.)
        request = self.request('1.1.1.1, 8.8.4.4, 10.0.0.5, 127.0.0.1')
        form = SimpleNamespace(email='User@Example.com', code=' 123456 ', password='password1', name=None,
                               new_password='password2')
        await auths.register_send_code(request, form, db=None)
        await auths.register_verify(request, None, form, db=None)
        await auths.password_forgot(request, form, db=None)
        await auths.password_reset(request, form, db=None)
        for name, mock in relay.items():
            self.assertEqual(mock.await_args.kwargs.get('client_ip'), '8.8.4.4', name)


if __name__ == '__main__':
    unittest.main()
