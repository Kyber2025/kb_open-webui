<script lang="ts">
	import { getContext, onMount, onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { toast } from 'svelte-sonner';

	import { config, user } from '$lib/stores';
	import {
		getCodeConfig,
		listSessions,
		createSession,
		deleteSession,
		getMessages,
		sendPrompt,
		abortSession,
		subscribeEvents,
		getWorkspacePaths,
		listWorkspaceEntries,
		createWorkspaceFolder,
		type CodeModel
	} from '$lib/apis/code';

	import ModeSwitcher from '$lib/components/code/ModeSwitcher.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import {
		supportsDirPicker,
		pickAndSyncFolder,
		syncFileList,
		buildBaseline,
		pullChanges,
		downloadWorkspaceZip
	} from '$lib/utils/codeFolderSync';

	const i18n: any = getContext('i18n');

	let loaded = false;
	let enabled = false;
	let disabledReason = '';
	let models: CodeModel[] = [];
	let selectedModel = '';

	let sessions: any[] = [];
	let activeSession: string | null = null;

	// messageID -> { id, role, order, parts: Map<partId, part> }
	let messageMap = new Map<string, any>();
	let renderList: any[] = [];
	let busy = false; // an assistant turn is in flight
	let input = '';
	let msgCounter = 0;

	// ── folder scoping: sessions live in a top-level folder of the sandbox
	// workspace ('' = the workspace root). opencode resolves a relative
	// `?directory=` against the workspace root and stamps the absolute path on
	// each session, so filtering only needs the root path + string compare.
	let workspaceRoot = '';
	let folders: string[] = [];
	let folder = localStorage.getItem('codeFolder') ?? '';
	let showFolderMenu = false;
	let newFolderName = '';
	let creatingFolder = false;

	const normPath = (p: string) => (p ?? '').replace(/\\/g, '/').replace(/\/+$/, '');

	const sessionFolder = (s: any): string | null => {
		const dir = normPath(s?.directory ?? '');
		if (!workspaceRoot || !dir) return '';
		if (dir === workspaceRoot) return '';
		if (dir.startsWith(workspaceRoot + '/')) return dir.slice(workspaceRoot.length + 1);
		return null; // outside the workspace — never shown
	};

	$: visibleSessions = sessions.filter((s) => sessionFolder(s) === folder);

	const loadWorkspace = async () => {
		try {
			const paths = await getWorkspacePaths(localStorage.token);
			workspaceRoot = normPath(paths?.directory ?? '');
			const entries = await listWorkspaceEntries(localStorage.token);
			folders = (entries ?? [])
				.filter((e: any) => e?.type === 'directory' && !String(e?.name ?? '').startsWith('.'))
				.map((e: any) => e.name)
				.sort();
			if (folder && !folders.includes(folder)) selectFolder('');
		} catch (e) {
			// folder picker degrades to "workspace root" only
			console.error('workspace listing failed', e);
		}
	};

	const selectFolder = (f: string) => {
		folder = f;
		localStorage.setItem('codeFolder', f);
		showFolderMenu = false;
		activeSession = null;
		messageMap = new Map();
		rebuild();
	};

	const onCreateFolder = async () => {
		const name = newFolderName.trim();
		if (!name || creatingFolder) return;
		creatingFolder = true;
		try {
			await createWorkspaceFolder(localStorage.token, name);
			newFolderName = '';
			await loadWorkspace();
			selectFolder(name);
		} catch (e: any) {
			toast.error(e?.detail || $i18n.t('Could not create folder.'));
		} finally {
			creatingFolder = false;
		}
	};

	// ── open a LOCAL folder (Claude-Code-style): mirror its files into the
	// sandbox, then write the agent's changes back to it (Chrome/Edge). Other
	// browsers fall back to import-only + "download a copy".
	let dirInput: HTMLInputElement;
	let importing = false;
	// folderName -> { handle, baseline }: presence enables two-way write-back.
	const folderSync = new Map<string, { handle: any; baseline: Map<string, number> }>();
	let syncingBack = false;

	const afterImport = async (folderName: string, handle: any, count: number) => {
		await loadWorkspace();
		selectFolder(folderName);
		const baseline = new Map<string, number>();
		try {
			await buildBaseline(localStorage.token, folderName, baseline);
		} catch {
			/* baseline empty → first sync writes everything back, still correct */
		}
		if (handle) folderSync.set(folderName, { handle, baseline });
		toast.success(
			$i18n.t('Imported {{count}} files from “{{name}}”', { count, name: folderName })
		);
	};

	const openLocalFolder = async () => {
		showFolderMenu = false;
		if (importing) return;
		if (!supportsDirPicker()) {
			dirInput?.click();
			return;
		}
		importing = true;
		try {
			const { folderName, handle, count } = await pickAndSyncFolder(localStorage.token);
			await afterImport(folderName, handle, count);
		} catch (e: any) {
			if (e?.name !== 'AbortError')
				toast.error(e?.detail || e?.message || $i18n.t('Could not open folder.'));
		} finally {
			importing = false;
		}
	};

	const onDirInput = async (e: Event) => {
		const fl = (e.target as HTMLInputElement).files;
		(e.target as HTMLInputElement).value = '';
		if (!fl || !fl.length) return;
		importing = true;
		try {
			const { folderName, count } = await syncFileList(localStorage.token, fl);
			await afterImport(folderName, null, count);
		} catch (e: any) {
			toast.error(e?.detail || e?.message || $i18n.t('Could not import folder.'));
		} finally {
			importing = false;
		}
	};

	// after each agent turn, mirror changed files back to the local folder
	const syncBack = async () => {
		const ent = folder ? folderSync.get(folder) : null;
		if (!ent || syncingBack) return;
		syncingBack = true;
		try {
			const n = await pullChanges(localStorage.token, folder, ent.handle, ent.baseline);
			if (n) toast.success($i18n.t('Synced {{count}} file(s) back to your folder', { count: n }));
		} catch (e) {
			console.error('write-back failed', e);
		} finally {
			syncingBack = false;
		}
	};

	$: greeting = $i18n.t("What's up next, {{name}}?", {
		name: ($user?.name || '').trim().split(' ')[0] || $i18n.t('there')
	});

	let evController: AbortController | null = null;
	let scrollEl: HTMLDivElement;

	const md = (text: string) => DOMPurify.sanitize(marked.parse(text ?? '') as string);

	const rebuild = () => {
		renderList = [...messageMap.values()].sort((a, b) => a.order - b.order);
	};

	const scrollToBottom = async () => {
		await tick();
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
	};

	const upsertMessageInfo = (info: any) => {
		if (!info?.id) return;
		const ex = messageMap.get(info.id);
		if (ex) {
			ex.role = info.role ?? ex.role;
		} else {
			messageMap.set(info.id, {
				id: info.id,
				role: info.role ?? 'assistant',
				order: msgCounter++,
				parts: new Map()
			});
		}
	};

	const upsertPart = (part: any) => {
		if (!part?.messageID || !part?.id) return;
		let m = messageMap.get(part.messageID);
		if (!m) {
			m = {
				id: part.messageID,
				role: part.role ?? 'assistant',
				order: msgCounter++,
				parts: new Map()
			};
			messageMap.set(part.messageID, m);
		}
		m.parts.set(part.id, part);
	};

	const onEvent = (ev: any) => {
		const t = ev?.type;
		const p = ev?.properties ?? {};
		if (p.sessionID && activeSession && p.sessionID !== activeSession) return;
		if (t === 'message.updated') upsertMessageInfo(p.info);
		else if (t === 'message.part.updated') upsertPart(p.part);
		else if (t === 'session.idle') { busy = false; void syncBack(); }
		else if (t === 'session.error') {
			busy = false;
			toast.error(p?.error?.message || $i18n.t('The agent hit an error.'));
		} else return;
		rebuild();
		scrollToBottom();
	};

	const startEventStream = () => {
		evController?.abort();
		evController = new AbortController();
		subscribeEvents(localStorage.token, onEvent, evController.signal).catch((e) => {
			if (evController && !evController.signal.aborted) console.error('event stream', e);
		});
	};

	const loadSessions = async () => {
		try {
			const list = await listSessions(localStorage.token);
			sessions = Array.isArray(list) ? list : (list?.data ?? []);
		} catch (e: any) {
			toast.error(e?.detail || $i18n.t('Could not load Code sessions.'));
		}
	};

	const openSession = async (id: string) => {
		activeSession = id;
		messageMap = new Map();
		msgCounter = 0;
		busy = false;
		try {
			const msgs = await getMessages(localStorage.token, id);
			for (const m of msgs ?? []) {
				upsertMessageInfo(m.info ?? m);
				for (const part of m.parts ?? []) upsertPart(part);
			}
			rebuild();
			scrollToBottom();
		} catch (e: any) {
			toast.error(e?.detail || $i18n.t('Could not open session.'));
		}
	};

	const newSession = async () => {
		try {
			const s = await createSession(localStorage.token, $i18n.t('Untitled'), folder);
			await loadSessions();
			await openSession(s.id);
		} catch (e: any) {
			toast.error(e?.detail || $i18n.t('Could not create session.'));
		}
	};

	const removeSession = async (id: string) => {
		await deleteSession(localStorage.token, id);
		if (activeSession === id) {
			activeSession = null;
			messageMap = new Map();
			rebuild();
		}
		await loadSessions();
	};

	const submit = async () => {
		const text = input.trim();
		if (!text || busy) return;
		if (!activeSession) {
			await newSession();
			if (!activeSession) return;
		}
		input = '';
		busy = true;
		try {
			await sendPrompt(localStorage.token, activeSession, {
				providerID: 'kyberrouter',
				modelID: selectedModel,
				text
			});
		} catch (e: any) {
			busy = false;
			toast.error(e?.detail || $i18n.t('Could not send your message.'));
		}
	};

	const stop = async () => {
		if (activeSession) await abortSession(localStorage.token, activeSession);
		busy = false;
	};

	const onKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	};

	const toolLabel = (part: any) => {
		const st = part?.state?.status ?? '';
		const name = part?.tool ?? 'tool';
		let arg = '';
		try {
			const inp = part?.state?.input ?? {};
			arg = inp.filePath || inp.pattern || inp.command || inp.path || '';
		} catch {
			/* */
		}
		return { name, st, arg: String(arg).slice(0, 80) };
	};

	onMount(async () => {
		const cfg = await getCodeConfig(localStorage.token);
		enabled = !!cfg?.enabled;
		if (!enabled) {
			disabledReason = cfg?.reason || 'disabled';
			loaded = true;
			return;
		}
		models = cfg.models ?? [];
		selectedModel = models[0]?.id ?? '';
		await loadWorkspace();
		await loadSessions();
		const latest = sessions.find((s) => sessionFolder(s) === folder);
		if (latest) await openSession(latest.id);
		startEventStream();
		loaded = true;
	});

	onDestroy(() => evController?.abort());
