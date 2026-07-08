<script lang="ts">
	// Persistent in-chat download button for generated office files (Excel/Word).
	//
	// The real file-building JS can only run inside a sandboxed artifact iframe.
	// The right-side artifact panel is transient (the user can close it), so to
	// keep a clickable download in the conversation itself we render our OWN tiny
	// hidden iframe with the same artifact, let the doc-gen skill build the file
	// and postMessage it back as a data: URL, then show a download button under
	// the message. The button holds the bytes in this component, so it survives
	// closing the panel and works with a single click (real user gesture here).
	//
	// Only activates for artifacts the doc-gen skill produced — detected by the
	// literal marker string 'kyberDocgen' that the skill's postMessage carries.
	import { onDestroy, getContext } from 'svelte';
	import { getCodeBlockContents } from '$lib/utils';
	import Download from '$lib/components/icons/Download.svelte';

	const i18n = getContext('i18n');

	export let content = '';
	export let done = false;

	type DocFile = { filename: string; dataUrl: string };

	let srcdocs: string[] = [];
	let frames: HTMLIFrameElement[] = [];
	let files: DocFile[] = [];
	let built = false;

	const MARKER = 'kyberDocgen';

	const wrap = (g: { html: string; css: string; js: string }) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<${''}style>body{background:#fff;}
${g.css}</${''}style></head>
<body>
${g.html}
<${''}script>
${g.js}</${''}script>
</body></html>`;

	const build = () => {
		if (built || !done || !content || content.indexOf(MARKER) === -1) return;
		let groups: Array<{ html: string; css: string; js: string }> = [];
		try {
			groups = (getCodeBlockContents(content) as any)?.htmlGroups ?? [];
		} catch (e) {
			return;
		}
		const docs = groups
			.map((g) => wrap(g))
			.filter((doc) => doc.indexOf(MARKER) !== -1);
		if (docs.length === 0) return;
		built = true;
		srcdocs = docs;
	};

	$: if (done && content) build();

	const onMessage = (e: MessageEvent) => {
		const d: any = e?.data;
		if (!d || d.source !== MARKER || !d.dataUrl || !d.filename) return;
		// only accept from our own hidden iframes
		if (!frames.some((f) => f && f.contentWindow === e.source)) return;
		if (files.some((f) => f.filename === d.filename && f.dataUrl === d.dataUrl)) return;
		files = [...files, { filename: String(d.filename), dataUrl: String(d.dataUrl) }];
	};

	const download = (f: DocFile) => {
		const a = document.createElement('a');
		a.href = f.dataUrl;
		a.download = f.filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	};

	if (typeof window !== 'undefined') window.addEventListener('message', onMessage);
	onDestroy(() => {
		if (typeof window !== 'undefined') window.removeEventListener('message', onMessage);
	});
</script>

<!-- hidden generator iframes: build the file, post it back, never shown -->
{#each srcdocs as doc, i}
	<iframe
		bind:this={frames[i]}
		title="file-gen"
		srcdoc={doc}
		sandbox="allow-scripts"
		aria-hidden="true"
		tabindex="-1"
		style="position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none;"
	></iframe>
{/each}

{#if files.length > 0}
	<div class="flex flex-wrap gap-2 mt-2">
		{#each files as f}
			<button
				class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
				on:click={() => download(f)}
			>
				<Download className="size-3.5" />
				{$i18n.t('Download')} · {f.filename}
			</button>
		{/each}
	</div>
{/if}
