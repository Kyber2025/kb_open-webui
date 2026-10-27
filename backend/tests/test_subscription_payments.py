"""Signed checkout and real PostgreSQL transaction tests; no live payments."""
import asyncio
import hashlib
import os
import time
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import urlparse

assert urlparse(os.environ.get('DATABASE_URL', '')).path == '/owui_subscription_test', 'Disposable database required'
from fastapi import HTTPException
from sqlalchemy import select
from open_webui.internal.db import Base, engine, get_async_db
from open_webui.models.users import User
from open_webui.models.kyber_accounts import UserKyberAccount
from open_webui.models.subscriptions import SubscriptionTier, SubscriptionOrder, UserSubscription
from open_webui.models.subscription_changes import SubscriptionChange
from open_webui.utils import subscription_payments as payments, claude_allocation as allocation, subscription


class PaymentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
        self.now = int(time.time())
        self.user = SimpleNamespace(id='checkout-user', role='user')
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(config=SimpleNamespace(
            ENABLE_KYBER_TOKEN_BILLING=True, SUBSCRIPTION_CHAINS=[{'id':'56'}]))))
        async with get_async_db() as db:
            db.add(User(id=self.user.id,email='checkout@test.invalid',name='Checkout',role='user'))
            db.add(UserKyberAccount(user_id=self.user.id,kyber_user_id='gateway-test',kyber_email='checkout@test.invalid',created_at=self.now,updated_at=self.now))
            for tier in ('free','pro','max','ultra'):
                db.add(SubscriptionTier(id=tier,name=tier,enabled=True,price_usd=90,duration_days=30,created_at=self.now,updated_at=self.now))
            await db.commit()
        self.reservations, self.orders, self.applied = {}, {}, {}
        self.full = False
        async def resource(req, method, path, payload=None):
            if path.endswith('/status'): return 200, {'enabled':True}
            op=payload['operationId']
            if path.endswith('/reserve'):
                if self.full: return 409, {'message':'Sold out'}
                self.reservations.setdefault(op,payload)
            elif path.endswith('/cancel'): self.reservations.pop(op,None)
            else: self.applied[op]=payload
            return 200, {}
        async def merchant(req, method, suffix, payload=None):
            if method=='POST':
                key=payload['orderId']+'_56'
                self.orders.setdefault(key,{'orderId':key,'merchantOrderId':payload['orderId'],'chainId':'56',
                    'token':'USDT','amount':'90','status':'PENDING','finalStatus':False,'address':'0x-test-address',
                    'expiresAt':datetime.fromtimestamp(self.now+86400,timezone.utc).isoformat()})
            else: key=suffix.split('/')[-1]
            return dict(self.orders[key])
        self.patches=[patch.dict(os.environ,{'SUBSCRIPTION_PAYMENT_APP_ID':'test','SUBSCRIPTION_PAYMENT_SECRET':'test-only'}),
            patch.object(allocation,'_internal_request',resource),patch.object(payments,'merchant_request',merchant),
            patch.object(subscription,'get_subscription_state',AsyncMock(return_value={})),
            patch.object(subscription,'sync_user_rate_limits_to_kyber',AsyncMock(return_value=True))]
        for p in self.patches:p.start()

    async def asyncTearDown(self):
        for p in reversed(self.patches):p.stop()

    async def test_parallel_create_payment_and_replay_grant_once(self):
        created=await asyncio.gather(*(payments.create_checkout(self.request,self.user,'pro','56') for _ in range(6)))
        self.assertEqual(len({x['order_id'] for x in created}),1)
        self.assertEqual(len(self.reservations),1)
        order_id=created[0]['order_id']
        self.orders[order_id].update(status='PAID',paidAmount='90',finalStatus=True,txHash='test-chain-hash')
        results=await asyncio.gather(*(payments.sync_checkout(self.request,self.user,order_id) for _ in range(6)))
        self.assertTrue(all(x['activated'] for x in results))
        async with get_async_db() as db:
            subs=(await db.execute(select(UserSubscription))).scalars().all()
            self.assertEqual(len(subs),1)
            self.assertLess(abs(subs[0].expires_at-self.now-30*86400),15)
            self.assertEqual(len((await db.execute(select(SubscriptionChange))).scalars().all()),1)

    async def test_capacity_retired_and_unauthorized_order_fail_closed(self):
        self.full=True
        for tier in ('pro','max'):
            with self.assertRaises(HTTPException):await payments.create_checkout(self.request,self.user,tier,'56')
        self.assertEqual(self.orders,{})
        self.full=False
        created=await payments.create_checkout(self.request,self.user,'pro','56')
        with self.assertRaises(HTTPException):
            await payments.sync_checkout(self.request,SimpleNamespace(id='another-user'),created['order_id'])

    async def test_underpayment_and_wrong_identity_never_grant(self):
        created=await payments.create_checkout(self.request,self.user,'pro','56')
        order=self.orders[created['order_id']]
        order.update(status='PAID',paidAmount='89.99',finalStatus=True,txHash='test-hash')
        with self.assertRaises(HTTPException):await payments.sync_checkout(self.request,self.user,created['order_id'])
        order.update(paidAmount='90',merchantOrderId='different-order')
        with self.assertRaises(HTTPException):await payments.sync_checkout(self.request,self.user,created['order_id'])
        async with get_async_db() as db:self.assertFalse((await db.get(SubscriptionOrder,created['order_id'])).activated)

    async def test_expiry_grace_retains_seat_until_final(self):
        created=await payments.create_checkout(self.request,self.user,'pro','56')
        order=self.orders[created['order_id']]
        order.update(status='EXPIRED',finalStatus=False)
        state=await payments.sync_checkout(self.request,self.user,created['order_id'])
        self.assertEqual(state['status'],'EXPIRED_CHECKING');self.assertEqual(len(self.reservations),1)
        order['finalStatus']=True
        state=await payments.sync_checkout(self.request,self.user,created['order_id'])
        self.assertEqual(state['status'],'EXPIRED');self.assertEqual(len(self.reservations),0)

    def test_signed_response_rejects_tampering_and_stale_timestamp(self):
        timestamp=str(int(time.time()));nonce='test-nonce';body=b'{"status":"PENDING"}'
        sig=payments.signature('test-only','RESPONSE',timestamp,nonce,hashlib.sha256(body).hexdigest())
        payments.verify_signature('test-only','RESPONSE',timestamp,nonce,body,sig)
        for kind,ts,n,b in [('NOTIFY',timestamp,nonce,body),('RESPONSE',timestamp,'other',body),
                            ('RESPONSE',timestamp,nonce,b'{"status":"PAID"}'),('RESPONSE','1',nonce,body)]:
            with self.assertRaises(HTTPException):payments.verify_signature('test-only',kind,ts,n,b,sig)

    async def test_signed_ping_ack_matches_payment_service_plain_text_contract(self):
        body=b'{"event":"PING","data":null}'
        ts=str(int(time.time()));nonce='payment-ping'
        request=SimpleNamespace(body=AsyncMock(return_value=body),headers={
            'X-App-Id':'test','X-Timestamp':ts,'X-Nonce':nonce,
            'X-Signature':payments.signature('test-only','NOTIFY',ts,nonce,hashlib.sha256(body).hexdigest())})
        response=await payments.payment_notify(request)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.body,b'success')
        self.assertEqual(response.media_type,'text/plain')
        request.headers['X-Signature']='invalid'
        with self.assertRaises(HTTPException):await payments.payment_notify(request)

    async def test_unlinked_local_admin_sees_stock_without_purchase_permission(self):
        from open_webui.models.kyber_accounts import UserKyberAccounts
        with patch.object(UserKyberAccounts,'get_by_user_id',AsyncMock(return_value=None)), \
             patch.object(allocation,'resource_call',AsyncMock(return_value={'pro':{'remaining':2,'can_purchase':True}})):
            rows=await payments.plans_with_capacity(self.request,self.user)
        pro=next(row for row in rows if row['id']=='pro')
        self.assertEqual(pro['remaining'],2)
        self.assertFalse(pro['can_purchase'])


if __name__=='__main__':unittest.main()
