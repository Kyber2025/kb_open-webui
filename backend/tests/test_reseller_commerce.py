"""Real PostgreSQL locks and HTTP auth; mocked payment transport, never live money."""
import asyncio
import hashlib
import json
import time
import unittest
import sys
import types
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock
import httpx
from fastapi import FastAPI, HTTPException
from sqlalchemy import select, func
from test_subscription_payments import PaymentTests
from open_webui.internal.db import get_async_db, engine
from open_webui.internal.config import ConfigTable
ConfigTable.__table__.create(engine, checkfirst=True)
# Authentication remains real; only unrelated vector-store configuration is omitted.
test_config = types.ModuleType('open_webui.config')
test_config.DEFAULT_USER_PERMISSIONS = {}
sys.modules.setdefault('open_webui.config', test_config)
from open_webui.models.users import User
from open_webui.models.commerce import ResellerAccount, ResellerPrice, CommerceTransaction, CommerceHold
from open_webui.models.reseller_invites import ResellerInvite, ResellerCustomer
from open_webui.models.subscriptions import GiftCard, GiftCards
from open_webui.utils import reseller_commerce as commerce, subscription_payments as payments, subscription, commerce_reports as reports
from open_webui.utils.commerce_inventory import change_card
from open_webui.utils.auth import create_token
from open_webui.routers.commerce import router


class CommerceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await PaymentTests.asyncSetUp(self)
        self.admin = SimpleNamespace(id='admin-user', role='admin')
        async with get_async_db() as db:
            for uid,role in [('admin-user','admin'),('agent-two','user'),('ordinary','user')]:
                db.add(User(id=uid,email=uid+'@test.invalid',name=uid,role=role,
                    created_at=self.now,updated_at=self.now,last_active_at=self.now))
            buyer = await db.get(User,self.user.id)
            buyer.created_at=buyer.updated_at=buyer.last_active_at=self.now
            await db.commit()
        for uid in (self.user.id,'agent-two'):
            await commerce.assign_reseller(self.admin,uid)
        for tier in ('pro','ultra'):
            await commerce.set_price(self.admin,'default',tier,Decimal('10'))
        self.patches.append(patch.object(commerce,'merchant_request',payments.merchant_request))
        self.patches[-1].start()
        self.app=FastAPI()
        self.app.state.config=self.request.app.state.config
        self.app.state.redis=None
        self.app.include_router(router,prefix='/api/v1/commerce')
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='https://chat.kividas.com')

    async def asyncTearDown(self):
        await self.client.aclose()
        await PaymentTests.asyncTearDown(self)

    def headers(self,uid):
        return {'Authorization':'Bearer '+create_token({'id':uid})}

    async def buy(self,uid=None,quantity=1,key='idempotent-request-one',tier='pro'):
        return await commerce.create_purchase(self.request,SimpleNamespace(id=uid or self.user.id),tier,quantity,'56',key)

    def paid(self,order):
        self.orders[order['id']].update(status='PAID',paidAmount=order['amount'],finalStatus=True,txHash='verified-chain-hash')

    async def test_server_price_override_snapshot_and_idempotent_fulfillment(self):
        await commerce.set_price(self.admin,self.user.id,'pro',Decimal('7.5'))
        created=await asyncio.gather(*(self.buy(quantity=2) for _ in range(5)))
        self.assertEqual(len({r['id'] for r in created}),1)
        order=created[0]
        self.assertEqual(Decimal(order['amount']),Decimal('15'))
        await commerce.set_price(self.admin,self.user.id,'pro',Decimal('99'))
        self.paid(order)
        results=await asyncio.gather(*(commerce.sync_purchase(self.request,self.user.id,order['id']) for _ in range(6)))
        self.assertTrue(all(r['fulfilled'] for r in results))
        self.assertTrue(all(Decimal(r['amount'])==15 for r in results))
        async with get_async_db() as db:
            self.assertEqual((await db.execute(select(func.count()).select_from(GiftCard))).scalar(),2)
            self.assertEqual((await db.execute(select(func.count()).select_from(CommerceHold))).scalar(),0)
            self.assertEqual((await db.execute(select(func.count()).select_from(CommerceTransaction))).scalar(),1)

    async def test_concurrent_last_stock_never_issues_two_batches(self):
        results=await asyncio.gather(self.buy(quantity=2),self.buy('agent-two',quantity=2),return_exceptions=True)
        winners=[r for r in results if isinstance(r,dict)]
        losers=[r for r in results if isinstance(r,HTTPException)]
        self.assertEqual((len(winners),len(losers)),(1,1))
        self.assertEqual(losers[0].status_code,409)
        order=winners[0];self.paid(order)
        result=await commerce.sync_purchase(self.request,order['user_id'],order['id'])
        self.assertEqual(len(result['cards']),2)
        with self.assertRaises(HTTPException):
            await subscription.generate_gift_cards(self.admin,'pro',1,request=self.request)

    async def test_manual_issue_competes_with_checkout_and_history_survives_delete(self):
        results=await asyncio.gather(self.buy(quantity=2),subscription.generate_gift_cards(self.admin,'pro',2,request=self.request),return_exceptions=True)
        self.assertEqual(sum(not isinstance(r,Exception) for r in results),1)
        manual=await subscription.generate_gift_cards(self.admin,'ultra',1,request=self.request)
        await change_card(self.request,manual[0].code,remove=True)
        rows=await reports.list_transactions({'source':'manual'})
        row=next(r for r in rows['items'] if r['batch_id']==manual[0].batch_id)
        self.assertEqual(row['actor_id'],self.admin.id)
        self.assertIsNone(row['amount'])
        self.assertEqual(row['quantity'],1)

    async def test_reenable_rechecks_stock_and_is_serialized(self):
        card=(await subscription.generate_gift_cards(self.admin,'pro',1,request=self.request))[0]
        await change_card(self.request,card.code,enabled=False)
        await self.buy(quantity=2)
        with self.assertRaises(HTTPException) as caught:
            await change_card(self.request,card.code,enabled=True)
        self.assertEqual(caught.exception.status_code,409)
        self.assertFalse((await GiftCards.get(card.code)).enabled)

    async def test_api_rejects_price_user_and_quantity_tampering(self):
        valid={'tier_id':'pro','quantity':1,'chain_id':'56','request_id':'secure-test-request-123'}
        for extra in ({'amount':'0.01'},{'user_id':'agent-two'},{'role':'admin'},{'price':'0.01'},{'quantity':-1},{'quantity':True},{'quantity':1.5},{'quantity':101}):
            response=await self.client.post('/api/v1/commerce/reseller/purchases',json={**valid,**extra},headers=self.headers(self.user.id))
            self.assertEqual(response.status_code,422,response.text)
        for uid in ('ordinary','agent-two'):
            response=await self.client.post('/api/v1/commerce/admin/prices',json={'scope':'default','tier_id':'pro','price':'1'},headers=self.headers(uid))
            self.assertEqual(response.status_code,401,response.text)
        response=await self.client.post('/api/v1/commerce/reseller/purchases',json=valid,headers=self.headers('ordinary'))
        self.assertEqual(response.status_code,403,response.text)
        self.assertFalse(self.orders)

    async def test_real_bearer_auth_cross_site_and_order_ownership(self):
        for path in ('/admin/resellers','/admin/transactions','/admin/transactions/export'):
            self.assertEqual((await self.client.get('/api/v1/commerce'+path)).status_code,401)
        response=await self.client.post('/api/v1/commerce/admin/prices',json={'tier_id':'pro','price':'1'},
            headers={**self.headers(self.admin.id),'Origin':'https://attacker.invalid'})
        self.assertEqual(response.status_code,403)
        order=await self.buy()
        response=await self.client.get('/api/v1/commerce/reseller/purchases/'+order['id'],headers=self.headers('agent-two'))
        self.assertEqual(response.status_code,404)
        response=await self.client.get('/api/v1/commerce/reseller/purchases?user_id='+self.user.id,headers=self.headers('agent-two'))
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['total'],0)
        await commerce.set_reseller_enabled(self.user.id,False)
        with self.assertRaises(HTTPException):await self.buy(key='new-disabled-request')

    async def test_payment_identity_underpayment_and_forged_callback_never_issue(self):
        order=await self.buy()
        remote=self.orders[order['id']]
        remote.update(status='PAID',paidAmount='0.01',finalStatus=True,txHash='tampered')
        with self.assertRaises(HTTPException):await commerce.sync_purchase(self.request,self.user.id,order['id'])
        remote.update(paidAmount=order['amount'],merchantOrderId='another-order')
        with self.assertRaises(HTTPException):await commerce.sync_purchase(self.request,self.user.id,order['id'])
        response=await self.client.post('/api/v1/commerce/payment/notify',json={'event':'PAID','data':{'orderId':order['id']}},headers={'X-App-Id':'test','X-Signature':'invalid'})
        self.assertEqual(response.status_code,401)
        self.assertEqual(await GiftCards.available_counts_by_tier(),{})

    async def test_signed_callback_replay_issues_once_and_rejects_changed_body(self):
        order=await self.buy();self.paid(order)
        body=json.dumps({'event':'PAID','data':{'orderId':order['id']}}).encode()
        timestamp=str(int(time.time()));nonce='callback-nonce-for-test'
        headers={'X-App-Id':'test','X-Timestamp':timestamp,'X-Nonce':nonce,
            'X-Signature':payments.signature('test-only','NOTIFY',timestamp,nonce,hashlib.sha256(body).hexdigest())}
        for _ in range(3):
            response=await self.client.post('/api/v1/commerce/payment/notify',content=body,headers=headers)
            self.assertEqual(response.status_code,200,response.text)
        response=await self.client.post('/api/v1/commerce/payment/notify',content=body+b' ',headers=headers)
        self.assertEqual(response.status_code,401)
        self.assertEqual(await GiftCards.available_counts_by_tier(),{'pro':1})

    async def test_rollback_cannot_leave_partial_codes_or_fulfilled_order(self):
        order=await self.buy(quantity=2);self.paid(order)
        original=GiftCards.insert_many
        async def broken(*args,**kwargs):
            await original(*args,**kwargs)
            raise RuntimeError('crash before commit')
        with patch.object(GiftCards,'insert_many',broken):
            with self.assertRaises(RuntimeError):await commerce.sync_purchase(self.request,self.user.id,order['id'])
        self.assertEqual(await GiftCards.available_counts_by_tier(),{})
        async with get_async_db() as db:self.assertFalse((await db.get(CommerceTransaction,order['id'])).fulfilled)
        result=await commerce.sync_purchase(self.request,self.user.id,order['id'])
        self.assertEqual(len(result['cards']),2)

    async def test_filters_and_exports_preserve_manual_entries_and_escape_formulas(self):
        await subscription.generate_gift_cards(self.admin,'ultra',1,note='=HYPERLINK("bad")',request=self.request)
        self.assertEqual((await reports.list_transactions({'source':'reseller'}))['total'],0)
        self.assertEqual((await reports.list_transactions({'source':'manual','tier_id':'ultra'}))['total'],1)
        content=''.join([part async for part in reports.export_transactions({'source':'manual'})])
        self.assertIn("'=HYPERLINK",content)
        self.assertNotIn('test-only',content)

    async def test_stalled_creation_only_releases_after_signed_absence(self):
        with patch.object(commerce,'merchant_request',AsyncMock(side_effect=TimeoutError())):
            with self.assertRaises(TimeoutError):await self.buy()
        async with get_async_db() as db:
            row=(await db.execute(select(CommerceTransaction))).scalar_one()
            row.expires_at=self.now-1;order_id=row.id;await db.commit()
        with patch.object(commerce,'merchant_request',AsyncMock(side_effect=TimeoutError())):
            with self.assertRaises(TimeoutError):await commerce.sync_purchase(self.request,self.user.id,order_id)
        async with get_async_db() as db:self.assertIsNotNone(await db.get(CommerceHold,order_id))
        absent=AsyncMock(side_effect=payments.VerifiedMerchantError(404,'signed not found'))
        with patch.object(commerce,'merchant_request',absent):
            result=await commerce.sync_purchase(self.request,self.user.id,order_id)
        self.assertEqual(result['status'],'FAILED')
        self.assertEqual(absent.call_args.args[1],'GET')
        async with get_async_db() as db:self.assertIsNone(await db.get(CommerceHold,order_id))

    async def test_frozen_migration_backfills_historical_manual_codes(self):
        import importlib.util
        from pathlib import Path
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        from open_webui.internal.db import Base
        await GiftCards.insert_many([dict(code='HISTORICAL',tier_id='pro',duration_days=30,batch_id='old-batch',created_by=self.admin.id)])
        tables=('reseller_account','reseller_price','commerce_transaction','commerce_hold','commerce_sync','commerce_notice')
        for name in reversed(tables):Base.metadata.tables[name].drop(engine)
        path=Path(__file__).parents[1]/'open_webui/migrations/versions/f6a7b8c9d0e1_add_reseller_commerce.py'
        spec=importlib.util.spec_from_file_location('commerce_migration',path)
        migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):migration.upgrade()
        async with get_async_db() as db:
            row=await db.get(CommerceTransaction,'manual:old-batch')
            self.assertEqual((row.source,row.quantity,row.batch_id),('manual',1,'old-batch'))
            self.assertIsNone(row.amount)
            self.assertFalse(row.stock_backed)
            self.assertTrue(row.fulfilled)

    async def test_reseller_can_cancel_unpaid_purchase_and_buy_again_immediately(self):
        order=await self.buy(quantity=2)
        with self.assertRaises(HTTPException):
            await self.buy(key='second-request-while-held',tier='ultra')
        cancel='/api/v1/commerce/reseller/purchases/'+order['id']+'/cancel'
        response=await self.client.post(cancel,headers=self.headers(self.user.id))
        self.assertEqual(response.status_code,200,response.text)
        body=response.json();self.assertTrue(body['cancelled']);self.assertEqual(body['order']['status'],'CANCELLED')
        self.assertEqual(body['order']['cards'],[])
        async with get_async_db() as db:
            self.assertIsNone(await db.get(CommerceHold,order['id']))
            row=await db.get(CommerceTransaction,order['id'])
            self.assertIn('取消未付款订单',row.note);self.assertFalse(row.fulfilled)
            self.assertEqual((await db.execute(select(func.count()).select_from(GiftCard))).scalar(),0)
        fresh=await self.buy(key='request-after-cancel',tier='ultra')
        self.assertNotEqual(fresh['id'],order['id']);self.assertEqual(fresh['status'],'PENDING')
        # Cancelling again is harmless, and the platform's PENDING/EXPIRED never reopens the purchase.
        again=await self.client.post(cancel,headers=self.headers(self.user.id))
        self.assertEqual((again.status_code,again.json()['cancelled']),(200,True))
        self.orders[order['id']].update(status='EXPIRED',finalStatus=True)
        self.assertEqual((await commerce.sync_purchase(self.request,self.user.id,order['id']))['status'],'CANCELLED')
        async with get_async_db() as db:
            self.assertIsNotNone(await db.get(CommerceHold,fresh['id']))
            self.assertEqual((await db.execute(select(func.count()).select_from(CommerceHold))).scalar(),1)

    async def test_cancel_refuses_a_paid_purchase_and_delivers_it_instead(self):
        order=await self.buy(quantity=2);self.paid(order)
        response=await self.client.post('/api/v1/commerce/reseller/purchases/'+order['id']+'/cancel',headers=self.headers(self.user.id))
        self.assertEqual(response.status_code,409,response.text)
        result=await commerce.sync_purchase(self.request,self.user.id,order['id'])
        self.assertTrue(result['fulfilled']);self.assertEqual(result['status'],'PAID');self.assertEqual(len(result['cards']),2)
        # A delivered purchase can no longer be cancelled.
        with self.assertRaises(HTTPException) as caught:
            await commerce.cancel_purchase(self.request,self.user,order['id'])
        self.assertEqual(caught.exception.status_code,409)
        async with get_async_db() as db:
            self.assertEqual((await db.execute(select(func.count()).select_from(GiftCard))).scalar(),2)

    async def test_payment_after_reseller_cancel_waits_for_administrator_without_codes(self):
        from open_webui.utils import commerce_jobs
        order=await self.buy()
        await commerce.cancel_purchase(self.request,self.user,order['id'])
        calls=[];original=commerce.merchant_request
        async def counting(req,method,suffix,payload=None):
            calls.append(suffix);return await original(req,method,suffix,payload)
        with patch.object(commerce,'merchant_request',counting):
            # A cancelled purchase without reported money is not polled by the reconcile loop.
            await commerce_jobs.reconcile_once(self.request)
            self.assertNotIn('status/'+order['id'],calls)
            # The signed payment report flags late money; the next pass keeps it for an administrator.
            self.paid(order)
            async with get_async_db() as db:
                row=await db.get(CommerceTransaction,order['id']);row.paid_at=self.now;await db.commit()
            await commerce_jobs.reconcile_once(self.request)
            self.assertIn('status/'+order['id'],calls)
        async with get_async_db() as db:
            row=await db.get(CommerceTransaction,order['id'])
            self.assertEqual((row.status,row.fulfilled,row.tx_hash),('PAID_REQUIRES_ADMIN',False,'verified-chain-hash'))
            self.assertIsNone(await db.get(CommerceHold,order['id']))
            self.assertEqual((await db.execute(select(func.count()).select_from(GiftCard))).scalar(),0)

    async def test_cancel_is_limited_to_the_resellers_own_unpaid_purchases(self):
        order=await self.buy()
        cancel='/api/v1/commerce/reseller/purchases/'+order['id']+'/cancel'
        self.assertEqual((await self.client.post(cancel)).status_code,401)
        self.assertEqual((await self.client.post(cancel,headers=self.headers('agent-two'))).status_code,404)
        self.assertEqual((await self.client.post(cancel,headers={**self.headers(self.user.id),'Origin':'https://attacker.invalid'})).status_code,403)
        async with get_async_db() as db:
            self.assertIsNotNone(await db.get(CommerceHold,order['id']))
            self.assertEqual((await db.get(CommerceTransaction,order['id'])).status,'PENDING')
        # A window that ended but is still being verified can be released early; a finished one cannot.
        self.orders[order['id']].update(status='EXPIRED',finalStatus=False)
        self.assertEqual((await commerce.sync_purchase(self.request,self.user.id,order['id']))['status'],'EXPIRED_CHECKING')
        self.assertTrue((await self.client.post(cancel,headers=self.headers(self.user.id))).json()['cancelled'])
        done=await self.buy(key='request-that-expires')
        self.orders[done['id']].update(status='EXPIRED',finalStatus=True)
        await commerce.sync_purchase(self.request,self.user.id,done['id'])
        response=await self.client.post('/api/v1/commerce/reseller/purchases/'+done['id']+'/cancel',headers=self.headers(self.user.id))
        self.assertEqual(response.status_code,409)

    async def test_reseller_profile_exposes_only_its_own_invitation_short_link(self):
        async with get_async_db() as db:
            account=await db.get(ResellerAccount,self.user.id)
            invite=await db.get(ResellerInvite,account.invite_id)
            invite_id,code,token=invite.id,invite.short_code,invite.token
            db.add(ResellerCustomer(user_id='ordinary',invite_id=invite_id,created_at=self.now));await db.commit()
        response=await self.client.get('/api/v1/commerce/reseller/me',headers=self.headers(self.user.id))
        self.assertEqual(response.status_code,200,response.text)
        profile=response.json()
        self.assertEqual((profile['short_code'],profile['invite_enabled'],profile['customers']),(code,True,1))
        self.assertNotIn(token,response.text)
        other=(await self.client.get('/api/v1/commerce/reseller/me',headers=self.headers('agent-two'))).json()
        self.assertTrue(other['short_code']);self.assertNotEqual(other['short_code'],code);self.assertEqual(other['customers'],0)
        self.assertEqual((await self.client.get('/api/v1/commerce/reseller/me',headers=self.headers('ordinary'))).json(),{'is_reseller':False})
        # A legacy invitation without a short link gets one on first use; a disabled link is reported as such.
        async with get_async_db() as db:
            invite=await db.get(ResellerInvite,invite_id);invite.short_code=None;invite.enabled=False;await db.commit()
        legacy=await commerce.reseller_profile(self.request,self.user)
        self.assertTrue(legacy['short_code']);self.assertFalse(legacy['invite_enabled'])
        self.assertEqual((await commerce.reseller_profile(self.request,self.user))['short_code'],legacy['short_code'])
        async with get_async_db() as db:
            self.assertEqual((await db.get(ResellerInvite,invite_id)).short_code,legacy['short_code'])


if __name__=='__main__':unittest.main()
