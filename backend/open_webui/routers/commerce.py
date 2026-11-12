import json
import time
from decimal import Decimal
from typing import Literal
from urllib.parse import urlsplit
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, func
from open_webui.internal.db import get_async_db
from open_webui.models.users import User
from open_webui.models.reseller_invites import ResellerInvite, ResellerCustomer
from open_webui.models.commerce import ResellerAccount, CommerceTransaction
from open_webui.utils.auth import get_admin_user, get_verified_user
from open_webui.utils import reseller_commerce as commerce, commerce_reports as reports
from open_webui.utils.subscription_payments import credentials, verify_signature

router = APIRouter()


async def write_guard(request: Request):
    # Browser writes need a bearer token even if session cookies are present.
    if not request.headers.get('authorization', '').startswith('Bearer '):
        raise HTTPException(401, '请重新登录后操作')
    origin = request.headers.get('origin')
    if origin and urlsplit(origin).netloc != request.headers.get('host'):
        raise HTTPException(403, '不允许跨站修改')


class StrictForm(BaseModel):
    model_config = ConfigDict(extra='forbid')


class AssignForm(StrictForm):
    user_id: str = Field(min_length=1, max_length=100)
    invite_id: str | None = Field(default=None, max_length=100)
    name: str | None = Field(default=None, max_length=100)


class StatusForm(StrictForm):
    enabled: bool = Field(strict=True)


class PriceForm(StrictForm):
    scope: str = Field(default='default', min_length=1, max_length=100)
    tier_id: Literal['pro', 'ultra']
    price: Decimal | None = Field(default=None, gt=0, le=1000000, max_digits=18, decimal_places=6)


class PurchaseForm(StrictForm):
    tier_id: Literal['pro', 'ultra']
    quantity: int = Field(ge=1, le=100, strict=True)
    chain_id: str = Field(min_length=1, max_length=12)
    request_id: str = Field(pattern=r'^[A-Za-z0-9_-]{16,80}$')


class Filters(BaseModel):
    source: Literal['subscription', 'reseller', 'manual', 'payment'] | None = None
    tier_id: Literal['pro', 'ultra'] | None = None
    status: str | None = Field(default=None, max_length=40)
    chain_id: str | None = Field(default=None, max_length=12)
    user_id: str | None = Field(default=None, max_length=100)
    search: str | None = Field(default=None, max_length=100)
    start: int | None = Field(default=None, ge=0)
    end: int | None = Field(default=None, ge=0)
    page: int = Field(default=1, ge=1, le=100000)
    page_size: int = Field(default=20, ge=1, le=200)


@router.get('/admin/resellers')
async def list_resellers(response: Response, user=Depends(get_admin_user)):
    response.headers['Cache-Control'] = 'no-store'
    async with get_async_db() as db:
        rows = (await db.execute(select(ResellerAccount, User, ResellerInvite).join(User, User.id == ResellerAccount.user_id)
            .join(ResellerInvite, ResellerInvite.id == ResellerAccount.invite_id)
            .order_by(ResellerAccount.created_at.desc()))).all()
        counts = dict((await db.execute(select(ResellerCustomer.invite_id, func.count()).group_by(ResellerCustomer.invite_id))).all())
        return {'defaults': await commerce.reseller_prices(db), 'items': [dict(user_id=a.user_id, invite_id=a.invite_id,
            name=i.name, user_name=u.name, email=u.email, enabled=a.enabled, invite_enabled=i.enabled,
            short_code=i.short_code, customers=counts.get(i.id, 0), created_at=a.created_at,
            prices=await commerce.reseller_prices(db, a.user_id)) for a,u,i in rows]}


@router.post('/admin/resellers', dependencies=[Depends(write_guard)])
async def assign(form: AssignForm, user=Depends(get_admin_user)):
    return await commerce.assign_reseller(user, form.user_id, form.invite_id, form.name)


@router.post('/admin/resellers/{user_id}/status', dependencies=[Depends(write_guard)])
async def reseller_status(user_id: str, form: StatusForm, user=Depends(get_admin_user)):
    return await commerce.set_reseller_enabled(user_id, form.enabled)


@router.post('/admin/prices', dependencies=[Depends(write_guard)])
async def price(form: PriceForm, user=Depends(get_admin_user)):
    return await commerce.set_price(user, form.scope, form.tier_id, form.price)


