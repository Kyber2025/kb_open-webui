// Local-folder ⇄ sandbox mirroring for Code mode.
//
// The Code agent runs in a cloud sandbox and cannot see the user's local disk,
// so "open a folder like Claude Code" is implemented as a mirror: push the
// picked folder's files into the workspace, then pull back whatever the agent
// changed. Chrome/Edge use the File System Access API for true two-way sync
// (changes written straight back to the local folder); other browsers fall back
// to a one-way import + a "download updated copy" zip.

import { syncFolderIn, listWorkspaceFiles, getWorkspaceFile } from '$lib/apis/code';
import { WEBUI_API_BASE_URL } from '$lib/constants';

// Never import these — noise / huge / machine-generated.
const SKIP_DIRS = new Set([
	'node_modules', '.git', '.cache', '.local', '.config', '.svelte-kit',
	'dist', 'build', '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.idea', '.vscode'
]);
const MAX_FILE = 2 * 1024 * 1024; // skip single files > 2MB on import (assets/binaries)
const BATCH_BYTES = 12 * 1024 * 1024; // base64 budget per /fs/write request
const BATCH_FILES = 200;

export const supportsDirPicker = (): boolean =>
	typeof (window as any).showDirectoryPicker === 'function';

function sanitizeName(n: string): string {
	const s = (n || 'project').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '');
	return s.slice(0, 63) || 'project';
}

function abufToB64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let bin = '';
	const CH = 0x8000; // chunk to avoid call-stack overflow on apply()
	for (let i = 0; i < bytes.length; i += CH) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[]);
	}
	return btoa(bin);
}

async function* walkHandle(
	dir: any,
	prefix = ''
): AsyncGenerator<{ rel: string; file: File }> {
	for await (const [name, h] of dir.entries()) {
		const rel = prefix ? `${prefix}/${name}` : name;
		if (h.kind === 'directory') {
			if (SKIP_DIRS.has(name)) continue;
			yield* walkHandle(h, rel);
		} else {
			yield { rel, file: await h.getFile() };
		}
	}
}

type ImportResult = { folderName: string; handle: any | null; count: number };

// Open a local folder via File System Access (Chrome/Edge), request read-write
// so we can mirror changes back, and push its files into the sandbox.
export async function pickAndSyncFolder(
	token: string,
	onProgress?: (n: number) => void
): Promise<ImportResult> {
	const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
	try {
		await handle.requestPermission?.({ mode: 'readwrite' });
	} catch {
		/* read-only is still useful (no write-back) */
	}
	const folderName = sanitizeName(handle.name);
	let batch: { path: string; content: string }[] = [];
	let batchBytes = 0;
	let count = 0;
	const flush = async () => {
		if (!batch.length) return;
		await syncFolderIn(token, batch);
		batch = [];
		batchBytes = 0;
	};
	for await (const { rel, file } of walkHandle(handle)) {
		if (file.size > MAX_FILE) continue;
		const b64 = abufToB64(await file.arrayBuffer());
		batch.push({ path: `${folderName}/${rel}`, content: b64 });
		batchBytes += b64.length;
		count++;
		onProgress?.(count);
		if (batchBytes >= BATCH_BYTES || batch.length >= BATCH_FILES) await flush();
	}
	await flush();
	return { folderName, handle, count };
}

// Fallback import via <input webkitdirectory> (any browser, no write-back handle).
export async function syncFileList(
	token: string,
	fileList: FileList,
	onProgress?: (n: number) => void
): Promise<ImportResult> {
	const top = (fileList[0]?.webkitRelativePath || '').split('/')[0] || 'project';
	const folderName = sanitizeName(top);
	let batch: { path: string; content: string }[] = [];
	let count = 0;
	const flush = async () => {
		if (!batch.length) return;
		await syncFolderIn(token, batch);
		batch = [];
	};
	for (const f of Array.from(fileList)) {
		if (f.size > MAX_FILE) continue;
		const parts = (f.webkitRelativePath || f.name).split('/');
		if (parts.some((p) => SKIP_DIRS.has(p))) continue;
		const inner = parts.slice(1).join('/') || f.name; // strip the top folder name
		batch.push({ path: `${folderName}/${inner}`, content: abufToB64(await f.arrayBuffer()) });
		count++;
		onProgress?.(count);
		if (batch.length >= BATCH_FILES) await flush();
	}
	await flush();
	return { folderName, handle: null, count };
}

// Snapshot current mtimes for a folder so pullChanges only writes back real edits.
export async function buildBaseline(
	token: string,
	folderName: string,
	baseline: Map<string, number>
): Promise<void> {
	const { files } = await listWorkspaceFiles(token);
	const prefix = `${folderName}/`;
	for (const f of files) if (f.path.startsWith(prefix)) baseline.set(f.path, f.mtime);
}

async function writeLocalFile(root: any, rel: string, blob: Blob): Promise<void> {
	const parts = rel.split('/');
	let dir = root;
	for (let i = 0; i < parts.length - 1; i++) {
		dir = await dir.getDirectoryHandle(parts[i], { create: true });
	}
	const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
	const w = await fh.createWritable();
	await w.write(blob);
	await w.close();
}

// Write back to the local folder every workspace file under `folderName/` whose
// mtime advanced past the baseline. Returns how many files were updated.
export async function pullChanges(
	token: string,
	folderName: string,
	handle: any,
	baseline: Map<string, number>
): Promise<number> {
	const { files } = await listWorkspaceFiles(token);
	const prefix = `${folderName}/`;
	let wrote = 0;
	for (const f of files) {
		if (!f.path.startsWith(prefix)) continue;
		const prev = baseline.get(f.path);
		if (prev !== undefined && prev >= f.mtime) continue; // unchanged since last sync
		try {
			const blob = await getWorkspaceFile(token, f.path);
			await writeLocalFile(handle, f.path.slice(prefix.length), blob);
			baseline.set(f.path, f.mtime);
			wrote++;
		} catch {
			/* skip a file that vanished / is too large */
		}
	}
	return wrote;
}

// Fallback write-back: download the whole workspace as a zip (browsers without
// File System Access). Streams through the authenticated backend proxy.
export async function downloadWorkspaceZip(token: string): Promise<void> {
	const res = await fetch(`${WEBUI_API_BASE_URL}/code/fs/download`, {
		headers: { authorization: `Bearer ${token}` }
	});
	if (!res.ok) throw await res.json().catch(() => ({ detail: res.statusText }));
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'workspace.zip';
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}
