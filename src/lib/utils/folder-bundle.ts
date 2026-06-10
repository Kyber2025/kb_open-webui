// Folder attach (Claude Code-style): the user picks a local folder, we filter it
// down to readable code/text files client-side and bundle them into ONE virtual
// text file (a directory tree + per-file sections with relative-path headers).
// That single file rides the existing upload/RAG pipeline, so every later
// question retrieves the relevant file chunks automatically — without spamming
// one upload + one embedding job + one attachment chip per source file.

// Directories that are dependency/build/VCS noise — skipped at any depth.
const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.svn',
	'.hg',
	'dist',
	'build',
	'out',
	'.next',
	'.nuxt',
	'.svelte-kit',
	'.output',
	'target',
	'vendor',
	'venv',
	'.venv',
	'__pycache__',
	'.pytest_cache',
	'.mypy_cache',
	'.ruff_cache',
	'.cache',
	'coverage',
	'.idea',
	'.vscode',
	'.terraform',
	'.gradle',
	'Pods',
	'DerivedData'
]);

// Extensions we treat as readable source/config/docs.
const TEXT_EXTENSIONS = new Set([
	'js',
	'mjs',
	'cjs',
	'ts',
	'mts',
	'jsx',
	'tsx',
	'svelte',
	'vue',
	'astro',
	'py',
	'rb',
	'php',
	'java',
	'kt',
	'kts',
	'scala',
	'go',
	'rs',
	'c',
	'h',
	'cpp',
	'cc',
	'hpp',
	'cs',
	'swift',
	'm',
	'mm',
	'dart',
	'lua',
	'r',
	'jl',
	'ex',
	'exs',
	'erl',
	'hs',
	'clj',
	'zig',
	'sh',
	'bash',
	'zsh',
	'fish',
	'ps1',
	'bat',
	'cmd',
	'sql',
	'prisma',
	'graphql',
	'gql',
	'proto',
	'html',
	'htm',
	'css',
	'scss',
	'sass',
	'less',
	'styl',
	'json',
	'jsonc',
	'json5',
	'yaml',
	'yml',
	'toml',
	'ini',
	'cfg',
	'conf',
	'properties',
	'env',
	'xml',
	'csv',
	'tsv',
	'md',
	'mdx',
	'markdown',
	'rst',
	'txt',
	'gradle',
	'tf',
	'tfvars',
	'hcl',
	'nix',
	'cmake',
	'mk',
	'gitignore',
	'dockerignore',
	'editorconfig',
	'lock'
]);

// Extension-less files that are conventionally text.
const TEXT_BASENAMES = new Set([
	'dockerfile',
	'makefile',
	'rakefile',
	'gemfile',
	'procfile',
	'caddyfile',
	'jenkinsfile',
	'vagrantfile',
	'license',
	'readme',
	'changelog',
	'codeowners',
	'.gitignore',
	'.dockerignore',
	'.editorconfig',
	'.prettierrc',
	'.eslintrc',
	'.nvmrc',
	'.babelrc'
]);

// Lockfiles are technically text but huge and useless as model context.
const SKIP_BASENAMES = new Set([
	'package-lock.json',
	'yarn.lock',
	'pnpm-lock.yaml',
	'cargo.lock',
	'poetry.lock',
	'composer.lock',
	'gemfile.lock',
	'uv.lock',
	'go.sum'
]);

export const FOLDER_MAX_FILE_BYTES = 1 * 1024 * 1024; // per-file cap (1 MB)
export const FOLDER_MAX_TOTAL_BYTES = 4 * 1024 * 1024; // bundle cap (4 MB)
export const FOLDER_MAX_FILES = 400;

export interface FolderBundleResult {
	file: File;
	folderName: string;
	kept: number;
	skipped: number;
	truncated: boolean;
}

// A picked file plus its folder-relative path ("root/sub/file.ext").
export interface FolderEntry {
	file: File;
	path: string;
}

// Fallback path (webkitdirectory input): the browser enumerates the whole tree
// itself — relative paths come from webkitRelativePath.
export const entriesFromFileList = (files: File[]): FolderEntry[] =>
	files.map((f) => ({
		file: f,
		path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
	}));

// Preferred path (File System Access API, Chrome/Edge): we walk the directory
// handle ourselves and skip noise dirs DURING traversal — so picking a huge
// folder never enumerates node_modules/.git, and the browser shows a mild
// "let site view files?" permission prompt instead of webkitdirectory's scary
// "upload N files?" dialog.
const SCAN_MAX_FILES = 30000; // traversal safety valve
const SCAN_MAX_DEPTH = 16;
const SCAN_MAX_CANDIDATES = FOLDER_MAX_FILES * 2;

