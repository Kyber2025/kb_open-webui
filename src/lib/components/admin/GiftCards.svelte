<script>
	import { getContext, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	const i18n = getContext('i18n');

	import {
		getAdminTiers,
		generateGiftCards,
		getGiftCards,
		setGiftCardStatus,
		deleteGiftCard
	} from '$lib/apis/subscriptions';

	let loading = true;
	let generating = false;

	let tiers = [];
	let cards = [];
	let counts = { total: 0, available: 0, redeemed: 0, disabled: 0 };
	let statusFilter = 'all';

	// generation form
	let genTierId = '';
	let genCount = 10;
	let genDuration = null;
	let genNote = '';

	// most recent generated batch (for copy / export)
	let lastBatch = [];

	$: selectedTier = tiers.find((t) => t.id === genTierId) ?? null;

	const tierName = (id) => tiers.find((t) => t.id === id)?.name ?? id;

	const loadTiers = async () => {
		tiers = (await getAdminTiers(localStorage.token).catch(() => [])) ?? [];
		if (!genTierId) {
			const preferred = tiers.find((t) => (t.price_usd ?? 0) > 0) ?? tiers[0];
			genTierId = preferred?.id ?? '';
		}
	};

	const loadCards = async () => {
		const res = await getGiftCards(localStorage.token, statusFilter).catch(() => null);
		cards = res?.cards ?? [];
		counts = res?.counts ?? { total: 0, available: 0, redeemed: 0, disabled: 0 };
	};

	const reload = async () => {
		loading = true;
		await Promise.all([loadTiers(), loadCards()]);
		loading = false;
	};

	const generate = async () => {
		if (!genTierId) {
			toast.error($i18n.t('Select a plan first'));
			return;
		}
		const count = Number(genCount);
		if (!count || count < 1) {
			toast.error($i18n.t('Enter how many codes to generate'));
			return;
		}
		generating = true;
		try {
			const created = await generateGiftCards(localStorage.token, {
				tier_id: genTierId,
				count,
				duration_days: genDuration ? Number(genDuration) : null,
				note: genNote || null
			});
			lastBatch = created ?? [];
			toast.success($i18n.t('Generated {{count}} gift cards', { count: lastBatch.length }));
			await loadCards();
		} catch (e) {
			toast.error(`${e}`);
		} finally {
			generating = false;
		}
	};

	const copyCodes = async (list) => {
		try {
			await navigator.clipboard.writeText(list.map((c) => c.code).join('\n'));
			toast.success($i18n.t('Copied {{count}} codes', { count: list.length }));
		} catch (e) {
			toast.error($i18n.t('Failed to copy'));
		}
	};

	const downloadCsv = (list) => {
		const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
		const rows = list.map((c) =>
			[c.code, tierName(c.tier_id), c.duration_days, c.note ?? ''].map(esc).join(',')
		);
		const csv = ['code,plan,duration_days,note', ...rows].join('\n');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `gift-cards-${list[0]?.batch_id ?? 'export'}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const toggleEnabled = async (card) => {
		try {
			await setGiftCardStatus(localStorage.token, card.code, !card.enabled);
			await loadCards();
		} catch (e) {
			toast.error(`${e}`);
		}
	};

	const remove = async (card) => {
		if (!confirm($i18n.t('Delete gift card {{code}}?', { code: card.code }))) return;
		try {
			await deleteGiftCard(localStorage.token, card.code);
			toast.success($i18n.t('Gift card deleted'));
			lastBatch = lastBatch.filter((c) => c.code !== card.code);
			await loadCards();
		} catch (e) {
			toast.error(`${e}`);
		}
	};

	const cardState = (card) =>
		card.redeemed_by ? 'redeemed' : card.enabled ? 'available' : 'disabled';

	const stateBadgeClass = {
		available: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
		redeemed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
		disabled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
	};

	const fmtDate = (secs) => (secs ? new Date(secs * 1000).toLocaleDateString() : '');

	onMount(reload);
</script>

<div class="px-4 md:px-8 py-6 max-w-4xl mx-auto w-full border-t border-gray-100 dark:border-gray-800">
	<div class="text-lg font-medium mb-1">{$i18n.t('Gift Cards')}</div>
	<div class="text-xs text-gray-500 mb-4">
		{$i18n.t(
			'Generate single-use redemption codes that activate a subscription plan. Share a code with a user; they redeem it on the Subscription page.'
		)}
	</div>

	<!-- generation form -->
	<div class="rounded-2xl border border-gray-100 dark:border-gray-800 p-4 mb-4">
		<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
			<label class="flex flex-col gap-1 text-xs text-gray-500">
				{$i18n.t('Plan')}
				<select
					class="px-2 py-1.5 rounded-md bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 text-sm text-black dark:text-white outline-none"
					bind:value={genTierId}
				>
					{#each tiers as t (t.id)}
						<option value={t.id}>{t.name}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1 text-xs text-gray-500">
				{$i18n.t('Quantity')}
				<input
					type="number"
					min="1"
					max="1000"
					class="px-2 py-1.5 rounded-md bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 text-sm text-black dark:text-white outline-none"
					bind:value={genCount}
				/>
			</label>
			<label class="flex flex-col gap-1 text-xs text-gray-500">
				{$i18n.t('Duration (days)')}
				<input
					type="number"
					min="1"
					placeholder={selectedTier ? `${selectedTier.duration_days}` : ''}
					class="px-2 py-1.5 rounded-md bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 text-sm text-black dark:text-white outline-none"
					bind:value={genDuration}
				/>
			</label>
			<label class="flex flex-col gap-1 text-xs text-gray-500">
				{$i18n.t('Note (optional)')}
				<input
					class="px-2 py-1.5 rounded-md bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 text-sm text-black dark:text-white outline-none"
					placeholder={$i18n.t('e.g. promo')}
					bind:value={genNote}
				/>
			</label>
		</div>
		<div class="flex items-center justify-between">
			<div class="text-xs text-gray-400">
				{#if selectedTier}
					{$i18n.t('Each code grants {{name}} for {{days}} days.', {
						name: selectedTier.name,
						days: genDuration ? Number(genDuration) : selectedTier.duration_days
					})}
				{/if}
			</div>
			<button
				class="px-4 py-1.5 rounded-lg bg-black text-white dark:bg-white dark:text-black text-sm font-medium disabled:opacity-50"
				on:click={generate}
				disabled={generating || !genTierId}
			>
				{generating ? $i18n.t('Generating…') : $i18n.t('Generate codes')}
			</button>
		</div>
	</div>

	<!-- last generated batch -->
	{#if lastBatch.length}
		<div class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 p-4 mb-4">
			<div class="flex items-center justify-between mb-2">
				<div class="text-sm font-medium">
					{$i18n.t('Newly generated')}
					<span class="text-gray-400">({lastBatch.length})</span>
				</div>
				<div class="flex gap-2">
					<button
						class="px-3 py-1 rounded-lg bg-gray-200 dark:bg-gray-700 text-xs font-medium"
						on:click={() => copyCodes(lastBatch)}
					>
						{$i18n.t('Copy all')}
					</button>
					<button
						class="px-3 py-1 rounded-lg bg-gray-200 dark:bg-gray-700 text-xs font-medium"
						on:click={() => downloadCsv(lastBatch)}
					>
						{$i18n.t('Download CSV')}
					</button>
				</div>
			</div>
			<div
				class="max-h-48 overflow-y-auto font-mono text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1"
			>
				{#each lastBatch as c (c.code)}
					<div class="truncate select-all">{c.code}</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- summary + filter -->
	<div class="flex items-center justify-between mb-2 flex-wrap gap-2">
		<div class="flex gap-3 text-xs text-gray-500">
			<span>{$i18n.t('Total')}: <span class="font-semibold text-black dark:text-white">{counts.total}</span></span>
			<span>{$i18n.t('Available')}: <span class="font-semibold text-black dark:text-white">{counts.available}</span></span>
			<span>{$i18n.t('Redeemed')}: <span class="font-semibold text-black dark:text-white">{counts.redeemed}</span></span>
			<span>{$i18n.t('Disabled')}: <span class="font-semibold text-black dark:text-white">{counts.disabled}</span></span>
		</div>
		<select
			class="px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 text-xs outline-none"
			bind:value={statusFilter}
			on:change={loadCards}
		>
			<option value="all">{$i18n.t('All')}</option>
			<option value="available">{$i18n.t('Available')}</option>
			<option value="redeemed">{$i18n.t('Redeemed')}</option>
			<option value="disabled">{$i18n.t('Disabled')}</option>
		</select>
	</div>

	<!-- list -->
	{#if loading}
		<div class="text-sm text-gray-500 py-8 text-center">{$i18n.t('Loading…')}</div>
	{:else if cards.length === 0}
		<div class="text-center text-sm text-gray-500 py-10">
			{$i18n.t('No gift cards yet. Generate a batch above.')}
		</div>
	{:else}
		<div class="rounded-2xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
			{#each cards as card (card.code)}
				{@const st = cardState(card)}
				<div class="flex items-center justify-between gap-2 p-3 text-sm">
					<div class="min-w-0">
						<div class="font-mono truncate select-all">{card.code}</div>
						<div class="text-xs text-gray-500 truncate">
							{tierName(card.tier_id)} · {$i18n.t('{{days}} days', { days: card.duration_days })}
							{#if card.note}· {card.note}{/if}
							{#if card.redeemed_by}
								· <span title={card.redeemed_by}>{$i18n.t('redeemed {{date}}', { date: fmtDate(card.redeemed_at) })}</span>
							{/if}
						</div>
					</div>
					<div class="flex items-center gap-2 shrink-0">
						<span class="px-2 py-0.5 rounded-full text-[11px] font-medium {stateBadgeClass[st]}">
							{$i18n.t(st)}
						</span>
						{#if !card.redeemed_by}
							<button
								class="text-xs text-gray-500 hover:text-black dark:hover:text-white"
								on:click={() => toggleEnabled(card)}
							>
								{card.enabled ? $i18n.t('Disable') : $i18n.t('Enable')}
							</button>
						{/if}
						<button class="text-xs text-red-500 hover:underline" on:click={() => remove(card)}>
							{$i18n.t('Delete')}
						</button>
					</div>
				</div>
			{/each}
		</div>
		{#if cards.length >= 500}
			<div class="text-center text-xs text-gray-400 py-2">
				{$i18n.t('Showing the 500 most recent. Filter to narrow the list.')}
			</div>
		{/if}
	{/if}
</div>
