import { WEBUI_API_BASE_URL } from '$lib/constants';

// Code mode talks to a per-user `opencode` process on the sandbox node, proxied
// by the backend at /api/v1/code/sandbox/* (which injects the sandbox secret and
// the user's KyberRouter key server-side). The browser only ever sees its owui
// bearer token.

const SANDBOX = `${WEBUI_API_BASE_URL}/code/sandbox`;
const FS = `${WEBUI_API_BASE_URL}/code/fs`;

const authHeaders = (token: string) => ({
	Accept: 'application/json',
	authorization: `Bearer ${token}`
});

// opencode's `/path` — `directory` is the workspace root the server runs in.
// The folder picker needs it to map each session's absolute directory back to
// a top-level folder name.
export const getWorkspacePaths = async (token: string): Promise<{ directory?: string }> => {
	const res = await fetch(`${SANDBOX}/path`, { headers: authHeaders(token) });
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	return res.json();
};

// List workspace-root entries via opencode's `/file?path=.`
// (entries: { name, type: 'file' | 'directory', ignored, ... }).
export const listWorkspaceEntries = async (token: string) => {
	const res = await fetch(`${SANDBOX}/file?path=.`, { headers: authHeaders(token) });
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	return res.json();
};

// Create a top-level folder in the sandbox workspace (sandbox-manager /fs/mkdir).
export const createWorkspaceFolder = async (token: string, name: string) => {
	const res = await fetch(`${FS}/mkdir`, {
		method: 'POST',
		headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
		body: JSON.stringify({ name })
	});
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	return res.json();
};

// ── Local-folder sync (Code mode "open folder") ─────────────────────────────
// The browser can't expose a local folder to the cloud agent directly, so we
// mirror it: push the picked folder's files into the workspace, then pull back
// whatever the agent changed.

// Push a batch of files into the workspace. `content` is base64.
export const syncFolderIn = async (
	token: string,
	files: { path: string; content: string }[]
) => {
	const res = await fetch(`${FS}/write`, {
		method: 'POST',
		headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
		body: JSON.stringify({ files })
	});
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	return res.json();
};

// Full workspace manifest (recursive) for diffing what changed.
export const listWorkspaceFiles = async (
	token: string
): Promise<{ files: { path: string; size: number; mtime: number }[] }> => {
	const res = await fetch(`${FS}/list`, { headers: authHeaders(token) });
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	return res.json();
};

// Fetch one workspace file's raw bytes (to write back to the local folder).
export const getWorkspaceFile = async (token: string, path: string): Promise<Blob> => {
	const res = await fetch(`${FS}/get?path=${encodeURIComponent(path)}`, {
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	return res.blob();
};

export type CodeModel = { id: string; name: string };

export const getCodeConfig = async (
	token: string
): Promise<{ enabled: boolean; reason?: string; models?: CodeModel[]; provider?: string }> => {
	const res = await fetch(`${WEBUI_API_BASE_URL}/code/config`, {
		headers: authHeaders(token)
	})
		.then((r) => r.json())
		.catch(() => ({ enabled: false, reason: 'error' }));
	return res;
};

export const listSessions = async (token: string) => {
	const res = await fetch(`${SANDBOX}/session`, { headers: authHeaders(token) });
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	return res.json();
};

// `directory` is a folder name RELATIVE to the workspace root ('' = root);
// opencode resolves it against its cwd and scopes the session's tools to it.
export const createSession = async (token: string, title = 'Untitled', directory = '') => {
	const qs = directory ? `?directory=${encodeURIComponent(directory)}` : '';
	const res = await fetch(`${SANDBOX}/session${qs}`, {
		method: 'POST',
		headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
		body: JSON.stringify({ title })
	});
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	return res.json();
};

export const deleteSession = async (token: string, sessionId: string) => {
	const res = await fetch(`${SANDBOX}/session/${sessionId}`, {
		method: 'DELETE',
		headers: authHeaders(token)
	});
	return res.ok;
};

export const getMessages = async (token: string, sessionId: string) => {
	const res = await fetch(`${SANDBOX}/session/${sessionId}/message`, {
		headers: authHeaders(token)
	});
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	return res.json();
};

export const sendPrompt = async (
	token: string,
	sessionId: string,
	opts: { providerID: string; modelID: string; text: string }
) => {
	const res = await fetch(`${SANDBOX}/session/${sessionId}/prompt_async`, {
		method: 'POST',
		headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: { providerID: opts.providerID, modelID: opts.modelID },
			parts: [{ type: 'text', text: opts.text }]
		})
	});
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	return res.json().catch(() => ({}));
};

export const abortSession = async (token: string, sessionId: string) => {
	const res = await fetch(`${SANDBOX}/session/${sessionId}/abort`, {
		method: 'POST',
		headers: authHeaders(token)
	});
	return res.ok;
};

/**
 * Subscribe to the opencode global SSE event stream via the backend proxy.
 * EventSource can't set an Authorization header, so we read the text/event-stream
 * with fetch + a stream reader and invoke `onEvent` per parsed JSON event.
 * Returns when `signal` aborts or the stream ends.
 */
export const subscribeEvents = async (
	token: string,
	onEvent: (ev: any) => void,
	signal: AbortSignal
): Promise<void> => {
	const res = await fetch(`${SANDBOX}/event`, {
		headers: authHeaders(token),
		signal
	});
	if (!res.ok || !res.body) throw new Error(`event stream failed: ${res.status}`);

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		// SSE frames are separated by a blank line; each frame may carry one data: line.
		let idx;
		while ((idx = buf.indexOf('\n\n')) !== -1) {
			const frame = buf.slice(0, idx);
			buf = buf.slice(idx + 2);
			for (const line of frame.split('\n')) {
				const s = line.trimStart();
				if (!s.startsWith('data:')) continue;
				const data = s.slice(5).trim();
				if (!data || data === '[DONE]') continue;
				try {
					onEvent(JSON.parse(data));
				} catch {
					/* ignore keep-alive / partial */
				}
			}
		}
	}
};
