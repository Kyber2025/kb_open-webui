// Claude Code-style folder mount: picking a folder reads its code/text files
// into BROWSER MEMORY only — nothing is uploaded at mount time. When the user
// sends a message, we grep the mounted files with keywords extracted from the
// question and attach just the matching snippets (with paths + line numbers)
// to that message as a `type:'text'` item, which the backend injects verbatim
// (retrieval/utils.py get_sources_from_items, text fallback). So the model
// "searches the folder" per question instead of ingesting everything upfront.

import type { FolderEntry } from './folder-bundle';

export interface MountedFile {
	path: string;
	content: string;
	lower: string;
}

export interface MountedFolder {
	name: string;
	files: MountedFile[];
	fileCount: number;
	totalBytes: number;
	truncated: boolean;
}

// In-memory cap — browser RAM, not an upload, so this can be generous.
const MOUNT_MAX_TOTAL_BYTES = 48 * 1024 * 1024;

/** Read filtered folder entries into memory. Returns null when nothing readable. */
export const mountFolderFromEntries = async (
	entries: FolderEntry[]
): Promise<MountedFolder | null> => {
	const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
	const files: MountedFile[] = [];
	let total = 0;
	let truncated = false;

	for (const e of sorted) {
		let content: string;
		try {
			content = await e.file.text();
		} catch (err) {
			continue;
		}
		// Binary sniff: NUL byte means a binary file wearing a text extension.
		if (content.includes(String.fromCharCode(0))) continue;
		if (total + content.length > MOUNT_MAX_TOTAL_BYTES) {
			truncated = true;
			break;
		}
		total += content.length;
		files.push({ path: e.path, content, lower: content.toLowerCase() });
	}

	if (files.length === 0) return null;
	const name = files[0].path.includes('/') ? files[0].path.split('/')[0] : 'folder';
	return { name, files, fileCount: files.length, totalBytes: total, truncated };
};

// Words too generic to be useful grep terms.
const STOP_WORDS = new Set([
	'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on',
	'at', 'for', 'and', 'or', 'not', 'no', 'yes', 'what', 'how', 'why', 'when',
	'where', 'which', 'this', 'that', 'these', 'those', 'with', 'can', 'could',
	'should', 'would', 'you', 'your', 'it', 'its', 'my', 'me', 'we', 'our', 'do',
	'does', 'did', 'done', 'please', 'help', 'about', 'into', 'from', 'there',
	'file', 'files', 'code', 'project', 'folder',
	'的', '了', '吗', '呢', '在', '是', '我', '你', '他', '她', '它', '这个',
	'那个', '什么', '怎么', '怎样', '如何', '为什么', '一个', '哪里', '哪个',
	'请问', '帮我', '一下', '这里', '可以', '应该', '需要', '问题', '文件',
	'代码', '项目', '文件夹', '内容', '里面'
]);

/** Extract grep terms from a user question (latin identifiers + CJK runs/bigrams). */
export const extractTerms = (query: string): string[] => {
	const terms = new Set<string>();

	for (const m of query.matchAll(/[A-Za-z_][A-Za-z0-9_.\-]{1,63}/g)) {
		const w = m[0].toLowerCase();
		if (w.length >= 2 && !STOP_WORDS.has(w)) terms.add(w);
	}

	for (const m of query.matchAll(/[一-鿿]{2,}/g)) {
		const run = m[0];
		if (!STOP_WORDS.has(run) && run.length <= 12) terms.add(run);
		// Sliding bigrams so "充值功能" also matches "充值" in code comments.
		if (run.length > 2 && run.length <= 8) {
			for (let i = 0; i + 2 <= run.length; i++) {
				const bg = run.slice(i, i + 2);
				if (!STOP_WORDS.has(bg)) terms.add(bg);
			}
		}
	}

	return [...terms].slice(0, 24);
};

export interface FolderSnippet {
	path: string;
	startLine: number;
	endLine: number;
	text: string;
	score: number;
}

