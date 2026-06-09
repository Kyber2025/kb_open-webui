<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { models } from '$lib/stores';
	import {
		getGuestConfig,
		updateGuestConfig,
		getGuestBlacklist,
		addGuestBlacklist,
		removeGuestBlacklist
	} from '$lib/apis/guest';

	const i18n = getContext('i18n');

	let loaded = false;
	let saving = false;

	let enabled = false;
	let dailyLimit = 5;
	// Effective per-model "allowed" toggles (checked = guests may use it).
	let allowedSet: Record<string, boolean> = {};

	let blacklist: Array<{ ip: string; reason?: string; created_at: number }> = [];
	let newIp = '';
	let newReason = '';

	$: chatModels = ($models ?? []).filter((m) => m?.id && m?.id !== 'arena');

	const initAllowed = (allowedIds: string[], blockedIds: string[]) => {
		const allowed = allowedIds ?? [];
		const blocked = blockedIds ?? [];
		const next: Record<string, boolean> = {};
		for (const m of chatModels) {
			// allow-list non-empty -> only those; empty -> all except block-list
			next[m.id] = allowed.length ? allowed.includes(m.id) : !blocked.includes(m.id);
		}
		allowedSet = next;
	};

	const load = async () => {
		try {
			const cfg = await getGuestConfig(localStorage.token);
			enabled = !!cfg.ENABLE_GUEST_ACCESS;
			dailyLimit = cfg.GUEST_DAILY_LIMIT ?? 5;
			initAllowed(cfg.GUEST_ALLOWED_MODEL_IDS, cfg.GUEST_BLOCKED_MODEL_IDS);
			blacklist = await getGuestBlacklist(localStorage.token);
		} catch (e) {
			toast.error(`${e}`);
		}
		loaded = true;
	};

	const save = async () => {
		saving = true;
		try {
			const allowedIds = chatModels.filter((m) => allowedSet[m.id]).map((m) => m.id);
			// If every model is allowed, store [] (meaning "all") to stay future-proof
			// as new models are added; otherwise store the explicit allow-list.
			const allModelsAllowed = allowedIds.length === chatModels.length;
			await updateGuestConfig(localStorage.token, {
				ENABLE_GUEST_ACCESS: enabled,
				GUEST_DAILY_LIMIT: Math.max(0, Number(dailyLimit) || 0),
				GUEST_ALLOWED_MODEL_IDS: allModelsAllowed ? [] : allowedIds,
				GUEST_BLOCKED_MODEL_IDS: allModelsAllowed
					? chatModels.filter((m) => !allowedSet[m.id]).map((m) => m.id)
					: []
			});
			toast.success($i18n.t('Saved'));
		} catch (e) {
			toast.error(`${e}`);
		}
		saving = false;
	};

	const addIp = async () => {
		const ip = newIp.trim();
		if (!ip) return;
		try {
			await addGuestBlacklist(localStorage.token, ip, newReason.trim());
			newIp = '';
			newReason = '';
			blacklist = await getGuestBlacklist(localStorage.token);
		} catch (e) {
			toast.error(`${e}`);
		}
	};

	const removeIp = async (ip: string) => {
		try {
			await removeGuestBlacklist(localStorage.token, ip);
			blacklist = blacklist.filter((b) => b.ip !== ip);
		} catch (e) {
			toast.error(`${e}`);
		}
	};

	const toggleAll = (val: boolean) => {
		const next: Record<string, boolean> = {};
		for (const m of chatModels) next[m.id] = val;
		allowedSet = next;
	};

	onMount(load);
</script>

{#if loaded}
	<div class="px-4 md:px-8 py-6 max-w-4xl mx-auto w-full flex flex-col gap-5">
		<div>
			<div class="text-lg font-medium">{$i18n.t('Guest Access')}</div>
			<div class="text-xs text-gray-500">
				{$i18n.t(
					'Let logged-out visitors use the chat a limited number of times per day (by IP and device) before they must sign in.'
				)}
			</div>
		</div>

		<!-- Enable + daily limit -->
		<div class="flex items-center justify-between">
			<div class="text-sm font-medium">{$i18n.t('Enable Guest Access')}</div>
			<label class="relative inline-flex items-center cursor-pointer">
				<input type="checkbox" bind:checked={enabled} class="sr-only peer" />
				<div
					class="w-10 h-5 bg-gray-200 dark:bg-gray-700 peer-checked:bg-black dark:peer-checked:bg-white rounded-full peer transition-all after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white dark:after:bg-black after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5"
				></div>
			</label>
		</div>

		<div class="flex items-center justify-between">
			<div class="text-sm font-medium">{$i18n.t('Daily message limit per guest')}</div>
			<input
				type="number"
				min="0"
				bind:value={dailyLimit}
				class="w-24 text-sm bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 outline-none"
			/>
		</div>

		<!-- Allowed models -->
		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between">
				<div class="text-sm font-medium">{$i18n.t('Models guests can use')}</div>
				<div class="flex gap-2 text-xs">
					<button class="underline" on:click={() => toggleAll(true)}>{$i18n.t('Select all')}</button>
					<button class="underline" on:click={() => toggleAll(false)}>{$i18n.t('Deselect all')}</button>
				</div>
			</div>
			<div
				class="max-h-60 overflow-y-auto border border-gray-100 dark:border-gray-800 rounded-lg p-2 flex flex-col gap-1"
			>
				{#each chatModels as m (m.id)}
					<label class="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
						<input type="checkbox" bind:checked={allowedSet[m.id]} />
						<span>{m.name ?? m.id}</span>
						<span class="text-xs text-gray-400">{m.id}</span>
					</label>
				{/each}
				{#if chatModels.length === 0}
					<div class="text-xs text-gray-400">{$i18n.t('No models available')}</div>
				{/if}
			</div>
		</div>

		<div class="flex justify-end">
			<button
				class="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg text-sm font-medium disabled:opacity-50"
				on:click={save}
				disabled={saving}
			>
				{saving ? $i18n.t('Saving...') : $i18n.t('Save')}
			</button>
		</div>

		<hr class="border-gray-100 dark:border-gray-800" />

		<!-- IP blacklist -->
		<div class="flex flex-col gap-2">
			<div class="text-sm font-medium">{$i18n.t('IP Blacklist')}</div>
			<div class="text-xs text-gray-500">
				{$i18n.t('Blacklisted IPs are blocked from guest access entirely.')}
			</div>
			<div class="flex gap-2">
				<input
					placeholder={$i18n.t('IP address')}
					bind:value={newIp}
					class="flex-1 text-sm bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 outline-none"
				/>
				<input
					placeholder={$i18n.t('Reason (optional)')}
					bind:value={newReason}
					class="flex-1 text-sm bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 outline-none"
				/>
				<button
					class="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm"
					on:click={addIp}>{$i18n.t('Add')}</button
				>
			</div>
			<div class="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
				{#each blacklist as b (b.ip)}
					<div class="flex items-center justify-between py-2 text-sm">
						<div class="flex flex-col">
							<span class="font-mono">{b.ip}</span>
							{#if b.reason}<span class="text-xs text-gray-400">{b.reason}</span>{/if}
						</div>
						<button class="text-red-500 text-xs" on:click={() => removeIp(b.ip)}
							>{$i18n.t('Remove')}</button
						>
					</div>
				{/each}
				{#if blacklist.length === 0}
					<div class="text-xs text-gray-400 py-2">{$i18n.t('No blacklisted IPs.')}</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
