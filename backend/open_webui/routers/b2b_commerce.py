"""Service-only API. No browser or customer credential can quote a ToB price."""
import hashlib
import hmac
import os
import time
from fastapi.responses import JSONResponse
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from sqlalchemy import select
from open_webui.internal.db import get_async_db
from open_webui.models.subscriptions import SubscriptionTier
from open_webui.utils.commerce_inventory import available_stock
from open_webui.utils import b2b_commerce


async def service_auth(request: Request, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    secret = os.environ.get('B2B_COMMERCE_SECRET', '')
    if len(secret) < 32:
        raise HTTPException(503, 'ToB commerce integration is not configured')
    raw = await request.body()
    stamp = request.headers.get('X-B2B-Timestamp', '')
    nonce = request.headers.get('X-B2B-Nonce', '')
    try:
        if len(raw) > 65536 or abs(int(stamp) - int(time.time())) > 60 or not 16 <= len(nonce) <= 80:
            raise ValueError()
        message = '\n'.join([request.method, request.url.path, stamp, nonce, hashlib.sha256(raw).hexdigest()])
        expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, request.headers.get('X-B2B-Signature', '')):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(401, 'Invalid ToB service signature')


router = APIRouter(dependencies=[Depends(service_auth)])


class Purchase(BaseModel):
    model_config = ConfigDict(extra='forbid')
    company_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    buyer_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    order_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    tier_id: str = Field(pattern=r'^(pro|ultra)$')
    quantity: StrictInt = Field(ge=1, le=100)
    chain_id: str = Field(pattern=r'^[0-9]{1,20}$')
    unit_price: str = Field(pattern=r'^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?$')


    @field_validator('unit_price')
    @classmethod
    def positive_price(cls, value):
        from decimal import Decimal
        if Decimal(value) <= 0: raise ValueError('Price must be positive')
        return value


@router.get('/catalog')
async def catalog(request: Request):
    async with get_async_db() as db:
        tiers = (await db.execute(select(SubscriptionTier).where(SubscriptionTier.id.in_(('pro', 'ultra')),
            SubscriptionTier.enabled.is_(True)))).scalars().all()
        return {'tiers': [{'id': t.id, 'name': t.name, 'durationDays': t.duration_days,
            'remaining': await available_stock(request, db, t.id)} for t in tiers],
            'chains': [{'id': str(c['id']), 'name': c.get('name', str(c['id']))}
                for c in request.app.state.config.SUBSCRIPTION_CHAINS or []]}


async def guarded_create(request, form, create):
    try:
        return await create(request, form)
    except HTTPException as error:
        # Only an explicit business rejection with no committed intent may end
        # local retries. Timeouts/500s remain unknown and reuse the same order ID.
        from open_webui.models.commerce import B2BCheckout
        async with get_async_db() as db:
            saved=(await db.execute(select(B2BCheckout.order_id).where(B2BCheckout.external_id==form.order_id))).first()
        return JSONResponse(status_code=error.status_code, content={'detail':error.detail,
            'order_not_created':saved is None and error.status_code in (400,403,404,409,422,429)}, headers={'Cache-Control':'no-store'})


@router.post('/orders')
async def create(request: Request, form: Purchase):
    return await guarded_create(request, form, b2b_commerce.create_purchase)


@router.get('/orders/{order_id}')
async def read(request: Request, order_id: str):
    return await b2b_commerce.order_view(request, order_id)


@router.get('/orders/{order_id}/snapshot')
async def snapshot(request: Request, order_id: str):
    return await b2b_commerce.order_view(request, order_id, snapshot=True)


@router.post('/orders/{order_id}/cancel')
async def cancel(request: Request, order_id: str):
    return await b2b_commerce.order_view(request, order_id, cancel=True)


class Manual(BaseModel):
    model_config = ConfigDict(extra='forbid')
    company_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    buyer_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    order_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')
    tier_id: str = Field(pattern=r'^(pro|ultra)$')
    quantity: StrictInt = Field(ge=1,le=100)
    note: str = Field(min_length=1,max_length=500)


class Inventory(BaseModel):
    model_config = ConfigDict(extra='forbid')
    company_id: str = Field(min_length=1,max_length=80)
    owner_ids: list[str] = Field(min_length=1,max_length=2000)
    include_codes: bool = False
    offset: StrictInt = Field(default=0,ge=0,le=1000000)


class TransferReport(Inventory):
    start: StrictInt | None = Field(default=None, ge=0)
    end: StrictInt | None = Field(default=None, ge=0)


class Transfer(BaseModel):
    model_config = ConfigDict(extra='forbid')
    company_id: str = Field(min_length=1,max_length=80)
    from_id: str = Field(min_length=1,max_length=80)
    to_id: str = Field(min_length=1,max_length=80)
    actor_id: str = Field(min_length=1,max_length=80)
    request_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{8,80}$')
    codes: list[str] = Field(min_length=1,max_length=100)
    note: str = Field(min_length=1,max_length=500)


@router.post('/manual')
async def manual(request: Request, form: Manual):
    return await guarded_create(request, form, b2b_commerce.manual_issue)


@router.post('/inventory')
async def inventory(form: Inventory):
    return await b2b_commerce.inventory(form)


@router.post('/transfers')
async def transfer(request: Request, form: Transfer):
    return await b2b_commerce.transfer(request,form)


@router.post('/transfers/report')
async def report(form: TransferReport):
    return await b2b_commerce.transfer_report(form)


class Recovery(BaseModel):
    model_config = ConfigDict(extra='forbid')
    actor_id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,80}$')


@router.post('/orders/{order_id}/recover')
async def recover(request: Request, order_id: str, form: Recovery):
    from types import SimpleNamespace
    from open_webui.models.commerce import CommerceTransaction
    from open_webui.utils.commerce_recovery import retry_fulfillment
    async with get_async_db() as db:
        row=await db.get(CommerceTransaction, order_id)
        if not row or row.source != 'b2b': raise HTTPException(404,'企业购买订单不存在')
    await retry_fulfillment(request, SimpleNamespace(id='b2b:'+form.actor_id), order_id)
    return await b2b_commerce.order_view(request, order_id)
