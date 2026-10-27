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
                db.add(SubscriptionTier(id=tier,name=tier,enabled=True,price_usd=360 if tier=='ultra' else 120,duration_days=30,created_at=self.now,updated_at=self.now))
            await db.commit()
        self.reservations, self.orders, self.applied = {}, {}, {}
        self.full = False
        async def resource(req, method, path, payload=None):
            if path.endswith('/status'): return 200, {'enabled':True}
            if path.endswith('/capacity'): return 200, {t:{'remaining':0 if self.full else 2,'can_purchase':not self.full} for t in ('pro','ultra')}
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
                    'token':'USDT','amount':payload['amount'],'status':'PENDING','finalStatus':False,'address':'0x-test-address',
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
        self.assertEqual(len(self.reservations),0)
        order_id=created[0]['order_id']
        self.orders[order_id].update(status='PAID',paidAmount='120',finalStatus=True,txHash='test-chain-hash')
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
        order.update(status='PAID',paidAmount='119.99',finalStatus=True,txHash='test-hash')
        with self.assertRaises(HTTPException):await payments.sync_checkout(self.request,self.user,created['order_id'])
        order.update(paidAmount='120',merchantOrderId='different-order')
        with self.assertRaises(HTTPException):await payments.sync_checkout(self.request,self.user,created['order_id'])
        async with get_async_db() as db:self.assertFalse((await db.get(SubscriptionOrder,created['order_id'])).activated)

    async def test_unpaid_expiry_never_holds_a_seat(self):
        created=await payments.create_checkout(self.request,self.user,'pro','56')
        order=self.orders[created['order_id']]
        order.update(status='EXPIRED',finalStatus=False)
        state=await payments.sync_checkout(self.request,self.user,created['order_id'])
        self.assertEqual(state['status'],'EXPIRED_CHECKING');self.assertEqual(len(self.reservations),0)
        order['finalStatus']=True
        state=await payments.sync_checkout(self.request,self.user,created['order_id'])
        self.assertEqual(state['status'],'EXPIRED');self.assertEqual(len(self.reservations),0)

    async def test_paid_upgrade_replaces_5x_at_full_price_with_fresh_30_days(self):
        old_expiry=self.now+365*86400
        async with get_async_db() as db:
            db.add(UserSubscription(id='existing-pro',user_id=self.user.id,tier_id='pro',status='active',
                started_at=self.now-86400,expires_at=old_expiry,created_at=self.now,updated_at=self.now))
            await db.commit()
        created=await payments.create_checkout(self.request,self.user,'ultra','56')
        self.assertEqual(created['amount'],'360.0')
        async with get_async_db() as db:self.assertEqual((await db.get(UserSubscription,'existing-pro')).status,'active')
        self.orders[created['order_id']].update(status='PAID',paidAmount='360',finalStatus=True,txHash='upgrade-hash')
        await payments.sync_checkout(self.request,self.user,created['order_id'])
        await payments.sync_checkout(self.request,self.user,created['order_id'])
        async with get_async_db() as db:
            old=await db.get(UserSubscription,'existing-pro')
            self.assertEqual((old.status,old.expires_at),('expired',old_expiry))
            active=(await db.execute(select(UserSubscription).where(UserSubscription.status=='active'))).scalars().all()
            self.assertEqual(len(active),1);self.assertEqual(active[0].tier_id,'ultra')
            self.assertLess(abs(active[0].expires_at-self.now-30*86400),15)
            self.assertEqual(len((await db.execute(select(SubscriptionChange))).scalars().all()),1)

    async def test_unpaid_orders_do_not_hold_capacity_or_lock_other_tiers(self):
        pro = await payments.create_checkout(self.request,self.user,'pro','56')
        ultra = await payments.create_checkout(self.request,self.user,'ultra','56')
        self.assertNotEqual(pro['order_id'],ultra['order_id'])
        self.assertEqual(self.reservations,{})
        self.assertEqual((await payments.latest_checkout(self.request,self.user,'pro'))['order_id'],pro['order_id'])
        self.assertEqual((await payments.latest_checkout(self.request,self.user,'ultra'))['order_id'],ultra['order_id'])
        self.full=True
        self.orders[ultra['order_id']].update(status='PAID',paidAmount='360',finalStatus=True,txHash='race-paid')
        pending=await payments.sync_checkout(self.request,self.user,ultra['order_id'])
        self.assertEqual(pending['status'],'PAID_REQUIRES_ADMIN'); self.assertFalse(pending['activated'])
        async with get_async_db() as db:
            self.assertEqual(len((await db.execute(select(UserSubscription))).scalars().all()),0)
        # Only a user/admin-triggered recheck retries after capacity is resolved.
        self.full=False
        self.assertTrue((await payments.sync_checkout(self.request,self.user,ultra['order_id']))['activated'])
        self.assertEqual(len(self.reservations),1)
        # Paying an older 5x invoice later must not overwrite the active 20x.
        self.orders[pro['order_id']].update(status='PAID',paidAmount='120',finalStatus=True,txHash='late-pro')
        self.assertFalse((await payments.sync_checkout(self.request,self.user,pro['order_id']))['activated'])
        async with get_async_db() as db:
            active=(await db.execute(select(UserSubscription).where(UserSubscription.status=='active'))).scalars().all()
            self.assertEqual([s.tier_id for s in active],['ultra'])

    async def test_remote_sync_failure_does_not_report_activation(self):
        created=await payments.create_checkout(self.request,self.user,'pro','56')
        self.orders[created['order_id']].update(status='PAID',paidAmount='120',finalStatus=True,txHash='sync-paid')
        with patch.object(subscription,'sync_user_rate_limits_to_kyber',AsyncMock(return_value=False)):
            self.assertFalse((await payments.sync_checkout(self.request,self.user,created['order_id']))['activated'])
        self.assertTrue((await payments.sync_checkout(self.request,self.user,created['order_id']))['activated'])

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