export const collectFolderEntries = async (dirHandle: any): Promise<FolderEntry[]> => {
	const out: FolderEntry[] = [];
	let scanned = 0;

	const walk = async (handle: any, prefix: string, depth: number): Promise<void> => {
		if (depth > SCAN_MAX_DEPTH || out.length >= SCAN_MAX_CANDIDATES) return;
		for await (const [name, child] of handle.entries()) {
			if (++scanned > SCAN_MAX_FILES || out.length >= SCAN_MAX_CANDIDATES) return;
			if (child.kind === 'directory') {
				// Hidden dirs and dependency/build/VCS dirs are pruned here, so we
				// never descend into them at all.
				if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
				await walk(child, `${prefix}${name}/`, depth + 1);
			} else if (child.kind === 'file') {
				const path = `${prefix}${name}`;
				if (!isProbablyTextPath(path)) continue;
				try {
					const file = await child.getFile();
					if (file.size > 0 && file.size <= FOLDER_MAX_FILE_BYTES) {
						out.push({ file, path });
					}
				} catch (e) {
					// unreadable entry (permission/transient) — skip
				}
			}
		}
	};

	await walk(dirHandle, `${dirHandle.name}/`, 0);
	return out;
};

const isProbablyTextPath = (path: string): boolean => {
	const segments = path.split('/');
	const base = segments[segments.length - 1];
	const baseLower = base.toLowerCase();

	// Skip noise dirs at any depth (but never filter on the root folder name itself).
	if (segments.slice(1, -1).some((seg) => SKIP_DIRS.has(seg))) return false;

	if (SKIP_BASENAMES.has(baseLower)) return false;

	// Real .env files may hold secrets — only allow the example/template variants.
	if (baseLower === '.env' || (baseLower.startsWith('.env.') && !baseLower.includes('example'))) {
		return false;
	}

	if (TEXT_BASENAMES.has(baseLower)) return true;

	const dot = baseLower.lastIndexOf('.');
	if (dot === -1) return false;
	const ext = baseLower.slice(dot + 1);

	// Hidden files: only the explicitly known ones (handled above).
	if (base.startsWith('.') && dot === 0) return TEXT_EXTENSIONS.has(ext);

	return TEXT_EXTENSIONS.has(ext);
};

/**
 * Filter folder entries down to readable code/text files and bundle them into a
 * single virtual .txt File (tree + per-file sections). Returns null when nothing
 * readable was found. `maxTotalBytes` caps the bundle size — pass a small cap
 * for temporary chats, where the content is injected verbatim into the context
 * instead of being chunked/retrieved by RAG.
 */
export const bundleFolder = async (
	entries: FolderEntry[],
	maxTotalBytes: number = FOLDER_MAX_TOTAL_BYTES
): Promise<FolderBundleResult | null> => {
	const candidates = entries
		.filter(
			(e) =>
				e.file.size > 0 && e.file.size <= FOLDER_MAX_FILE_BYTES && isProbablyTextPath(e.path)
		)
		.sort((a, b) => a.path.localeCompare(b.path));

	if (candidates.length === 0) return null;

	const first = candidates[0].path;
	const folderName = first.includes('/') ? first.split('/')[0] : 'folder';

	let truncated = candidates.length > FOLDER_MAX_FILES;
	const limited = candidates.slice(0, FOLDER_MAX_FILES);

	const sections: string[] = [];
	const keptPaths: string[] = [];
	let total = 0;

	for (const e of limited) {
		let content: string;
		try {
			content = await e.file.text();
		} catch (err) {
			continue;
		}
		// Binary sniff: NUL byte means a binary file wearing a text extension.
		if (content.includes(String.fromCharCode(0))) continue;

		if (total + content.length > maxTotalBytes) {
			truncated = true;
			break;
		}
		total += content.length;
		keptPaths.push(e.path);
		sections.push(`\n===== FILE: ${e.path} =====\n${content}`);
	}

	if (keptPaths.length === 0) return null;

	const header =
		`Codebase bundle of folder "${folderName}" (${keptPaths.length} files` +
		`${truncated ? ', truncated' : ''}).\n\nDirectory structure:\n` +
		keptPaths.map((p) => `  ${p}`).join('\n') +
		'\n';

	const bundle = new File([header + sections.join('\n')], `${folderName}.codebase.txt`, {
		type: 'text/plain'
	});

	return {
		file: bundle,
		folderName,
		kept: keptPaths.length,
		skipped: entries.length - keptPaths.length,
		truncated
	};
};
