import { WEBUI_API_BASE_URL } from '$lib/constants';

// P3: read the signed-in user's KyberRouter wallet balance + token usage.
// Returns { linked: false } when the user has no linked KyberRouter key (the
// widget then hides), else { linked: true, today, thisMonth, total, credits, topup_url }.
export const getKyberUsage = async (token: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/kyber/usage`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err;
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

// P5: create a USDT top-up. Returns { id, address, qrCodeImage, usdtAmount, chainId, status }.
export const createKyberTopUp = async (token: string, amountUsd: number, chainId: string) => {
	let error = null;
	const res = await fetch(`${WEBUI_API_BASE_URL}/kyber/topup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ amount_usd: amountUsd, chain_id: chainId })
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail ?? err;
			return null;
		});
	if (error) throw error;
	return res;
};

// P5: poll a top-up's status. Returns { id, status, credited, amountUsd, address, txHash }.
export const getKyberTopUpStatus = async (token: string, id: string) => {
	let error = null;
	const res = await fetch(`${WEBUI_API_BASE_URL}/kyber/topup/${id}`, {
		method: 'GET',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail ?? err;
			return null;
		});
	if (error) throw error;
	return res;
};
