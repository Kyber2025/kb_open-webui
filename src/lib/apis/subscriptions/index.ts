import { WEBUI_API_BASE_URL } from '$lib/constants';

type Json = Record<string, any>;

const request = async (
	token: string,
	path: string,
	method: 'GET' | 'POST' | 'DELETE' = 'GET',
	body: Json | null = null
) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/subscriptions${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		...(body ? { body: JSON.stringify(body) } : {})
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			console.error(err);
			error = err.detail ?? err;
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

// ── User-facing ──────────────────────────────────────────────

export const getSubscriptionTiers = (token: string) => request(token, '/tiers');

export const getSubscriptionChains = (token: string) => request(token, '/chains');

export const getMySubscription = (token: string) => request(token, '/me');

export const subscribe = (token: string, tier_id: string, chain_id: string) =>
	request(token, '/subscribe', 'POST', { tier_id, chain_id });

export const getSubscriptionOrder = (token: string, orderId: string) =>
	request(token, `/order/${encodeURIComponent(orderId)}`);

export const getMyOrders = (token: string) => request(token, '/orders');

export const redeemGiftCard = (token: string, code: string) =>
	request(token, '/redeem', 'POST', { code });

// Flip the per-user paid-overflow ("extra usage") opt-in. Returns { enabled }.
export const setExtraUsage = (token: string, enabled: boolean) =>
	request(token, '/extra-usage', 'POST', { enabled });

// ── Admin ────────────────────────────────────────────────────

export const getAdminTiers = (token: string) => request(token, '/admin/tiers');

export const upsertTier = (token: string, tier: Json) =>
	request(token, '/admin/tiers', 'POST', tier);

export const deleteTier = (token: string, tierId: string) =>
	request(token, `/admin/tiers/${encodeURIComponent(tierId)}`, 'DELETE');

export const seedTiers = (token: string) => request(token, '/admin/seed', 'POST');

export const getAdminSubscriptions = (token: string) => request(token, '/admin/subscriptions');

// ── Admin: gift cards ────────────────────────────────────────

export const generateGiftCards = (
	token: string,
	payload: { tier_id: string; count: number; duration_days?: number | null; note?: string | null }
) => request(token, '/admin/gift-cards', 'POST', payload);

export const getGiftCards = (token: string, statusFilter = '', batchId = '') => {
	const params = new URLSearchParams();
	if (statusFilter && statusFilter !== 'all') params.set('status_filter', statusFilter);
	if (batchId) params.set('batch_id', batchId);
	const qs = params.toString();
	return request(token, `/admin/gift-cards${qs ? `?${qs}` : ''}`);
};

export const setGiftCardStatus = (token: string, code: string, enabled: boolean) =>
	request(token, `/admin/gift-cards/${encodeURIComponent(code)}/status`, 'POST', { enabled });

export const deleteGiftCard = (token: string, code: string) =>
	request(token, `/admin/gift-cards/${encodeURIComponent(code)}`, 'DELETE');
