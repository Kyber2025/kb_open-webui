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
from open_webui.models.subscriptions import SubscriptionTier, SubscriptionOrder, UserSubscription, GiftCards
from open_webui.models.subscription_changes import SubscriptionChange
from open_webui.models.commerce import CommerceTransaction, CommerceHold
from open_webui.utils import subscription_payments as payments, claude_allocation as allocation, subscription


class PaymentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
        self.now = int(time.time())
        self.user = SimpleNamespace(id='checkout-user', role='user')
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(config=SimpleNamespace(
            ENABLE_KYBER_TOKEN_BILLING=True, SUBSCRIPTION_CHAINS=[{'id':'56'}, {'id':'1'}, {'id':'728126428'}]))))
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
                key=payload['orderId']+'_'+payload['chainId']
                self.orders.setdefault(key,{'orderId':key,'merchantOrderId':payload['orderId'],'chainId':payload['chainId'],
                    'token':'USDT','amount':payload['amount'],'status':'PENDING','finalStatus':False,'address':'0x-test-address',
                    'expiresAt':datetime.fromtimestamp(self.now+payload.get('expiresInSeconds',86400),timezone.utc).isoformat()})
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

    async def test_issued_codes_update_stock_through_their_lifecycle(self):
        async def stock():
            return {p['id']: p for p in await payments.plans_with_capacity(self.request, self.user)}
        self.assertEqual((await stock())['ultra']['remaining'], 2)
        cards = await subscription.generate_gift_cards(self.user, 'ultra', 1, 30, None)
        code = cards[0].code
        self.assertEqual((await stock())['ultra']['remaining'], 1)
        self.assertEqual((await stock())['pro']['remaining'], 2)
        await GiftCards.set_enabled(code, False)
        self.assertEqual((await stock())['ultra']['remaining'], 2)
        await GiftCards.set_enabled(code, True)
        self.assertEqual((await stock())['ultra']['remaining'], 1)
        # Once redeemed, gateway occupancy replaces the code's commitment.
        await allocation.change_subscription(self.request, self.user.id, 'ultra',
            operation_id='gift:' + code, gift_code=code)
        with patch.object(allocation, 'resource_call', AsyncMock(return_value={
                'ultra': {'remaining': 1, 'can_purchase': True}})):
            self.assertEqual((await stock())['ultra']['remaining'], 1)
            more = await subscription.generate_gift_cards(self.user, 'ultra', 1, 7, None)
            self.assertEqual((await stock())['ultra']['remaining'], 0)
            await GiftCards.delete(more[0].code)
            self.assertEqual((await stock())['ultra']['remaining'], 1)

    async def test_codes_exhaust_stock_and_block_new_checkout_but_allow_renewal(self):
        await subscription.generate_gift_cards(self.user, 'pro', 3, 30, None)
        rows = {p['id']: p for p in await payments.plans_with_capacity(self.request, self.user)}
        self.assertEqual(rows['pro']['remaining'], 0)
        self.assertFalse(rows['pro']['can_purchase'])
        self.assertTrue(rows['ultra']['can_purchase'])
        with self.assertRaises(HTTPException) as caught:
            await payments.create_checkout(self.request, self.user, 'pro', '56')
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.orders, {})
        async with get_async_db() as db:
            db.add(UserSubscription(id='renewable', user_id=self.user.id, tier_id='pro', status='active',
                started_at=self.now, expires_at=self.now+86400, created_at=self.now, updated_at=self.now))
            await db.commit()
        rows = {p['id']: p for p in await payments.plans_with_capacity(self.request, self.user)}
        self.assertEqual(rows['pro']['remaining'], 0)
        self.assertTrue(rows['pro']['can_purchase'])
        self.assertEqual((await payments.create_checkout(self.request, self.user, 'pro', '56'))['status'], 'PENDING')
        # A local subscription must not override a gateway refusal.
        self.full = True
        self.assertFalse(next(p for p in await payments.plans_with_capacity(self.request, self.user)
            if p['id'] == 'pro')['can_purchase'])

    async def test_stock_counts_all_codes_without_admin_list_limit(self):
        await GiftCards.insert_many([dict(code=f'BULK-{i}', tier_id='pro', duration_days=7 if i%2 else 30)
            for i in range(501)])
        await GiftCards.insert_many([dict(code='ULTRA-AVAILABLE', tier_id='ultra', duration_days=30),
            dict(code='PRO-DISABLED', tier_id='pro', duration_days=30),
            dict(code='PRO-REDEEMED', tier_id='pro', duration_days=30)])
        await GiftCards.set_enabled('PRO-DISABLED', False)
        await GiftCards.claim('PRO-REDEEMED', self.user.id)
        self.assertEqual(await GiftCards.available_counts_by_tier(), {'pro': 501, 'ultra': 1})

    async def test_stock_query_failure_does_not_expose_unadjusted_capacity(self):
        with patch.object(GiftCards, 'available_counts_by_tier', AsyncMock(side_effect=RuntimeError('db unavailable'))):
            rows = await payments.plans_with_capacity(self.request, self.user)
        pro = next(p for p in rows if p['id'] == 'pro')
        self.assertIsNone(pro['remaining'])
        self.assertFalse(pro['can_purchase'])

    async def test_unpaid_quote_is_immutable_and_switching_network_cannot_release_hold(self):
        old=await payments.create_checkout(self.request,self.user,'pro','56')
        async with get_async_db() as db:
            tier=await db.get(SubscriptionTier,'pro');tier.price_usd=130;await db.commit()
        for chain in ('56','1'):
            with self.assertRaises(HTTPException):
                await payments.create_checkout(self.request,self.user,'pro',chain)
        self.assertEqual((await payments.sync_checkout(self.request,self.user,old['order_id']))['amount'],'120.0')
        async with get_async_db() as db:
            self.assertIsNotNone(await db.get(CommerceHold,old['order_id']))
        self.assertEqual(len(self.orders),1)

    async def test_expired_clock_alone_cannot_release_stock(self):
        old=await payments.create_checkout(self.request,self.user,'pro','56')
        async with get_async_db() as db:
            row=await db.get(SubscriptionOrder,old['order_id']);row.expires_at=self.now-1;await db.commit()
        with self.assertRaises(HTTPException):
            await payments.create_checkout(self.request,self.user,'pro','56')
        self.orders[old['order_id']].update(status='EXPIRED',finalStatus=True)
        await payments.sync_checkout(self.request,self.user,old['order_id'])
        fresh=await payments.create_checkout(self.request,self.user,'pro','56')
        self.assertNotEqual(old['order_id'],fresh['order_id'])

    async def test_payment_in_progress_is_preserved_across_network_changes(self):
        old=await payments.create_checkout(self.request,self.user,'pro','56')
        self.orders[old['order_id']].update(status='PAID',paidAmount='120',finalStatus=True,txHash='paid-no-stock')
        self.full=True
        await payments.sync_checkout(self.request,self.user,old['order_id'])
        pending=await payments.latest_checkout(self.request,self.user,'pro')
        self.assertEqual(pending['order_id'],old['order_id'])
        self.assertEqual(pending['status'],'PAID_REQUIRES_ADMIN')
        retry=await payments.create_checkout(self.request,self.user,'pro','728126428')
        self.assertEqual(retry['order_id'],old['order_id'])
        self.assertEqual(len(self.orders),1)
        self.assertFalse(retry['activated'])

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

    async def test_one_pending_order_and_late_payment_does_not_take_new_hold(self):
        pro = await payments.create_checkout(self.request,self.user,'pro','56')
        with self.assertRaises(HTTPException):
            await payments.create_checkout(self.request,self.user,'ultra','56')
        self.orders[pro['order_id']].update(status='EXPIRED',finalStatus=True)
        await payments.sync_checkout(self.request,self.user,pro['order_id'])
        ultra = await payments.create_checkout(self.request,self.user,'ultra','56')
        self.orders[pro['order_id']].update(status='PAID',paidAmount='120',finalStatus=True,txHash='late-pro')
        late=await payments.sync_checkout(self.request,self.user,pro['order_id'])
        self.assertEqual(late['status'],'PAID_REQUIRES_ADMIN')
        self.assertFalse(late['activated'])
        async with get_async_db() as db:
            self.assertIsNotNone(await db.get(CommerceHold,ultra['order_id']))
        self.orders[ultra['order_id']].update(status='PAID',paidAmount='360',finalStatus=True,txHash='valid-ultra')
        self.assertTrue((await payments.sync_checkout(self.request,self.user,ultra['order_id']))['activated'])
        async with get_async_db() as db:
            active=(await db.execute(select(UserSubscription).where(UserSubscription.status=='active'))).scalars().all()
            self.assertEqual([s.tier_id for s in active],['ultra'])

    async def test_remote_sync_failure_does_not_report_activation(self):
        created=await payments.create_checkout(self.request,self.user,'pro','56')
        self.orders[created['order_id']].update(status='PAID',paidAmount='120',finalStatus=True,txHash='sync-paid')
        with patch.object(subscription,'sync_user_rate_limits_to_kyber',AsyncMock(return_value=False)):
            self.assertFalse((await payments.sync_checkout(self.request,self.user,created['order_id']))['activated'])
            pending = await payments.latest_checkout(self.request,self.user,'pro')
            self.assertEqual(pending['order_id'],created['order_id'])
            self.assertFalse(pending['activated'])
        self.assertTrue((await payments.latest_checkout(self.request,self.user,'pro'))['activated'])
        self.assertIsNone(await payments.latest_checkout(self.request,self.user,'pro'))

    async def test_buyer_can_cancel_unpaid_order_and_buy_again_immediately(self):
        old=await payments.create_checkout(self.request,self.user,'pro','56')
        with self.assertRaises(HTTPException):
            await payments.create_checkout(self.request,self.user,'ultra','1')
        state=await payments.cancel_checkout(self.request,self.user,old['order_id'])
        self.assertEqual(state['status'],'CANCELLED');self.assertFalse(state['activated'])
        async with get_async_db() as db:
            self.assertIsNone(await db.get(CommerceHold,old['order_id']))
            row=await db.get(CommerceTransaction,old['order_id'])
            self.assertEqual(row.status,'CANCELLED');self.assertIn('取消未付款订单',row.note)
        self.assertIsNone(await payments.latest_checkout(self.request,self.user))
        fresh=await payments.create_checkout(self.request,self.user,'ultra','1')
        self.assertNotEqual(fresh['order_id'],old['order_id']);self.assertEqual(fresh['status'],'PENDING')
        # Cancelling again is harmless, and the platform's PENDING/EXPIRED never reopens the invoice.
        self.assertEqual((await payments.cancel_checkout(self.request,self.user,old['order_id']))['status'],'CANCELLED')
        self.orders[old['order_id']].update(status='EXPIRED',finalStatus=True)
        self.assertEqual((await payments.sync_checkout(self.request,self.user,old['order_id']))['status'],'CANCELLED')
        async with get_async_db() as db:
            self.assertIsNotNone(await db.get(CommerceHold,fresh['order_id']))
            self.assertEqual(len((await db.execute(select(CommerceHold))).scalars().all()),1)
        self.assertEqual(len(self.reservations),0)

    async def test_cancel_never_discards_money_that_already_arrived(self):
        created=await payments.create_checkout(self.request,self.user,'pro','56')
        self.orders[created['order_id']].update(status='PAID',paidAmount='120',finalStatus=True,txHash='paid-before-cancel')
        with self.assertRaises(HTTPException) as caught:
            await payments.cancel_checkout(self.request,self.user,created['order_id'])
        self.assertEqual(caught.exception.status_code,409)
        async with get_async_db() as db:
            order=await db.get(SubscriptionOrder,created['order_id'])
            self.assertEqual(order.status,'PAID');self.assertTrue(order.activated)
            active=(await db.execute(select(UserSubscription).where(UserSubscription.status=='active'))).scalars().all()
            self.assertEqual([s.tier_id for s in active],['pro'])
        # An underpaid or mismatched PAID report also blocks cancellation instead of releasing stock.
        async with get_async_db() as db:
            db.add(User(id='second-buyer',email='second@test.invalid',name='Second',role='user'))
            db.add(UserKyberAccount(user_id='second-buyer',kyber_user_id='gateway-second',kyber_email='second@test.invalid',created_at=self.now,updated_at=self.now))
            await db.commit()
        second=SimpleNamespace(id='second-buyer',role='user')
        short=await payments.create_checkout(self.request,second,'ultra','56')
        self.orders[short['order_id']].update(status='PAID',paidAmount='359.99',finalStatus=True,txHash='short')
        with self.assertRaises(HTTPException):
            await payments.cancel_checkout(self.request,second,short['order_id'])
        async with get_async_db() as db:
            self.assertIsNotNone(await db.get(CommerceHold,short['order_id']))
            self.assertEqual((await db.get(SubscriptionOrder,short['order_id'])).status,'PENDING')

    async def test_payment_after_cancel_is_kept_for_administrator_and_takes_no_new_stock(self):
        from open_webui.utils import commerce_jobs
        async with get_async_db() as db:
            # The reconcile loop loads the full user model, which needs real timestamps.
            buyer=await db.get(User,self.user.id)
            buyer.created_at=buyer.updated_at=buyer.last_active_at=self.now;await db.commit()
        old=await payments.create_checkout(self.request,self.user,'pro','56')
        await payments.cancel_checkout(self.request,self.user,old['order_id'])
        fresh=await payments.create_checkout(self.request,self.user,'ultra','56')
        calls=[]
        original=payments.merchant_request
        async def counting(req,method,suffix,payload=None):
            calls.append(suffix);return await original(req,method,suffix,payload)
        with patch.object(payments,'merchant_request',counting):
            # A cancelled invoice without reported money is not polled by the reconcile loop.
            await commerce_jobs.reconcile_once(self.request)
            self.assertNotIn('status/'+old['order_id'],calls)
            # The signed payment report flags late money; the next pass settles it for an administrator.
            self.orders[old['order_id']].update(status='PAID',paidAmount='120',finalStatus=True,txHash='late-after-cancel')
            async with get_async_db() as db:
                row=await db.get(CommerceTransaction,old['order_id']);row.paid_at=self.now;await db.commit()
            await commerce_jobs.reconcile_once(self.request)
            self.assertIn('status/'+old['order_id'],calls)
        async with get_async_db() as db:
            order=await db.get(SubscriptionOrder,old['order_id'])
            self.assertEqual(order.status,'PAID_REQUIRES_ADMIN');self.assertFalse(order.activated)
            self.assertEqual(order.tx_hash,'late-after-cancel')
            self.assertEqual((await db.execute(select(UserSubscription))).scalars().all(),[])
            self.assertIsNotNone(await db.get(CommerceHold,fresh['order_id']))
            self.assertIsNone(await db.get(CommerceHold,old['order_id']))
        # The buyer sees the paid order again instead of a silent loss.
        pending=await payments.latest_checkout(self.request,self.user)
        self.assertEqual((pending['order_id'],pending['status']),(old['order_id'],'PAID_REQUIRES_ADMIN'))

    async def test_cancel_is_limited_to_the_buyers_own_unpaid_invoices(self):
        created=await payments.create_checkout(self.request,self.user,'pro','56')
        with self.assertRaises(HTTPException) as caught:
            await payments.cancel_checkout(self.request,SimpleNamespace(id='another-user',role='user'),created['order_id'])
        self.assertEqual(caught.exception.status_code,404)
        async with get_async_db() as db:
            self.assertIsNotNone(await db.get(CommerceHold,created['order_id']))
        # A window that has ended but is still being verified can be released early by its buyer.
        self.orders[created['order_id']].update(status='EXPIRED',finalStatus=False)
        self.assertEqual((await payments.sync_checkout(self.request,self.user,created['order_id']))['status'],'EXPIRED_CHECKING')
        self.assertEqual((await payments.cancel_checkout(self.request,self.user,created['order_id']))['status'],'CANCELLED')
        async with get_async_db() as db:
            self.assertIsNone(await db.get(CommerceHold,created['order_id']))
        # Finished invoices are not cancellable.
        done=await payments.create_checkout(self.request,self.user,'pro','56')
        self.orders[done['order_id']].update(status='EXPIRED',finalStatus=True)
        await payments.sync_checkout(self.request,self.user,done['order_id'])
        with self.assertRaises(HTTPException) as caught:
            await payments.cancel_checkout(self.request,self.user,done['order_id'])
        self.assertEqual(caught.exception.status_code,409)
        async with get_async_db() as db:
            self.assertEqual((await db.get(SubscriptionOrder,done['order_id'])).status,'EXPIRED')

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
