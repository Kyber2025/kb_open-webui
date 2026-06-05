import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from open_webui.models.subscriptions import (
    GiftCards,
    SubscriptionOrders,
    SubscriptionTierForm,
    SubscriptionTiers,
    UserSubscriptions,
)
from open_webui.utils.auth import get_admin_user, get_verified_user
from open_webui.utils.subscription import (
    create_subscription_order,
    generate_gift_cards,
    get_subscription_state,
    redeem_gift_card,
    seed_default_tiers,
    sync_order,
)

log = logging.getLogger(__name__)

router = APIRouter()


class SubscribeForm(BaseModel):
    tier_id: str
    chain_id: str


class RedeemForm(BaseModel):
    code: str


class GiftCardGenerateForm(BaseModel):
    tier_id: str
    count: int = 1
    duration_days: Optional[int] = None
    note: Optional[str] = None


class GiftCardStatusForm(BaseModel):
    enabled: bool


############################
# User-facing endpoints
############################


@router.get('/tiers')
async def get_tiers(user=Depends(get_verified_user)):
    """Enabled tiers for the subscription page."""
    return await SubscriptionTiers.list_tiers(enabled_only=True)


@router.get('/chains')
async def get_chains(request: Request, user=Depends(get_verified_user)):
    return request.app.state.config.SUBSCRIPTION_CHAINS or []


@router.get('/me')
async def get_me(user=Depends(get_verified_user)):
    """Current effective tier + today's usage + active subscription."""
    return await get_subscription_state(user.id, is_admin=(user.role == 'admin'))


@router.post('/subscribe')
async def subscribe(request: Request, form_data: SubscribeForm, user=Depends(get_verified_user)):
    """Create a USDT payment order for a tier; returns the checkout payload (address + QR)."""
    if not getattr(request.app.state.config, 'ENABLE_SUBSCRIPTIONS', True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Subscriptions are disabled')
    return await create_subscription_order(request, user, form_data.tier_id, form_data.chain_id)


@router.get('/order/{order_id}')
async def get_order(request: Request, order_id: str, user=Depends(get_verified_user)):
    """Poll order status; activates the subscription on first PAID."""
    return await sync_order(request, user, order_id)


@router.get('/orders')
async def list_my_orders(user=Depends(get_verified_user)):
    return await SubscriptionOrders.list_for_user(user.id)


@router.post('/redeem')
async def redeem(request: Request, form_data: RedeemForm, user=Depends(get_verified_user)):
    """Redeem a gift card / redemption code and activate the granted plan."""
    return await redeem_gift_card(request, user, form_data.code)


############################
# Admin endpoints
############################


@router.get('/admin/tiers')
async def admin_list_tiers(user=Depends(get_admin_user)):
    return await SubscriptionTiers.list_tiers(enabled_only=False)


@router.post('/admin/tiers')
async def admin_upsert_tier(form_data: SubscriptionTierForm, user=Depends(get_admin_user)):
    tier_id = (form_data.id or '').strip().lower()
    if not tier_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Tier id is required')
    form_data.id = tier_id
    tier = await SubscriptionTiers.upsert_tier(form_data)
    if tier is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail='Failed to save tier')
    return tier


@router.delete('/admin/tiers/{tier_id}')
async def admin_delete_tier(tier_id: str, user=Depends(get_admin_user)):
    from open_webui.utils.subscription import DEFAULT_TIER_ID

    if tier_id == DEFAULT_TIER_ID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='The default free tier cannot be deleted')
    ok = await SubscriptionTiers.delete_tier(tier_id)
    return {'success': ok}


@router.post('/admin/seed')
async def admin_seed_tiers(user=Depends(get_admin_user)):
    """Seed the default tiers (no-op if any tier already exists)."""
    await seed_default_tiers()
    return await SubscriptionTiers.list_tiers(enabled_only=False)


@router.get('/admin/subscriptions')
async def admin_list_subscriptions(user=Depends(get_admin_user)):
    return await UserSubscriptions.list_all()


############################
# Admin — gift cards
############################


@router.post('/admin/gift-cards')
async def admin_generate_gift_cards(form_data: GiftCardGenerateForm, user=Depends(get_admin_user)):
    """Generate a batch of single-use gift cards for a tier. Returns the new codes."""
    return await generate_gift_cards(
        user, form_data.tier_id, form_data.count, form_data.duration_days, form_data.note
    )


@router.get('/admin/gift-cards')
async def admin_list_gift_cards(
    status_filter: Optional[str] = None,
    batch_id: Optional[str] = None,
    user=Depends(get_admin_user),
):
    """List gift cards (most recent first, capped) plus summary counts.
    `status_filter` ∈ all | available | redeemed | disabled."""
    cards = await GiftCards.list_cards(status=status_filter, batch_id=batch_id)
    counts = await GiftCards.counts()
    return {'cards': cards, 'counts': counts}


@router.post('/admin/gift-cards/{code}/status')
async def admin_set_gift_card_status(
    code: str, form_data: GiftCardStatusForm, user=Depends(get_admin_user)
):
    ok = await GiftCards.set_enabled(code, form_data.enabled)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Gift card not found')
    return {'success': True, 'enabled': form_data.enabled}


@router.delete('/admin/gift-cards/{code}')
async def admin_delete_gift_card(code: str, user=Depends(get_admin_user)):
    ok = await GiftCards.delete(code)
    return {'success': ok}