/** Grep the mounted files for query terms; return top snippets (line windows). */
export const searchFolder = (
	folder: MountedFolder,
	query: string,
	{ maxChars = 24000, maxSnippets = 10, contextLines = 8 } = {}
): { snippets: FolderSnippet[]; terms: string[] } => {
	const terms = extractTerms(query);
	if (terms.length === 0) return { snippets: [], terms };

	const all: FolderSnippet[] = [];

	for (const f of folder.files) {
		const pathLower = f.path.toLowerCase();
		// Cheap whole-file reject before line scanning.
		if (!terms.some((t) => f.lower.includes(t) || pathLower.includes(t))) continue;

		const lines = f.content.split('\n');
		const lowerLines = f.lower.split('\n');

		const hits: { idx: number; score: number }[] = [];
		for (let i = 0; i < lowerLines.length; i++) {
			let s = 0;
			for (const t of terms) {
				if (lowerLines[i].includes(t)) s += t.length >= 4 ? 2 : 1;
			}
			if (s > 0) hits.push({ idx: i, score: s });
		}
		if (hits.length === 0) continue;

		// Merge nearby hit lines into windows.
		type Win = { start: number; end: number; score: number };
		const windows: Win[] = [];
		let cur: Win | null = null;
		for (const h of hits) {
			if (cur && h.idx - cur.end <= contextLines) {
				cur.end = h.idx;
				cur.score += h.score;
			} else {
				if (cur) windows.push(cur);
				cur = { start: h.idx, end: h.idx, score: h.score };
			}
		}
		if (cur) windows.push(cur);

		const pathBonus = terms.some((t) => pathLower.includes(t)) ? 3 : 0;
		const pad = Math.ceil(contextLines / 2);
		for (const w of windows) {
			const s = Math.max(0, w.start - pad);
			const e = Math.min(lines.length - 1, w.end + pad);
			all.push({
				path: f.path,
				startLine: s + 1,
				endLine: e + 1,
				text: lines.slice(s, e + 1).join('\n'),
				score: w.score + pathBonus
			});
		}
	}

	all.sort((a, b) => b.score - a.score);

	const snippets: FolderSnippet[] = [];
	let chars = 0;
	for (const sn of all) {
		if (snippets.length >= maxSnippets) break;
		const text = sn.text.length > 4000 ? sn.text.slice(0, 4000) : sn.text;
		if (chars + text.length > maxChars) continue;
		chars += text.length;
		snippets.push({ ...sn, text });
	}

	return { snippets, terms };
};

const fileTree = (folder: MountedFolder, maxPaths = 300, maxChars = 8000): string => {
	const paths = folder.files.slice(0, maxPaths).map((f) => f.path);
	let tree = paths.join('\n');
	if (tree.length > maxChars) tree = tree.slice(0, maxChars);
	const omitted = folder.fileCount - paths.length;
	return omitted > 0 ? `${tree}\n... (+${omitted} more files)` : tree;
};

// Entry-point files worth attaching whole when a structural question has no
// keyword hits in (mostly English) code — e.g. "这个项目的架构是怎样的".
const KEY_BASENAMES = new Set([
	'readme.md', 'readme.rst', 'readme.txt', 'package.json', 'pyproject.toml',
	'requirements.txt', 'go.mod', 'cargo.toml', 'pom.xml', 'build.gradle',
	'composer.json', 'docker-compose.yml', 'docker-compose.yaml', 'dockerfile',
	'main.py', 'app.py', 'manage.py', 'main.ts', 'main.js', 'index.ts',
	'index.js', 'config.py', 'settings.py', 'svelte.config.js', 'vite.config.ts',
	'next.config.js', 'makefile', 'architecture.md', 'claude.md'
]);

const pickKeyFiles = (folder: MountedFolder, max = 5): MountedFile[] => {
	const matches = folder.files.filter((f) =>
		KEY_BASENAMES.has((f.path.split('/').pop() ?? '').toLowerCase())
	);
	// Shallow paths first — root README/package.json beat deep vendored ones.
	matches.sort(
		(a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path)
	);
	return matches.slice(0, max);
};

