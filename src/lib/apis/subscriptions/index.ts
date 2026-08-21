import { WEBUI_API_BASE_URL } from '$lib/constants';

type Json = Record<string, any>;

/**
 * Send an expired/rejected session back to the sign-in page.
 *
 * `+layout.svelte` already signs out proactively from `$user.expires_at`, but that
 * only covers the case where the frontend HOLDS a usable expiry: a token revoked
 * server-side, a tab that slept through its 15s interval, or a session that was
 * already dead on load all reach the API and come back 401 with nothing watching.
 * The subscription dialog then renders normally while every call fails, which is
 * how a user ended up staring at "兑换失败 (401)" on a perfectly valid gift card.
 */
const redirectToSignIn = () => {
	if (typeof window === 'undefined') return;
	localStorage.removeItem('token');
	const here = window.location.pathname + window.location.search;
	window.location.href = `/auth?redirect=${encodeURIComponent(here)}`;
};

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
			if (res.status === 401) {
				redirectToSignIn();
				throw { detail: 'Your session has expired. Please sign in again.' };
			}
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

// ── Admin: per-user plan & usage ─────────────────────────────

// Plan + expiry + live 5h/weekly token usage for one page of users (one call, no
// fan-out per row). Users with no KyberRouter link come back with `usage: null`.
export const getAdminUsersOverview = (token: string, userIds: string[]) =>
	request(token, '/admin/users/overview', 'POST', { user_ids: userIds });

// Put a user on a plan. `expires_at` is epoch SECONDS and is set exactly (it can
// shorten a subscription); omit it to grant `duration_days` (or the tier's own
// duration) from now. Choosing the free tier revokes instead.
export const setUserSubscription = (
	token: string,
	userId: string,
	payload: { tier_id: string; expires_at?: number | null; duration_days?: number | null }
) => request(token, `/admin/users/${encodeURIComponent(userId)}/subscription`, 'POST', payload);

export const revokeUserSubscription = (token: string, userId: string) =>
	request(token, `/admin/users/${encodeURIComponent(userId)}/subscription`, 'DELETE');

// Clear the rolling token windows on KyberRouter (both when `windows` is omitted).
export const resetUserUsage = (token: string, userId: string, windows?: ('5h' | 'week')[]) =>
	request(token, `/admin/users/${encodeURIComponent(userId)}/usage/reset`, 'POST', {
		windows: windows ?? null
	});

// ── Admin: gift cards ────────────────────────────────────────

export const generateGiftCards = (
	token: string,
	payload: { tier_id: string; count: number; duration_days?: number | null; note?: string | null }
) => request(token, '/admin/gift-cards', 'POST', payload);

export const getGiftCards = (token: string, statusFilter = '', search = '', batchId = '') => {
	const params = new URLSearchParams();
	if (statusFilter && statusFilter !== 'all') params.set('status_filter', statusFilter);
	if (search && search.trim()) params.set('search', search.trim());
	if (batchId) params.set('batch_id', batchId);
	const qs = params.toString();
	return request(token, `/admin/gift-cards${qs ? `?${qs}` : ''}`);
};

export const setGiftCardStatus = (token: string, code: string, enabled: boolean) =>
	request(token, `/admin/gift-cards/${encodeURIComponent(code)}/status`, 'POST', { enabled });

// Refund a redeemed gift card: voids the code AND revokes the subscription it granted.
export const invalidateGiftCard = (token: string, code: string) =>
	request(token, `/admin/gift-cards/${encodeURIComponent(code)}/invalidate`, 'POST');

export const deleteGiftCard = (token: string, code: string) =>
	request(token, `/admin/gift-cards/${encodeURIComponent(code)}`, 'DELETE');
