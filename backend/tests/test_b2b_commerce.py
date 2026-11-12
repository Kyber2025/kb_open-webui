"""Disposable PostgreSQL, real HTTP/HMAC/locks, simulated merchant and capacity."""
import asyncio
import hashlib
import hmac
import json
import os
import time
import unittest
from decimal import Decimal
from types import SimpleNamespace as NS
from unittest.mock import patch

from test_reseller_commerce import CommerceTests
from fastapi import HTTPException
from sqlalchemy import select, func
from open_webui.internal.db import get_async_db, engine, Base
from open_webui.models.commerce import B2BCard, B2BCheckout, B2BTransfer, CommerceTransaction
from open_webui.models.subscriptions import GiftCard, GiftCards
from open_webui.utils import b2b_commerce as b2b, subscription_payments as payments
from open_webui.routers.b2b_commerce import Purchase, Manual, Transfer, Inventory, TransferReport


class B2BTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await CommerceTests.asyncSetUp(self)
        from open_webui.utils import commerce_recovery
        self.patches.append(patch.object(commerce_recovery,'merchant_request',payments.merchant_request))
        self.patches[-1].start()
    asyncTearDown = CommerceTests.asyncTearDown
    paid = CommerceTests.paid
    buy = CommerceTests.buy

    def purchase(self, **kw):
        return Purchase(**dict(company_id='company-a', buyer_id='sales-a', order_id='local-order-one',
            tier_id='pro', quantity=1, chain_id='56', unit_price='45.000000', **{} ) | kw)

    def manual(self, **kw):
        return Manual(**(dict(company_id='company-a', buyer_id='company-root', order_id='manual-local-one',
            tier_id='pro', quantity=1, note='客户赠送') | kw))

    def transfer(self, code, **kw):
        return Transfer(**(dict(company_id='company-a', from_id='company-root', to_id='sales-a',
            actor_id='owner', request_id='transfer-request-one', codes=[code], note='销售领取') | kw))

    async def http(self, path, data=None, *, signed=True, mutate=False):
        raw=b'' if data is None else json.dumps(data).encode()
        path='/api/v1/commerce/b2b'+path
        stamp=str(int(time.time()));nonce='test-nonce-with-enough-bytes'
        key='isolated-b2b-test-key-32-characters'
        sig=hmac.new(key.encode(),'\n'.join(['GET' if data is None else 'POST',path,stamp,nonce,
            hashlib.sha256(raw).hexdigest()]).encode(),hashlib.sha256).hexdigest()
        headers={'X-B2B-Timestamp':stamp,'X-B2B-Nonce':nonce,'X-B2B-Signature':sig,
            'Content-Type':'application/json'} if signed else {}
        with patch.dict(os.environ,{'B2B_COMMERCE_SECRET':key}):
            return await self.client.request('GET' if data is None else 'POST',path,
                content=raw+(b' ' if mutate else b''),headers=headers)

    async def test_service_signature_and_strict_payload(self):
        for signed,mutate in [(False,False),(True,True)]:
            r=await self.http('/orders',self.purchase().model_dump(),signed=signed,mutate=mutate)
            self.assertEqual(r.status_code,401,r.text)
        for extra in ({'quantity':True},{'quantity':1.5},{'quantity':0},{'unit_price':'0'},
                {'unit_price':'NaN'},{'unit_price':'1e3'},{'price':'1'}):
            r=await self.http('/orders',self.purchase().model_dump()|extra)
            self.assertEqual(r.status_code,422,r.text)
        self.assertFalse(self.orders)

    async def test_payment_replay_delivers_exactly_once_with_ownership(self):
        rows=await asyncio.gather(*(b2b.create_purchase(self.request,self.purchase(quantity=2)) for _ in range(5)))
        self.assertEqual(len({o['id'] for o in rows}),1)
        o=rows[0];self.paid(o)
        body=json.dumps({'event':'PAID','data':{'orderId':o['id']}}).encode()
        timestamp=str(int(time.time()));nonce='b2b-payment-callback-test'
        headers={'X-App-Id':'test','X-Timestamp':timestamp,'X-Nonce':nonce,
            'X-Signature':payments.signature('test-only','NOTIFY',timestamp,nonce,hashlib.sha256(body).hexdigest())}
        for _ in range(2):
            response=await self.client.post('/api/v1/commerce/payment/notify',content=body,headers=headers)
            self.assertEqual(response.status_code,200,response.text)
        paid=await asyncio.gather(*(b2b.order_view(self.request,o['id']) for _ in range(5)))
        self.assertTrue(all(x['fulfilled'] for x in paid))
        self.assertEqual(Decimal(o['amount']),90)
        async with get_async_db() as db:
            for model,n in [(GiftCard,2),(B2BCard,2),(B2BCheckout,1)]:
                self.assertEqual((await db.execute(select(func.count()).select_from(model))).scalar(),n)
        inventory=await b2b.inventory(Inventory(company_id='company-a',owner_ids=['sales-a'],include_codes=True))
        self.assertEqual(len(inventory['items']),2)
        self.assertEqual(inventory['items'][0]['orderId'],'local-order-one')
        with self.assertRaises(HTTPException):
            await b2b.create_purchase(self.request,self.purchase(quantity=2,company_id='company-b'))
        with self.assertRaises(HTTPException):
            await b2b.create_purchase(self.request,self.purchase(quantity=2,unit_price='1'))

    async def test_toc_and_tob_compete_for_same_last_stock(self):
        rows=await asyncio.gather(self.buy(quantity=2),b2b.create_purchase(self.request,self.purchase(quantity=2)),return_exceptions=True)
        self.assertEqual(sum(isinstance(r,dict) for r in rows),1)
        self.assertEqual(sum(isinstance(r,HTTPException) and r.status_code==409 for r in rows),1)

    async def test_manual_is_zero_collection_atomic_and_idempotent(self):
        rows=await asyncio.gather(*(b2b.manual_issue(self.request,self.manual(quantity=2)) for _ in range(4)))
        self.assertTrue(all(r['fulfilled'] and r['amount'] is None and r['payment'] is None for r in rows))
        self.assertFalse(self.orders,'manual gifts must never call the merchant')
        self.assertEqual(await GiftCards.available_counts_by_tier(),{'pro':2})
        rejected=await self.http('/manual',self.manual(order_id='another-manual').model_dump())
        self.assertEqual(rejected.status_code,409,rejected.text)
        self.assertTrue(rejected.json()['order_not_created'])
        with self.assertRaises(HTTPException):
            await b2b.manual_issue(self.request,self.manual(quantity=2,note='changed'))

    async def test_three_level_transfer_and_full_ledger(self):
        await b2b.manual_issue(self.request,self.manual())
        inv=await b2b.inventory(Inventory(company_id='company-a',owner_ids=['company-root'],include_codes=True))
        card=inv['items'][0];code=card['code']
        first=await asyncio.gather(*(b2b.transfer(self.request,self.transfer(code)) for _ in range(4)))
        self.assertEqual(len({r['id'] for r in first}),1)
        await b2b.transfer(self.request,self.transfer(code,from_id='sales-a',to_id='reseller-a',request_id='transfer-request-two'))
        report=await b2b.transfer_report(TransferReport(company_id='company-a',owner_ids=['company-root','sales-a','reseller-a']))
        self.assertEqual(len(report['items']),2)
        for r in report['items']:
            self.assertEqual((r['unitPrice'],r['amount'],r['paidAmount']),('0.000000',)*3)
            self.assertEqual(r['cards'][0]['orderId'],'manual-local-one')
            self.assertEqual(r['cards'][0]['cardRef'],card['cardRef'])
            self.assertNotIn(code,json.dumps(r))
        hidden=await b2b.inventory(Inventory(company_id='company-a',owner_ids=['reseller-a']))
        self.assertIsNone(hidden['items'][0]['code'])
        self.assertEqual(hidden['items'][0]['source'],'TRANSFER')
        empty=await b2b.inventory(Inventory(company_id='company-b',owner_ids=['reseller-a'],include_codes=True))
        self.assertEqual(empty['items'],[])
        future=await b2b.transfer_report(TransferReport(company_id='company-a',owner_ids=['reseller-a'],start=int(time.time())+60))
        self.assertEqual(future['items'],[])
        async with get_async_db() as db:
            self.assertEqual((await db.execute(select(func.count()).select_from(GiftCard))).scalar(),1)

    async def test_competing_transfers_cross_company_and_redeemed_cards(self):
        await b2b.manual_issue(self.request,self.manual())
        code=(await b2b.inventory(Inventory(company_id='company-a',owner_ids=['company-root'],include_codes=True)))['items'][0]['code']
        with self.assertRaises(HTTPException):
            await b2b.transfer(self.request,self.transfer(code,company_id='company-b'))
        rows=await asyncio.gather(*(b2b.transfer(self.request,self.transfer(code,to_id=dest,request_id='request-'+dest))
            for dest in ['sales-a','sales-b']),return_exceptions=True)
        self.assertEqual(sum(isinstance(r,dict) for r in rows),1)
        owner='sales-a' if isinstance(rows[0],dict) else 'sales-b'
        async with get_async_db() as db:
            c=await db.get(GiftCard,code);c.redeemed_by=self.user.id;c.redeemed_at=int(time.time());await db.commit()
        with self.assertRaises(HTTPException):
            await b2b.transfer(self.request,self.transfer(code,from_id=owner,request_id='redeemed-request'))

    async def test_cancel_late_payment_and_paid_cancel_race(self):
        order=await b2b.create_purchase(self.request,self.purchase())
        await b2b.order_view(self.request,order['id'],cancel=True)
        self.assertEqual((await b2b.order_view(self.request,order['id'],snapshot=True))['status'],'CANCELLED')
        self.paid(order)
        # Simulate the existing signed report importer seeing late money.
        async with get_async_db() as db:
            row=await db.get(CommerceTransaction,order['id']);row.payment=self.orders[order['id']];await db.commit()
        result=await b2b.order_view(self.request,order['id'],snapshot=True)
        self.assertEqual((result['status'],result['fulfilled']),('PAID_REQUIRES_ADMIN',False))
        recovered=await self.http('/orders/'+order['id']+'/recover',{'actor_id':'test-platform-admin'})
        self.assertEqual(recovered.status_code,200,recovered.text)
        self.assertTrue(recovered.json()['fulfilled'])
        async with get_async_db() as db:
            self.assertEqual((await db.execute(select(func.count()).select_from(B2BCard))).scalar(),1)
        second=await b2b.create_purchase(self.request,self.purchase(order_id='second-order',buyer_id='other-sales'))
        self.paid(second)
        with self.assertRaises(HTTPException):
            await b2b.order_view(self.request,second['id'],cancel=True)
        self.assertTrue((await b2b.order_view(self.request,second['id']))['fulfilled'])

    async def test_failure_before_attach_rolls_back_and_retry_recovers(self):
        o=await b2b.create_purchase(self.request,self.purchase());self.paid(o)
        original=b2b.attach_cards
        async def crash(*args):
            await original(*args)
            raise RuntimeError('test crash before commit')
        with patch.object(b2b,'attach_cards',crash):
            with self.assertRaises(RuntimeError):await b2b.order_view(self.request,o['id'])
        async with get_async_db() as db:
            self.assertFalse((await db.get(CommerceTransaction,o['id'])).fulfilled)
            self.assertEqual((await db.execute(select(func.count()).select_from(B2BCard))).scalar(),0)
        self.assertTrue((await b2b.order_view(self.request,o['id']))['fulfilled'])

    async def test_additive_migration_round_trip_preserves_toc(self):
        import importlib.util
        from pathlib import Path
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        order=await self.buy()
        for name in ('b2b_transfer','b2b_card','b2b_checkout'):Base.metadata.tables[name].drop(engine)
        path=Path(__file__).parents[1]/'open_webui/migrations/versions/f7b8c9d0e1f2_add_b2b_inventory.py'
        spec=importlib.util.spec_from_file_location('b2b_migration',path)
        migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade();migration.downgrade();migration.upgrade()
        async with get_async_db() as db:self.assertIsNotNone(await db.get(CommerceTransaction,order['id']))