</script>

<svelte:head><title>{$i18n.t('Coding')} • {$config?.name ?? 'Open WebUI'}</title></svelte:head>

{#if loaded}
	<div class="flex flex-col w-full h-screen max-h-[100dvh] max-w-full">
		<!-- top bar: Chat/Code switcher pinned to the far left (the chat sidebar
		     is not rendered on /code, so this is the true top-left corner) -->
		<nav class="px-2.5 pt-1.5 pb-1 w-full flex items-center">
			<div class="flex-none"><ModeSwitcher /></div>
			<div class="flex-1" />
		</nav>

		{#if !enabled}
			<div class="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
				<div class="text-lg font-medium">{$i18n.t('Code mode is unavailable')}</div>
				<div class="text-sm text-gray-500 max-w-md">
					{#if disabledReason === 'tier'}
						{$i18n.t('Code mode requires a higher subscription tier.')}
					{:else if disabledReason === 'unlinked'}
						{$i18n.t('Your account is not linked to a wallet yet.')}
					{:else}
						{$i18n.t('Code mode is not enabled on this server.')}
					{/if}
				</div>
				<button class="mt-2 text-sm underline" on:click={() => goto('/')}>
					{$i18n.t('Back to Chat')}
				</button>
			</div>
		{:else}
			<div class="flex-1 flex min-h-0">
				<!-- session list -->
				<div
					class="hidden md:flex flex-col w-60 flex-none border-r border-gray-50 dark:border-gray-850 px-2.5 py-3 gap-0.5 overflow-y-auto"
				>
					<button
						class="w-full flex items-center gap-2 px-3 py-2 mb-3 rounded-lg text-sm font-medium {activeSession ===
						null
							? 'bg-gray-100 dark:bg-gray-850'
							: 'hover:bg-gray-100 dark:hover:bg-gray-850'} transition"
						on:click={() => {
							activeSession = null;
							messageMap = new Map();
							rebuild();
						}}
					>
						<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6">
							<path d="M10 4.5v11M4.5 10h11" stroke-linecap="round" />
						</svg>
						{$i18n.t('New session')}
					</button>

					<div class="px-2 pb-1 text-xs font-medium text-gray-400 dark:text-gray-500">
						{$i18n.t('Recents')}
					</div>
					{#if visibleSessions.length === 0}
						<div class="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-600">
							{$i18n.t('No projects yet')}
						</div>
					{/if}
					{#each visibleSessions as s (s.id)}
						<div
							class="group flex items-center rounded-lg text-sm {activeSession === s.id
								? 'bg-gray-100 dark:bg-gray-850'
								: 'hover:bg-gray-50 dark:hover:bg-gray-900'}"
						>
							<button
								class="flex-1 flex items-center gap-2 text-left px-3 py-2 truncate"
								on:click={() => openSession(s.id)}
							>
								<span
									class="size-1.5 rounded-full flex-none {activeSession === s.id
										? 'bg-gray-500'
										: 'bg-gray-300 dark:bg-gray-700'}"
								/>
								<span class="truncate">{s.title || $i18n.t('Untitled')}</span>
							</button>
							<button
								class="opacity-0 group-hover:opacity-100 px-2 text-gray-400 hover:text-red-500 transition"
								on:click={() => removeSession(s.id)}
								title={$i18n.t('Delete')}>×</button
							>
						</div>
					{/each}
				</div>

				<!-- main -->
				<div class="flex-1 flex flex-col min-w-0">
					<div bind:this={scrollEl} class="flex-1 overflow-y-auto">
						{#if !activeSession}
							<!-- home / empty state -->
							<div class="h-full flex flex-col items-center justify-center px-6 text-center">
								<svg
									class="size-7 text-gray-800 dark:text-gray-200 mb-3"
									viewBox="0 0 24 24"
									fill="currentColor"
								>
									<path
										d="M12 2c.3 3.6 1.4 5.6 3 7.2 1.6 1.6 3.6 2.7 7.2 3-3.6.3-5.6 1.4-7.2 3-1.6 1.6-2.7 3.6-3 7.2-.3-3.6-1.4-5.6-3-7.2-1.6-1.6-3.6-2.7-7.2-3 3.6-.3 5.6-1.4 7.2-3C10.6 7.6 11.7 5.6 12 2z"
									/>
								</svg>
								<h1 class="text-2xl md:text-[28px] font-semibold text-gray-800 dark:text-gray-100">
									{greeting}
								</h1>
								<p class="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-md">
									{$i18n.t(
										'Describe a task and the agent reads, writes and edits files in your sandbox workspace.'
									)}
								</p>
							</div>
						{:else}
							<div class="max-w-3xl mx-auto px-4 md:px-8 py-6 flex flex-col gap-4">
								{#each renderList as m (m.id)}
									<div
										class="flex flex-col gap-1.5 {m.role === 'user' ? 'items-end' : 'items-start'}"
									>
										{#each [...m.parts.values()] as part (part.id)}
											{#if part.type === 'text' && part.text}
												<div
													class="rounded-2xl px-4 py-2.5 max-w-[90%] {m.role === 'user'
														? 'bg-gray-100 dark:bg-gray-850'
														: ''} prose prose-sm dark:prose-invert break-words"
												>
													{@html md(part.text)}
												</div>
											{:else if part.type === 'tool'}
												{@const tl = toolLabel(part)}
												<div
													class="text-xs font-mono flex items-center gap-2 text-gray-500 px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-850"
												>
													<span
														class="inline-block w-1.5 h-1.5 rounded-full {tl.st === 'completed'
															? 'bg-green-500'
															: tl.st === 'error'
																? 'bg-red-500'
																: 'bg-yellow-400 animate-pulse'}"
													/>
													<span class="font-semibold">{tl.name}</span>
													{#if tl.arg}<span class="truncate text-gray-400">{tl.arg}</span>{/if}
												</div>
											{/if}
										{/each}
									</div>
								{/each}
								{#if busy}
									<div class="text-xs text-gray-400 flex items-center gap-2 px-2">
										<span class="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
										{$i18n.t('Working…')}
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<!-- composer -->
					<div class="px-4 md:px-8 pb-5 pt-2">
						<div class="max-w-3xl mx-auto">
							<div
								class="rounded-[26px] border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm focus-within:border-gray-300 dark:focus-within:border-gray-700 transition"
							>
								<!-- context chips: where the agent runs + which folder it works in -->
								<div class="flex items-center gap-1.5 px-3 pt-2.5 text-xs text-gray-500 dark:text-gray-400">
									<Tooltip content={$i18n.t('Your code runs in an isolated cloud sandbox')}>
										<span
											class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-850"
										>
											<svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
												<rect x="2" y="3" width="12" height="9" rx="1.5" /><path d="M6 14h4" stroke-linecap="round" />
											</svg>
											{$i18n.t('Sandbox')}
										</span>
									</Tooltip>

									<div class="relative">
										<button
											class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-850 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
											on:click={() => (showFolderMenu = !showFolderMenu)}
											title={$i18n.t('Choose the folder the agent works in')}
										>
											<svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
												<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
											</svg>
											{folder || $i18n.t('Workspace root')}
											<svg class="size-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4">
												<path d="M3 4.5 6 7.5l3-3" stroke-linecap="round" stroke-linejoin="round" />
											</svg>
										</button>

										{#if showFolderMenu}
											<!-- click-away backdrop -->
											<button
												class="fixed inset-0 z-40 cursor-default"
												aria-label="close"
												on:click={() => (showFolderMenu = false)}
											/>
											<div
												class="absolute bottom-full left-0 mb-1.5 z-50 w-60 max-h-72 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1 text-sm"
											>
												<button
													class="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-850 {folder === ''
														? 'font-medium'
														: ''}"
													on:click={() => selectFolder('')}
												>
													{$i18n.t('Workspace root')}
												</button>
												{#each folders as f (f)}
													<button
														class="w-full text-left px-3 py-1.5 truncate hover:bg-gray-50 dark:hover:bg-gray-850 {folder === f
															? 'font-medium'
															: ''}"
														on:click={() => selectFolder(f)}
													>
														{f}{#if folderSync.has(f)}<span class="text-green-500" title={$i18n.t('Synced with your local folder')}> ⇄</span>{/if}
													</button>
												{/each}
												<div class="border-t border-gray-100 dark:border-gray-850 mt-1 pt-1">
													<!-- open a LOCAL folder (primary, Claude-Code style) -->
													<button
														class="w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-850 disabled:opacity-50"
														on:click={openLocalFolder}
														disabled={importing}
													>
														<svg class="size-3.5 flex-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
															<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
															<path d="M8 8v3M6.5 9.5h3" stroke-linecap="round" />
														</svg>
														{importing ? $i18n.t('Importing…') : $i18n.t('Open local folder…')}
													</button>
													{#if folder}
														<button
															class="w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-850"
															on:click={() => {
																showFolderMenu = false;
																downloadWorkspaceZip(localStorage.token).catch(() =>
																	toast.error($i18n.t('Download failed'))
																);
															}}
														>
															<svg class="size-3.5 flex-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3">
																<path d="M8 2v8m0 0L5 7m3 3 3-3M3 13h10" stroke-linecap="round" stroke-linejoin="round" />
															</svg>
															{$i18n.t('Download a copy (.zip)')}
														</button>
													{/if}
												</div>
												<div class="border-t border-gray-100 dark:border-gray-850 mt-1 pt-1 px-2 pb-1">
													<input
														bind:value={newFolderName}
														placeholder={$i18n.t('New empty folder…')}
														class="w-full bg-gray-50 dark:bg-gray-850 rounded-lg px-2 py-1 text-xs outline-none"
														on:keydown={(e) => e.key === 'Enter' && onCreateFolder()}
													/>
												</div>
											</div>
										{/if}
										<!-- hidden fallback picker for browsers without File System Access -->
										<input
											type="file"
											webkitdirectory
											class="hidden"
											bind:this={dirInput}
											on:change={onDirInput}
										/>
									</div>
								</div>

								<textarea
									bind:value={input}
									on:keydown={onKeydown}
									rows="1"
									placeholder={$i18n.t('Describe a task or ask a question')}
									class="w-full resize-none bg-transparent outline-none text-sm px-4 py-3 max-h-48"
								/>

								<!-- bottom row: model + send -->
								<div class="flex items-center gap-2 px-3 pb-2.5">
									<div
										class="relative inline-flex items-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 transition"
									>
										<!-- bg-none kills the global app.css `select` chevron background-image,
										     which would otherwise double up with the custom arrow below -->
										<select
											bind:value={selectedModel}
											class="appearance-none bg-none bg-transparent outline-none text-xs text-gray-600 dark:text-gray-300 pl-2.5 pr-6 py-1.5 cursor-pointer"
										>
											{#each models as mdl}
												<option value={mdl.id}>{mdl.name}</option>
											{/each}
										</select>
										<svg
											class="size-3 text-gray-400 absolute right-2 pointer-events-none"
											viewBox="0 0 12 12"
											fill="none"
											stroke="currentColor"
											stroke-width="1.4"
										>
											<path d="M3 4.5 6 7.5l3-3" stroke-linecap="round" stroke-linejoin="round" />
										</svg>
									</div>

									<div class="flex-1" />

									{#if busy}
										<button
											class="flex-none size-8 flex items-center justify-center rounded-full bg-gray-200 dark:bg-gray-800 hover:opacity-90 transition"
											title={$i18n.t('Stop')}
											on:click={stop}
										>
											<svg class="size-3.5" viewBox="0 0 14 14" fill="currentColor">
												<rect x="3" y="3" width="8" height="8" rx="1.5" />
											</svg>
										</button>
									{:else}
										<button
											class="flex-none size-8 flex items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black disabled:opacity-30 transition"
											title={$i18n.t('Send')}
											disabled={!input.trim()}
											on:click={submit}
										>
											<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
												<path d="M10 15.5v-11M5 9.5l5-5 5 5" stroke-linecap="round" stroke-linejoin="round" />
											</svg>
										</button>
									{/if}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
