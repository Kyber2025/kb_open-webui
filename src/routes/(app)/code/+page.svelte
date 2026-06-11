<script lang="ts">
	import { getContext, onMount, onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { toast } from 'svelte-sonner';

	import { config, mobile, showSidebar, user } from '$lib/stores';
	import {
		getCodeConfig,
		listSessions,
		createSession,
		deleteSession,
		getMessages,
		sendPrompt,
		abortSession,
		subscribeEvents,
		uploadProject,
		downloadProject,
		type CodeModel
	} from '$lib/apis/code';

	import ModeSwitcher from '$lib/components/code/ModeSwitcher.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Sidebar from '$lib/components/icons/Sidebar.svelte';

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

	let fileInput: HTMLInputElement;
	let transferring = false;

	const onUploadPick = async (e: Event) => {
		const f = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = '';
		if (!f) return;
		transferring = true;
		try {
			const r = await uploadProject(localStorage.token, f);
			toast.success($i18n.t('Uploaded {{count}} files', { count: r?.files ?? 0 }));
		} catch (err: any) {
			toast.error(err?.detail || $i18n.t('Upload failed'));
		} finally {
			transferring = false;
		}
	};

	const onDownload = async () => {
		transferring = true;
		try {
			await downloadProject(localStorage.token);
		} catch (err: any) {
			toast.error(err?.detail || $i18n.t('Download failed'));
		} finally {
			transferring = false;
		}
	};

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
		else if (t === 'session.idle') busy = false;
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
			const s = await createSession(localStorage.token, $i18n.t('Untitled'));
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
		await loadSessions();
		if (sessions.length) await openSession(sessions[0].id);
		startEventStream();
		loaded = true;
	});

	onDestroy(() => evController?.abort());
</script>

<svelte:head><title>{$i18n.t('Code')} • {$config?.name ?? 'Open WebUI'}</title></svelte:head>

{#if loaded}
	<div
		class="flex flex-col w-full h-screen max-h-[100dvh] transition-width duration-200 ease-in-out {$showSidebar
			? 'md:max-w-[calc(100%-var(--sidebar-width))]'
			: ''} max-w-full"
	>
		<!-- top bar: sidebar toggle + centered Chat/Code switcher -->
		<nav class="px-2.5 pt-1.5 pb-1 w-full flex items-center">
			<div class="flex-none flex items-center">
				{#if !$showSidebar || $mobile}
					<Tooltip content={$i18n.t('Open Sidebar')}>
						<button
							class="cursor-pointer p-1.5 flex rounded-xl hover:bg-gray-100 dark:hover:bg-gray-850 transition"
							on:click={() => showSidebar.set(!$showSidebar)}
						>
							<Sidebar class="size-5" />
						</button>
					</Tooltip>
				{/if}
			</div>
			<div class="flex-1 flex justify-center"><ModeSwitcher /></div>
			<div class="flex-none w-8" />
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
					class="hidden md:flex flex-col w-56 flex-none border-r border-gray-50 dark:border-gray-850 p-2 gap-1 overflow-y-auto"
				>
					<button
						class="w-full mb-1 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-850 hover:bg-gray-200 dark:hover:bg-gray-800 transition"
						on:click={newSession}
					>
						+ {$i18n.t('New project')}
					</button>
					<!-- project zip upload / download (workspace-level) -->
					<input
						type="file"
						accept=".zip,application/zip"
						class="hidden"
						bind:this={fileInput}
						on:change={onUploadPick}
					/>
					<div class="flex gap-1 mb-1">
						<button
							class="flex-1 px-2 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-850 transition disabled:opacity-40"
							on:click={() => fileInput?.click()}
							disabled={transferring}
							title={$i18n.t('Upload a .zip into the workspace')}
						>
							↑ {$i18n.t('Upload')}
						</button>
						<button
							class="flex-1 px-2 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-850 transition disabled:opacity-40"
							on:click={onDownload}
							disabled={transferring}
							title={$i18n.t('Download the workspace as a .zip')}
						>
							↓ {$i18n.t('Download')}
						</button>
					</div>
					{#each sessions as s (s.id)}
						<div
							class="group flex items-center rounded-lg text-sm {activeSession === s.id
								? 'bg-gray-100 dark:bg-gray-850'
								: 'hover:bg-gray-50 dark:hover:bg-gray-900'}"
						>
							<button
								class="flex-1 text-left px-3 py-2 truncate"
								on:click={() => openSession(s.id)}
							>
								{s.title || $i18n.t('Untitled')}
							</button>
							<button
								class="opacity-0 group-hover:opacity-100 px-2 text-gray-400 hover:text-red-500 transition"
								on:click={() => removeSession(s.id)}
								title={$i18n.t('Delete')}>×</button
							>
						</div>
					{/each}
				</div>

				<!-- conversation -->
				<div class="flex-1 flex flex-col min-w-0">
					<div bind:this={scrollEl} class="flex-1 overflow-y-auto px-4 md:px-8 py-4">
						<div class="max-w-3xl mx-auto flex flex-col gap-4">
							{#if !activeSession}
								<div class="text-center text-gray-500 mt-20">
									<div class="text-lg font-medium mb-1">{$i18n.t('Start coding')}</div>
									<div class="text-sm">
										{$i18n.t('Describe what you want to build and the agent edits files for you.')}
									</div>
								</div>
							{/if}
							{#each renderList as m (m.id)}
								<div class="flex flex-col gap-1.5 {m.role === 'user' ? 'items-end' : 'items-start'}">
									{#each [...m.parts.values()] as part (part.id)}
										{#if part.type === 'text' && part.text}
											<div
												class="rounded-2xl px-4 py-2 max-w-[90%] {m.role === 'user'
													? 'bg-gray-100 dark:bg-gray-850'
													: ''} prose prose-sm dark:prose-invert break-words"
											>
												{@html md(part.text)}
											</div>
										{:else if part.type === 'tool'}
											{@const tl = toolLabel(part)}
											<div
												class="text-xs font-mono flex items-center gap-2 text-gray-500 px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-900"
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
					</div>

					<!-- composer -->
					<div class="px-4 md:px-8 pb-4">
						<div class="max-w-3xl mx-auto">
							<div
								class="flex items-end gap-2 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2"
							>
								<select
									bind:value={selectedModel}
									class="flex-none text-xs bg-transparent outline-none text-gray-500 max-w-[8rem]"
								>
									{#each models as mdl}
										<option value={mdl.id}>{mdl.name}</option>
									{/each}
								</select>
								<textarea
									bind:value={input}
									on:keydown={onKeydown}
									rows="1"
									placeholder={$i18n.t('Ask the coding agent…')}
									class="flex-1 resize-none bg-transparent outline-none text-sm py-1 max-h-40"
								/>
								{#if busy}
									<button
										class="flex-none px-3 py-1.5 rounded-xl bg-gray-200 dark:bg-gray-800 text-sm"
										on:click={stop}>{$i18n.t('Stop')}</button
									>
								{:else}
									<button
										class="flex-none px-3 py-1.5 rounded-xl bg-black text-white dark:bg-white dark:text-black text-sm disabled:opacity-40"
										disabled={!input.trim()}
										on:click={submit}>{$i18n.t('Send')}</button
									>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