@router.get('/admin/transactions')
async def transactions(response: Response, filters: Filters = Depends(), user=Depends(get_admin_user)):
    response.headers['Cache-Control'] = 'no-store'
    return await reports.list_transactions(filters.model_dump())


@router.get('/admin/transactions/export')
async def export(filters: Filters = Depends(), user=Depends(get_admin_user)):
    return StreamingResponse(reports.export_transactions(filters.model_dump()), media_type='text/csv; charset=utf-8',
        headers={'Content-Disposition': 'attachment; filename="kividas-transactions.csv"', 'Cache-Control': 'no-store'})


@router.post('/admin/transactions/sync', dependencies=[Depends(write_guard)])
async def sync(request: Request, user=Depends(get_admin_user)):
    return await reports.sync_payment_reports(request)


@router.post('/admin/transactions/{order_id}/retry', dependencies=[Depends(write_guard)])
async def retry(request: Request, order_id: str, user=Depends(get_admin_user)):
    from open_webui.utils.commerce_recovery import retry_fulfillment
    return await retry_fulfillment(request, user, order_id)


@router.get('/reseller/me')
async def profile(request: Request, response: Response, user=Depends(get_verified_user)):
    response.headers['Cache-Control'] = 'no-store'
    return await commerce.reseller_profile(request, user)


@router.post('/reseller/purchases', dependencies=[Depends(write_guard)])
async def purchase(request: Request, form: PurchaseForm, user=Depends(get_verified_user)):
    return await commerce.create_purchase(request, user, form.tier_id, form.quantity, form.chain_id, form.request_id)


@router.get('/reseller/purchases')
async def purchases(response: Response, filters: Filters = Depends(), user=Depends(get_verified_user)):
    response.headers['Cache-Control'] = 'no-store'
    return await reports.list_transactions(filters.model_dump(), owner=user.id)


@router.get('/reseller/purchases/export')
async def export_purchases(filters: Filters = Depends(), user=Depends(get_verified_user)):
    return StreamingResponse(reports.export_transactions(filters.model_dump(), owner=user.id), media_type='text/csv; charset=utf-8',
        headers={'Content-Disposition': 'attachment; filename="reseller-purchases.csv"', 'Cache-Control': 'no-store'})


@router.get('/reseller/purchases/{order_id}')
async def purchase_status(request: Request, response: Response, order_id: str, user=Depends(get_verified_user)):
    response.headers['Cache-Control'] = 'no-store'
    return await commerce.sync_purchase(request, user.id, order_id)


@router.post('/reseller/purchases/{order_id}/cancel', dependencies=[Depends(write_guard)])
async def cancel_purchase(request: Request, order_id: str, user=Depends(get_verified_user)):
    # Releases the stock hold of the caller's own unpaid purchase; `cancelled` is false if a payment won the race.
    view = await commerce.cancel_purchase(request, user, order_id)
    return {'cancelled': view['status'] == 'CANCELLED', 'order': view}


@router.post('/payment/notify')
async def notify(request: Request):
    app_id, secret = credentials()
    raw = await request.body()
    if len(raw) > 50000 or request.headers.get('X-App-Id') != app_id:
        raise HTTPException(401, 'Invalid payment notification')
    try:
        verify_signature(secret, 'NOTIFY', request.headers.get('X-Timestamp', ''),
            request.headers.get('X-Nonce', ''), raw, request.headers.get('X-Signature'))
        payload = json.loads(raw)
        if not isinstance(payload, dict): raise ValueError()
        if payload.get('event') == 'PING': return PlainTextResponse('success')
        order_id = payload['data']['orderId']
    except Exception:
        raise HTTPException(401, 'Invalid payment notification')
    async with get_async_db() as db:
        order = await db.get(CommerceTransaction, order_id)
        if not order or order.source not in ('reseller', 'b2b'):
            raise HTTPException(404, 'Order not found')
        user_id, source = order.user_id, order.source
    # Never trust callback amounts or PAID flags; query fresh signed evidence.
    await commerce.sync_purchase(request, user_id, order_id, source=source)
    return PlainTextResponse('success')

# Internal ToB callers authenticate independently of customer sessions.
from open_webui.routers.b2b_commerce import router as b2b_router
router.include_router(b2b_router, prefix="/b2b")
