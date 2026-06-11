import { describe, expect, it } from 'vitest';

import {
	SMALL_FOLDER_FULL_CHARS,
	buildFileTree,
	buildFolderContext,
	buildFullFolderContext,
	extractTerms,
	mountFolderFromEntries,
	renderFolderContext,
	runFolderSearch,
	summarizeSearchResults,
	type MountedFolder
} from './folder-context';
import type { FolderEntry } from './folder-bundle';

const mkFolder = (files: Record<string, string>): MountedFolder => {
	const fs = Object.entries(files).map(([path, content]) => ({
		path,
		content,
		lower: content.toLowerCase()
	}));
	return {
		name: fs[0].path.includes('/') ? fs[0].path.split('/')[0] : 'folder',
		files: fs,
		fileCount: fs.length,
		totalBytes: fs.reduce((n, f) => n + f.content.length, 0),
		truncated: false
	};
};

describe('extractTerms', () => {
	it('keeps identifiers and drops stop words', () => {
		const terms = extractTerms('How does the deploy-k2.sh script restart docker?');
		expect(terms).toContain('deploy-k2.sh');
		expect(terms).toContain('docker');
		expect(terms).not.toContain('the');
		expect(terms).not.toContain('how');
	});

	it('emits CJK runs and bigrams', () => {
		const terms = extractTerms('限流策略');
		expect(terms).toContain('限流策略');
		expect(terms).toContain('限流');
	});
});

describe('buildFullFolderContext (small-folder mode)', () => {
	it('includes every file in full', () => {
		const folder = mkFolder({
			'repo/README.md': '# Demo project\nA deployment demo.',
			'repo/deploy.sh': 'docker compose up -d backend'
		});
		expect(folder.totalBytes).toBeLessThanOrEqual(SMALL_FOLDER_FULL_CHARS);

		const result = buildFullFolderContext(folder);
		expect(result.hits).toBe(2);
		expect(result.content).toContain('FILE TREE:');
		expect(result.content).toContain('docker compose up -d backend');
		expect(result.content).toContain('# Demo project');
		expect(result.content).toContain('COMPLETE contents');
	});
});

describe('buildFileTree', () => {
	it('annotates sizes and caps length', () => {
		const folder = mkFolder({
			'repo/a.ts': 'x'.repeat(2048),
			'repo/b.ts': 'y'
		});
		const tree = buildFileTree(folder);
		expect(tree).toContain('repo/a.ts (2KB)');
		expect(tree).toContain('repo/b.ts (1B)');
	});

	it('summarizes files beyond the window per directory', () => {
		const files: Record<string, string> = { 'repo/README.md': '# top' };
		for (let i = 0; i < 30; i++) files[`repo/vendored/sub/f${i}.ts`] = 'x';
		const folder = mkFolder(files);

		const tree = buildFileTree(folder, 5);
		expect(tree).toContain('repo/README.md');
		expect(tree).toContain('plus 26 more files under:');
		expect(tree).toContain('repo/vendored/ (+26)');
	});
});

describe('mountFolderFromEntries', () => {
	it('mounts shallow files first so root docs survive downstream caps', async () => {
		const mkEntry = (path: string): FolderEntry =>
			({ path, file: { text: async () => `content of ${path}` } }) as unknown as FolderEntry;

		// Deliberately deep-first input — simulates a DFS walk that visited a
		// vendored repo before the root-level docs.
		const folder = await mountFolderFromEntries([
			mkEntry('repo/vendored/src/deep/a.ts'),
			mkEntry('repo/vendored/b.ts'),
			mkEntry('repo/SESSION-HANDOFF.md'),
			mkEntry('repo/ARCHITECTURE.md')
		]);

		expect(folder).not.toBeNull();
		expect(folder!.files.map((f) => f.path)).toEqual([
			'repo/ARCHITECTURE.md',
			'repo/SESSION-HANDOFF.md',
			'repo/vendored/b.ts',
			'repo/vendored/src/deep/a.ts'
		]);
	});
});

describe('runFolderSearch', () => {
	const folder = mkFolder({
		'repo/README.md': '# Demo\nSee docs for the deployment architecture.',
		'repo/jenkins/deploy.sh': '#!/bin/sh\ndocker compose pull\ndocker compose up -d',
		'repo/src/auth.ts': 'export const login = () => {}'
	});

	it('English planner keywords find content for a Chinese question', () => {
		// Literal Chinese terms match nothing in the English files…
		const literal = runFolderSearch(folder, '部署架构是怎样的');
		expect(literal.named.length + literal.snippets.length).toBe(0);

		// …but the planner's English keywords do.
		const planned = runFolderSearch(folder, '部署架构是怎样的', ['deploy', 'docker', 'architecture']);
		expect(planned.planned).toBe(true);
		expect(planned.named.length + planned.snippets.length).toBeGreaterThan(0);
	});

	it('resolves planner file picks exactly and by basename', () => {
		const outcome = runFolderSearch(folder, '部署架构是怎样的', [], ['repo/jenkins/deploy.sh', 'README.md']);
		expect(outcome.named.map((f) => f.path)).toEqual(['repo/jenkins/deploy.sh', 'repo/README.md']);
	});

	it('does not duplicate planner-picked files as snippets', () => {
		const outcome = runFolderSearch(folder, 'deploy', [], ['repo/jenkins/deploy.sh']);
		expect(outcome.snippets.every((sn) => sn.path !== 'repo/jenkins/deploy.sh')).toBe(true);
	});
});

describe('renderFolderContext', () => {
	const folder = mkFolder({
		'repo/README.md': '# Demo\nDeployment architecture overview.',
		'repo/deploy.sh': 'docker compose up -d'
	});

	it('falls back to key project files when nothing matches', () => {
		const outcome = runFolderSearch(folder, '完全无关的问题谢谢');
		const result = renderFolderContext(folder, outcome);
		expect(result.hits).toBe(0);
		expect(result.content).toContain('KEY PROJECT FILES');
		expect(result.content).toContain('# Demo');
	});

	it('mentions planner-driven search when planned', () => {
		const outcome = runFolderSearch(folder, '部署架构', ['deploy'], ['README.md']);
		const result = renderFolderContext(folder, outcome);
		expect(result.content).toContain('planning model');
		expect(result.content).toContain('FILES READ IN FULL');
	});
});

describe('summarizeSearchResults', () => {
	it('lists full reads and grep hit locations', () => {
		const folder = mkFolder({
			'repo/README.md': '# Demo\nDeployment architecture overview.',
			'repo/deploy.sh': 'echo start\ndocker compose up -d\necho done'
		});
		const outcome = runFolderSearch(folder, 'docker', [], ['README.md']);
		const summary = summarizeSearchResults(outcome);
		expect(summary).toContain('Read in full: repo/README.md');
		expect(summary).toContain('repo/deploy.sh');
		expect(summary).toMatch(/lines \d+-\d+/);
	});

	it('reports empty rounds', () => {
		const folder = mkFolder({ 'repo/a.ts': 'const x = 1;' });
		const outcome = runFolderSearch(folder, '毫无命中的查询词汇');
		expect(summarizeSearchResults(outcome)).toBe('No matches in this round.');
	});
});

describe('buildFolderContext (compat wrapper)', () => {
	it('still works single-shot with extra queries', () => {
		const folder = mkFolder({
			'repo/deploy.sh': 'docker compose up -d backend'
		});
		const result = buildFolderContext(folder, '部署在哪里', ['docker']);
		expect(result.hits).toBeGreaterThan(0);
		expect(result.content).toContain('docker compose');
	});
});
