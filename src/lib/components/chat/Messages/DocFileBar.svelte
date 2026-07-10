<script lang="ts">
	// Persistent in-chat action bar for generated office files.
	//
	// The real file-building JS can only run inside a sandboxed artifact iframe.
	// The right-side artifact panel is transient (the user can close it), so to
	// keep a clickable action in the conversation itself we render our OWN
	// off-screen hidden iframe with the same artifact. The doc-gen skill then
	// signals back via postMessage (source 'kyberDocgen'):
	//   • Excel/Word → a data: URL of the built file → we show a one-click
	//     "Download" button (bytes held here, survives closing the panel).
	//   • PDF → a {kind:'pdf'} signal (no bytes: html2canvas can't run in the
	//     no-same-origin sandbox, and embedding a CJK font is impractical). We
	//     show a "Save as PDF" button that spawns a print iframe (allow-modals)
	//     which window.print()s the same content → the browser's Save-as-PDF.
	//
	// The generator iframe is off-screen but real-sized so layout is correct.
	// A "preparing…" pill shows until the file/signal arrives (honest status,
	// instead of the model claiming done before anything is ready).
	import { onDestroy, getContext } from 'svelte';
	import { getCodeBlockContents } from '$lib/utils';
	import { KYBER_PDF_HELPER } from '$lib/utils/kyberPdf';
	import { showArtifacts, showControls, artifactCode } from '$lib/stores';
	import Download from '$lib/components/icons/Download.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';

	const i18n = getContext('i18n');

	export let content = '';
	export let done = false;

	type DocFile = { filename: string; dataUrl: string };
	type PdfDoc = { filename: string; doc: string };

	let srcdocs: string[] = [];
	let frames: HTMLIFrameElement[] = [];
	let files: DocFile[] = [];
	let pdfs: PdfDoc[] = [];
	let built = false;
	let pending = false;
	let timedOut = false;
	let timer: any = null;

	const MARKER = 'kyberDocgen';

	const wrap = (g: { html: string; css: string; js: string }) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<${''}script>${KYBER_PDF_HELPER}</${''}script>
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
		timer = setTimeout(() => {
			if (files.length === 0 && pdfs.length === 0) {
				pending = false;
				timedOut = true;
			}
		}, 20000);
	};

	$: if (done && content) build();

	const onMessage = (e: MessageEvent) => {
		const d: any = e?.data;
		if (!d || d.source !== MARKER || !d.filename) return;
		const idx = frames.findIndex((f) => f && f.contentWindow === e.source);
		if (idx === -1) return; // only our own hidden generator iframes
		if (d.kind === 'pdf') {
			if (!pdfs.some((p) => p.filename === d.filename)) {
				pdfs = [...pdfs, { filename: String(d.filename), doc: srcdocs[idx] ?? '' }];
			}
		} else if (d.dataUrl) {
			if (!files.some((f) => f.filename === d.filename && f.dataUrl === d.dataUrl)) {
				files = [...files, { filename: String(d.filename), dataUrl: String(d.dataUrl) }];
			}
		} else {
			return;
		}
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

	// Open the message's artifact in the right panel. artifactContents (populated
	// by Chat.svelte from the message html) is matched by a substring — the
	// filename appears in the artifact's kyberSend(...) call, so it selects THIS
	// file's artifact.
	const openPreview = (f: DocFile) => {
		artifactCode.set(f.filename);
		showControls.set(true);
		showArtifacts.set(true);
	};

	// Single click → preview (right panel); double click → download.
	let clickTimer: any = null;
	const onFileClick = (f: DocFile) => {
		if (clickTimer) {
			clearTimeout(clickTimer);
			clickTimer = null;
			download(f);
			return;
		}
		clickTimer = setTimeout(() => {
			clickTimer = null;
			openPreview(f);
		}, 240);
	};

	const savePdf = (p: PdfDoc) => {
		// Spawn a print iframe (allow-modals so window.print() is permitted) that
		// renders the same content and prints it → browser "Save as PDF".
		const autoPrint =
			'<' +
			'script>window.addEventListener("load",function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},350);});</' +
			'script></body>';
		const src = p.doc.indexOf('</body>') !== -1 ? p.doc.replace('</body>', autoPrint) : p.doc + autoPrint;
		const f = document.createElement('iframe');
		f.setAttribute('sandbox', 'allow-scripts allow-modals');
		f.setAttribute('srcdoc', src);
		f.style.cssText = 'position:fixed;left:-99999px;top:0;width:900px;height:1200px;border:0;';
		document.body.appendChild(f);
		setTimeout(() => {
			try {
				f.remove();
			} catch (e) {}
		}, 120000);
	};

	if (typeof window !== 'undefined') window.addEventListener('message', onMessage);
	onDestroy(() => {
		if (typeof window !== 'undefined') window.removeEventListener('message', onMessage);
		if (timer) clearTimeout(timer);
		if (clickTimer) clearTimeout(clickTimer);
	});
</script>

<!-- hidden generator iframes: off-screen but real-sized so layout is correct -->
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

{#if files.length > 0 || pdfs.length > 0}
	<div class="flex flex-wrap gap-2 mt-2">
		{#each files as f}
			<button
				class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
				title={$i18n.t('Click to preview · double-click to download')}
				on:click={() => onFileClick(f)}
			>
				<Download className="size-3.5" />
				{$i18n.t('Download')} · {f.filename}
			</button>
		{/each}
		{#each pdfs as p}
			<button
				class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
				on:click={() => savePdf(p)}
			>
				<Download className="size-3.5" />
				{$i18n.t('Save as PDF')} · {p.filename}
			</button>
		{/each}
	</div>
{:else if pending}
	<div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mt-2">
		<Spinner className="size-3.5" />
		{$i18n.t('Preparing file for download…')}
	</div>
{/if}
