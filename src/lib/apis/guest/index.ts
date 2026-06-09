import { WEBUI_API_BASE_URL } from '$lib/constants';

// The shared anonymous account every guest session authenticates as.
export const GUEST_EMAIL = 'guest@guest.local';
export const isGuestUser = (user: any): boolean => user?.email === GUEST_EMAIL;

// Stable per-browser device id (one half of the IP+device guest limit).
export const getGuestDeviceId = (): string => {
	try {
		let id = localStorage.getItem('guest-device-id');
		if (!id) {
			id =
				typeof crypto !== 'undefined' && crypto.randomUUID
					? crypto.randomUUID()
					: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
			localStorage.setItem('guest-device-id', id);
		}
		return id;
	} catch (e) {
		return '';
	}
};

const request = async (
	path: string,
	token: string,
	method: string = 'GET',
	body: any = undefined
) => {
	let error = null;
	const res = await fetch(`${WEBUI_API_BASE_URL}/guest${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		credentials: 'include',
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
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
	if (error) throw error;
	return res;
};

export const getGuestStatus = async (token: string) => request('/status', token);

export const getGuestConfig = async (token: string) => request('/config', token);

export const updateGuestConfig = async (token: string, config: any) =>
	request('/config', token, 'POST', config);

export const getGuestBlacklist = async (token: string) => request('/blacklist', token);

export const addGuestBlacklist = async (token: string, ip: string, reason: string = '') =>
	request('/blacklist', token, 'POST', { ip, reason });

export const removeGuestBlacklist = async (token: string, ip: string) =>
	request(`/blacklist/${encodeURIComponent(ip)}`, token, 'DELETE');