// Files explicitly named in the question ("看下 main.py 和 config.py") get
// attached WHOLE — this also closes the loop when the model asks the user for
// specific files: mentioning the names in the next message is enough.
const findNamedFiles = (folder: MountedFolder, terms: string[], max = 4): MountedFile[] => {
	// Only specific-looking terms: filename-ish (contains a dot) or length >= 6.
	const specific = terms.filter((t) => t.includes('.') || t.length >= 6);
	if (specific.length === 0) return [];

	const scored: { f: MountedFile; s: number }[] = [];
	for (const f of folder.files) {
		const pathLower = f.path.toLowerCase();
		const base = pathLower.split('/').pop() ?? '';
		let best = 0;
		for (const t of specific) {
			if (!pathLower.includes(t)) continue;
			let s = t.length;
			if (base === t) s += 100;
			else if (base.includes(t)) s += 50;
			best = Math.max(best, s);
		}
		if (best > 0) {
			scored.push({ f, s: best - pathLower.split('/').length });
		}
	}
	scored.sort((a, b) => b.s - a.s);
	return scored.slice(0, max).map((x) => x.f);
};

const FULL_FILE_CHAR_CAP = 12000; // per whole-file cap
const FULL_FILES_TOTAL_CAP = 30000;

const renderFullFiles = (files: MountedFile[], label: string): string => {
	const parts: string[] = [];
	let total = 0;
	for (const f of files) {
		let text = f.content;
		let note = '';
		if (text.length > FULL_FILE_CHAR_CAP) {
			text = text.slice(0, FULL_FILE_CHAR_CAP);
			note = '\n... (truncated)';
		}
		if (total + text.length > FULL_FILES_TOTAL_CAP) break;
		total += text.length;
		parts.push(`===== ${f.path} (full file) =====\n${text}${note}`);
	}
	return parts.length ? `\n${label}:\n${parts.join('\n\n')}\n` : '';
};

export interface FolderContextResult {
	content: string;
	/** named-file + excerpt hits — 0 means only tree/fallback content. */
	hits: number;
}

/**
 * Build the per-message context block: file tree + whole files named in the
 * question + keyword-matched excerpts. `extraQueries` are model-generated
 * search queries (owui task `retrieval` query generation) — they bridge the
 * Chinese-question-vs-English-code gap by letting the MODEL pick the grep
 * terms when the literal question text matches nothing. With no hits at all,
 * key entry-point files are attached as a last resort.
 */
export const buildFolderContext = (
	folder: MountedFolder,
	query: string,
	extraQueries: string[] = []
): FolderContextResult => {
	const combined = [query, ...extraQueries].join('\n');
	const terms = extractTerms(combined);
	let named = findNamedFiles(folder, terms);
	const namedPaths = new Set(named.map((f) => f.path));

	let { snippets } = searchFolder(folder, combined, {
		// Leave room for whole files when some were named.
		maxChars: named.length > 0 ? 14000 : 24000
	});
	snippets = snippets.filter((sn) => !namedPaths.has(sn.path));

	const hits = named.length + snippets.length;

	let fullLabel = 'FILES NAMED IN THE QUESTION (full content)';
	if (hits === 0) {
		named = pickKeyFiles(folder);
		fullLabel = 'KEY PROJECT FILES (no keyword match — showing entry points)';
	}

	const searchedWith = terms.slice(0, 10).join(', ');
	const header =
		`[Mounted local folder "${folder.name}" — ${folder.fileCount} text/code files, ` +
		`searched client-side with keywords from the user's question` +
		`${extraQueries.length ? ' plus model-generated search queries' : ''}` +
		`${searchedWith ? ` (${searchedWith})` : ''}. ` +
		`To inspect another file, just mention its file name or path in the next ` +
		`message (e.g. "看下 main.py") and its full content will be attached ` +
		`automatically — no need for the user to paste it.]\n\n` +
		`FILE TREE:\n${fileTree(folder)}\n`;

	const fullBlock = renderFullFiles(named, fullLabel);

	const excerptBlock = snippets.length
		? `\nMATCHED EXCERPTS:\n${snippets
				.map((sn) => `===== ${sn.path} (lines ${sn.startLine}-${sn.endLine}) =====\n${sn.text}`)
				.join('\n\n')}`
		: '';

	if (!fullBlock && !excerptBlock) {
		return { content: `${header}\n(No file content matched the question's keywords.)`, hits };
	}

	return { content: `${header}${fullBlock}${excerptBlock}`, hits };
};
