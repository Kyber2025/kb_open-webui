<script lang="ts">
	// Persistent in-chat download button for generated office files (Excel/Word/PDF).
	//
	// The real file-building JS can only run inside a sandboxed artifact iframe.
	// The right-side artifact panel is transient (the user can close it), so to
	// keep a clickable download in the conversation itself we render our OWN
	// off-screen hidden iframe with the same artifact, let the doc-gen skill build
	// the file and postMessage it back as a data: URL, then show a download button
	// under the message. The button holds the bytes in this component, so it
	// survives closing the panel and works with a single click (real user gesture).
	//
	// The iframe is off-screen but given a REAL size — html2canvas (PDF path) needs
	// layout dimensions to render, so a 0x0 iframe produced blank/failed PDFs.
	//
	// While the file is still building we show a "preparing…" pill so the user gets
	// honest status instead of the model claiming "done" before the file exists.
	//
	// Only activates for artifacts the doc-gen skill produced — detected by the
	// literal marker string 'kyberDocgen' that the skill's postMessage carries.
	import { onDestroy, getContext } from 'svelte';
	import { getCodeBlockContents } from '$lib/utils';
	import Download from '$lib/components/icons/Download.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';

	const i18n = getContext('i18n');

	export let content = '';
	export let done = false;

	type DocFile = { filename: string; dataUrl: string };

	let srcdocs: string[] = [];
	let frames: HTMLIFrameElement[] = [];
	let files: DocFile[] = [];
	let built = false;
	let pending = false; // building started, no file yet
	let timedOut = false;
	let timer: any = null;

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
		const docs = groups.map((g) => wrap(g)).filter((doc) => doc.indexOf(MARKER) !== -1);
		if (docs.length === 0) return;
		built = true;
		srcdocs = docs;
		pending = true;
		// html2canvas (PDF) can be slow; give it room but don't spin forever.
		timer = setTimeout(() => {
			if (files.length === 0) {
				pending = false;
				timedOut = true;
			}
		}, 25000);
	};

	$: if (done && content) build();

	const onMessage = (e: MessageEvent) => {
		const d: any = e?.data;
		if (!d || d.source !== MARKER || !d.dataUrl || !d.filename) return;
		// only accept from our own hidden iframes
		if (!frames.some((f) => f && f.contentWindow === e.source)) return;
		if (files.some((f) => f.filename === d.filename && f.dataUrl === d.dataUrl)) return;
		files = [...files, { filename: String(d.filename), dataUrl: String(d.dataUrl) }];
		pending = false;
		timedOut = false;
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
		if (timer) clearTimeout(timer);
	});
</script>

<!-- hidden generator iframes: off-screen but real-sized so html2canvas can render -->
{#each srcdocs as doc, i}
	<iframe
		bind:this={frames[i]}
		title="file-gen"
		srcdoc={doc}
		sandbox="allow-scripts"
		aria-hidden="true"
		tabindex="-1"
		style="position:fixed;left:-99999px;top:0;width:900px;height:1200px;border:0;opacity:0;pointer-events:none;"
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
{:else if pending}
	<div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mt-2">
		<Spinner className="size-3.5" />
		{$i18n.t('Preparing file for download…')}
	</div>
{/if}
