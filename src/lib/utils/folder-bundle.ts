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

const relPath = (f: File): string =>
	// webkitRelativePath is "folder/sub/file.ext" for directory-picker files.
	(f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;

const isProbablyText = (f: File): boolean => {
	const path = relPath(f);
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
 * Filter a directory-picker FileList down to readable code/text files and bundle
 * them into a single virtual .txt File (tree + per-file sections). Returns null
 * when nothing readable was found. `maxTotalBytes` caps the bundle size — pass a
 * small cap for temporary chats, where the content is injected verbatim into the
 * context instead of being chunked/retrieved by RAG.
 */
export const bundleFolder = async (
	inputFiles: File[],
	maxTotalBytes: number = FOLDER_MAX_TOTAL_BYTES
): Promise<FolderBundleResult | null> => {
	const candidates = inputFiles
		.filter((f) => f.size > 0 && f.size <= FOLDER_MAX_FILE_BYTES && isProbablyText(f))
		.sort((a, b) => relPath(a).localeCompare(relPath(b)));

	if (candidates.length === 0) return null;

	const first = relPath(candidates[0]);
	const folderName = first.includes('/') ? first.split('/')[0] : 'folder';

	let truncated = candidates.length > FOLDER_MAX_FILES;
	const limited = candidates.slice(0, FOLDER_MAX_FILES);

	const sections: string[] = [];
	const keptPaths: string[] = [];
	let total = 0;

	for (const f of limited) {
		let content: string;
		try {
			content = await f.text();
		} catch (e) {
			continue;
		}
		// Binary sniff: NUL byte means a binary file wearing a text extension.
		if (content.includes(String.fromCharCode(0))) continue;

		if (total + content.length > maxTotalBytes) {
			truncated = true;
			break;
		}
		total += content.length;
		keptPaths.push(relPath(f));
		sections.push(`\n===== FILE: ${relPath(f)} =====\n${content}`);
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
		skipped: inputFiles.length - keptPaths.length,
		truncated
	};
};
