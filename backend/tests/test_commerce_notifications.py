"""Sales-day boundaries, no-sales silence and two-node outbox/recovery checks."""
import asyncio
from datetime import datetime, date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock
from sqlalchemy import select, func
from test_reseller_commerce import CommerceTests as Setup, commerce, get_async_db
from open_webui.models.commerce import CommerceNotice, CommerceHold
from open_webui.utils import commerce_jobs as jobs, commerce_recovery as recovery
import unittest


class NotificationTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = Setup.asyncSetUp
    asyncTearDown = Setup.asyncTearDown
    buy = Setup.buy
    paid = Setup.paid
    headers = Setup.headers

    def test_daily_uses_hong_kong_paid_day_and_excludes_manual_from_revenue(self):
        def row(source, paid_at=None, amount='10', quantity=1, fulfilled=True):
            return SimpleNamespace(source=source, created_at=int(datetime(2026,11,4,10,tzinfo=jobs.HK).timestamp()),
                quantity=quantity, fulfilled=fulfilled, status='PAID', payment={'status':'PAID','paidAt':paid_at,'paidAmount':amount})
        rows=[row('subscription','2026-11-04T16:00:00Z','120'), row('reseller','2026-11-05T15:59:59Z','15',2),
            row('reseller','2026-11-05T16:00:00Z','999'), row('manual',amount='999'),
            row('subscription','2026-11-05T01:00:00Z','120',fulfilled=False)]
        payload=jobs.daily_payload(rows,date(2026,11,5))
        self.assertEqual(payload['ordinaryCount'],2)
        self.assertEqual(Decimal(payload['ordinaryAmount']),240)
        self.assertEqual(Decimal(payload['resellerAmount']),15)
        self.assertEqual(payload['deliveredCodes'],2)
        self.assertEqual(payload['pendingCount'],1)
        self.assertIsNone(jobs.daily_payload([rows[3]],date(2026,11,5)))

    async def test_daily_waits_until_nine_and_zero_sales_sends_nothing(self):
        day=datetime.now(jobs.HK).date()
        await jobs.queue_notices(int(datetime.combine(day,datetime.min.time(),jobs.HK).timestamp())+9*3600)
        sender=AsyncMock(return_value={'delivered':True})
        with patch.object(jobs,'merchant_request',sender):await jobs.dispatch_notices(self.request)
        sender.assert_not_awaited()

    async def test_daily_nine_oclock_across_nodes_queues_once(self):
        from open_webui.models.commerce import CommerceTransaction
        from datetime import timedelta
        today=datetime.now(jobs.HK).date()
        midnight=int(datetime.combine(today,datetime.min.time(),jobs.HK).timestamp())
        order=await self.buy();self.paid(order)
        await commerce.sync_purchase(self.request,self.user.id,order['id'])
        async with get_async_db() as db:
            row=await db.get(CommerceTransaction,order['id'])
            row.paid_at=midnight-1
            row.payment={**row.payment,'paidAt':datetime.fromtimestamp(midnight-1,jobs.HK).isoformat()}
            await db.commit()
        await jobs.queue_notices(midnight+8*3600+59*60)
        async with get_async_db() as db:
            self.assertEqual((await db.execute(select(func.count()).select_from(CommerceNotice))).scalar(),0)
        await asyncio.gather(jobs.queue_notices(midnight+9*3600),jobs.queue_notices(midnight+9*3600))
        async with get_async_db() as db:
            rows=(await db.execute(select(CommerceNotice))).scalars().all()
            self.assertEqual(len(rows),1)
            self.assertEqual(rows[0].payload['resellerCount'],1)
            self.assertEqual(rows[0].payload['day'],(today-timedelta(days=1)).isoformat())

    async def test_paid_without_hold_alert_is_durable_retryable_and_recovery_is_atomic(self):
        order=await self.buy(quantity=2)
        remote=self.orders[order['id']]
        remote.update(status='EXPIRED',finalStatus=True)
        await commerce.sync_purchase(self.request,self.user.id,order['id'])
        self.paid(order)
        late=await commerce.sync_purchase(self.request,self.user.id,order['id'])
        self.assertEqual(late['status'],'PAID_REQUIRES_ADMIN')
        self.assertEqual(late['cards'],[])
        await asyncio.gather(jobs.queue_notices(),jobs.queue_notices())
        async with get_async_db() as db:
            self.assertEqual((await db.execute(select(func.count()).select_from(CommerceNotice))).scalar(),1)
        sender=AsyncMock(return_value={'delivered':False})
        with patch.object(jobs,'merchant_request',sender):await jobs.dispatch_notices(self.request)
        async with get_async_db() as db:
            notice=await db.get(CommerceNotice,'unfulfilled:'+order['id'])
            self.assertFalse(notice.sent);self.assertEqual(notice.attempts,1)
            notice.next_attempt_at=0;await db.commit()
        sender=AsyncMock(return_value={'delivered':True})
        with patch.object(jobs,'merchant_request',sender):
            await asyncio.gather(jobs.dispatch_notices(self.request),jobs.dispatch_notices(self.request))
        self.assertEqual(sender.await_count,1)
        with patch.object(recovery,'merchant_request',commerce.merchant_request):
            result=await recovery.retry_fulfillment(self.request,self.admin,order['id'])
            self.assertTrue(result['fulfilled'])
            result=await recovery.retry_fulfillment(self.request,self.admin,order['id'])
            self.assertTrue(result['fulfilled'])
        async with get_async_db() as db:self.assertIsNone(await db.get(CommerceHold,order['id']))


if __name__=='__main__':unittest.main()
