<script>
	import { getContext, onDestroy, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	const i18n = getContext('i18n');

	import { showSidebar } from '$lib/stores';
	import Sidebar from '$lib/components/icons/Sidebar.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';

	import {
		getSubscriptionTiers,
		getSubscriptionChains,
		getMySubscription,
		subscribe,
		getSubscriptionOrder,
		redeemGiftCard
	} from '$lib/apis/subscriptions';
	import { getKyberUsageLimits } from '$lib/apis/kyber';

	let loaded = false;
	/** @type {any[]} */
	let tiers = [];
	let chains = [];
	let me = null;
	// Live 5h/weekly windows from KyberRouter ({tp5h,tpw:{used,limit,resetAt}}).
	// Null when the account is unlinked — the current-plan card then shows the
	// tier caps without a live fill.
	/** @type {any} */
	let usage = null;
	/** @type {string | null} */
	let selectedTierId = null;

	// gift card redemption
	let redeemCode = '';
	let redeeming = false;

	// checkout state
	let checkoutTier = null;
	let selectedChainId = '';
	let order = null;
	let orderStatus = '';
	let creating = false;
	let paid = false;

	let pollTimer = null;
	let tickTimer = null;
	let now = Math.floor(Date.now() / 1000);

	const loadState = async () => {
		me = await getMySubscription(localStorage.token).catch(() => null);
		const limits = await getKyberUsageLimits(localStorage.token).catch(() => null);
		usage = limits?.linked ? limits : null;
	};

	const reload = async () => {
		[tiers, chains] = await Promise.all([
			getSubscriptionTiers(localStorage.token).catch(() => []),
			getSubscriptionChains(localStorage.token).catch(() => [])
		]);
		await loadState();
	};

	const redeem = async () => {
		const code = redeemCode.trim();
		if (!code || redeeming) return;
		redeeming = true;
		try {
			const res = await redeemGiftCard(localStorage.token, code);
			toast.success(
				$i18n.t('Gift card redeemed — your {{name}} plan is now active!', {
					name: res?.tier_name ?? ''
				})
			);
			redeemCode = '';
			await loadState();
		} catch (e) {
			toast.error(`${e}`);
		} finally {
			redeeming = false;
		}
	};

	// Compact token count: 40000 -> "40K", 3000000 -> "3M".
	const formatTokens = (n) => {
		const v = Number(n);
		if (!isFinite(v)) return `${n}`;
		if (v >= 1_000_000) {
			const m = v / 1_000_000;
			return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
		}
		if (v >= 1_000) {
			const k = v / 1_000;
			return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
		}
		return `${v}`;
	};

	// A token cap is "unlimited" when null/undefined or 0 (KyberRouter convention).
	const isUnlimitedCap = (cap) => cap === null || cap === undefined || Number(cap) === 0;

	// resetAt is epoch ms, same clock the desktop usage ring compares against.
	const fmtReset = (/** @type {number | null | undefined} */ resetAt, /** @type {number} */ nowSec) => {
		if (!resetAt) return '';
		const ms = resetAt - nowSec * 1000;
		if (ms <= 0) return $i18n.t('Resets soon');
		const totalMin = Math.round(ms / 60000);
		if (totalMin < 60) return $i18n.t('Resets in {{minutes}}m', { minutes: totalMin });
		if (totalMin < 48 * 60) {
			const h = Math.floor(totalMin / 60);
			const m = totalMin % 60;
			return $i18n.t('Resets in {{hours}}h {{minutes}}m', { hours: h, minutes: m });
		}
		const d = new Date(resetAt);
		return $i18n.t('Resets on {{date}}', { date: `${d.getMonth() + 1}/${d.getDate()}` });
	};

	// One usage row's numbers: live window when linked, tier cap as fallback.
	const winView = (/** @type {any} */ win, /** @type {any} */ capFallback) => {
		const limit = Number(win?.limit) > 0 ? Number(win.limit) : Number(capFallback) || 0;
		const used = Number(win?.used) || 0;
		const unlimited = limit <= 0;
		const pct = unlimited ? 0 : Math.min(100, (used / limit) * 100);
		return { limit, used, unlimited, pct };
	};

	// Plan-card mini bars: each cap relative to the largest finite cap in the
	// lineup, so the row reads as a scale (Free a sliver, Ultra full width).
	$: max5h = Math.max(1, ...tiers.map((t) => (isUnlimitedCap(t.token_limit_5h) ? 0 : Number(t.token_limit_5h))));
	$: maxWeek = Math.max(1, ...tiers.map((t) => (isUnlimitedCap(t.token_limit_week) ? 0 : Number(t.token_limit_week))));
	const capRatio = (/** @type {any} */ cap, /** @type {number} */ max) =>
		isUnlimitedCap(cap) ? 100 : Math.max(5, Math.min(100, (Number(cap) / max) * 100));

	const stopPolling = () => {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	};

	const closeCheckout = () => {
		stopPolling();
		checkoutTier = null;
		order = null;
		orderStatus = '';
		creating = false;
		paid = false;
	};

	const openCheckout = (tier) => {
		closeCheckout();
		checkoutTier = tier;
		selectedChainId = chains[0]?.id ?? '';
	};

	const poll = async () => {
		if (!order) return;
		try {
			const res = await getSubscriptionOrder(localStorage.token, order.order_id);
			orderStatus = res.status;
			if (res.activated || res.status === 'PAID') {
				paid = true;
				stopPolling();
				toast.success($i18n.t('Payment received — your plan is active!'));
				await loadState();
			} else if (res.status === 'EXPIRED' || res.status === 'FAILED') {
				stopPolling();
				toast.error($i18n.t('Payment {{status}}', { status: res.status }));
			}
		} catch (e) {
			// transient — keep polling
		}
	};

	const createOrder = async () => {
		if (!checkoutTier || !selectedChainId) return;
		creating = true;
		try {
			order = await subscribe(localStorage.token, checkoutTier.id, selectedChainId);
			orderStatus = order.status ?? 'PENDING';
			stopPolling();
			pollTimer = setInterval(poll, 6000);
		} catch (e) {
			toast.error(`${e}`);
		} finally {
			creating = false;
		}
	};

	const copyAddress = async () => {
		if (!order?.address) return;
		try {
			await navigator.clipboard.writeText(order.address);
			toast.success($i18n.t('Address copied'));
		} catch (e) {
			toast.error($i18n.t('Failed to copy'));
		}
	};

	$: remaining = order?.expires_at ? Math.max(0, order.expires_at - now) : 0;
	const fmtRemaining = (secs) => {
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		const s = secs % 60;
		return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
	};

	const expiryChip = (/** @type {number} */ expiresAt) => {
		const d = new Date(expiresAt * 1000);
		return `${d.getFullYear()} / ${String(d.getMonth() + 1).padStart(2, '0')} / ${String(d.getDate()).padStart(2, '0')}`;
	};

	onMount(async () => {
		await reload();
		tickTimer = setInterval(() => (now = Math.floor(Date.now() / 1000)), 1000);
		loaded = true;
	});

	onDestroy(() => {
		stopPolling();
		if (tickTimer) clearInterval(tickTimer);
	});
</script>

<svelte:head>
	<title>{$i18n.t('Subscription')}</title>
</svelte:head>

{#if loaded}
	<div
		class="flex flex-col w-full h-screen max-h-[100dvh] transition-width duration-200 ease-in-out {$showSidebar
			? 'md:max-w-[calc(100%-var(--sidebar-width))]'
			: ''} max-w-full"
	>
		<!-- header -->
		<div class="flex items-center gap-2 px-4 py-2 border-b border-gray-50 dark:border-gray-850">
			{#if !$showSidebar}
				<Tooltip content={$i18n.t('Open Sidebar')}>
					<button
						class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850"
						on:click={() => showSidebar.set(true)}
					>
						<Sidebar />
					</button>
				</Tooltip>
			{/if}
			<div class="text-lg font-medium">{$i18n.t('Subscription')}</div>
		</div>

		<div class="flex-1 overflow-y-auto px-4 md:px-8 py-6">
			<div class="max-w-4xl mx-auto w-full">
				<!-- redeem -->
				<div class="flex items-center gap-2.5 mb-3">
					<span class="ksub-badge" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6Z" />
							<path d="M13 5v2M13 17v2M13 11v2" />
						</svg>
					</span>
					<span class="text-sm font-semibold">{$i18n.t('Redeem & payment')}</span>
				</div>
				<div class="mb-7 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 flex items-center gap-5 flex-wrap shadow-sm">
					<svg width="50" height="50" viewBox="0 0 64 64" fill="none" aria-hidden="true" class="shrink-0">
						<defs>
							<linearGradient id="ksubGift" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0" stop-color="#c8b6fb" />
								<stop offset="1" stop-color="#9d81f2" />
							</linearGradient>
						</defs>
						<rect x="10" y="26" width="44" height="30" rx="6" fill="url(#ksubGift)" />
						<rect x="10" y="26" width="44" height="10" rx="5" fill="#b49bf7" />
						<rect x="28.5" y="20" width="7" height="36" rx="2.5" fill="#efe9ff" />
						<path
							d="M32 21c-4.5 0-9-2.2-9-6 0-2.6 2-4 4.2-4 3 0 4.8 3.4 4.8 6.6 0-3.2 1.8-6.6 4.8-6.6 2.2 0 4.2 1.4 4.2 4 0 3.8-4.5 6-9 6Z"
							fill="#cdbcfb"
							stroke="#a98ef5"
							stroke-width="1.4"
						/>
					</svg>
					<div class="flex-1 min-w-[220px]">
						<div class="text-[13px] text-gray-600 dark:text-gray-300">
							{$i18n.t('Have a redemption code? Enter it below to activate your plan.')}
						</div>
						<form class="flex flex-col sm:flex-row gap-2.5 mt-2.5" on:submit|preventDefault={redeem}>
							<input
								class="flex-1 px-3.5 h-10 rounded-xl bg-white dark:bg-gray-850 border border-gray-200 dark:border-gray-700 text-sm font-mono tracking-wider uppercase outline-none placeholder:normal-case focus:border-violet-400"
								placeholder="XXXX-XXXX-XXXX-XXXX"
								bind:value={redeemCode}
								autocomplete="off"
								spellcheck="false"
							/>
							<button
								type="submit"
								class="px-6 h-10 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
								disabled={redeeming || !redeemCode.trim()}
							>
								{redeeming ? $i18n.t('Redeeming…') : $i18n.t('Redeem')}
							</button>
						</form>
					</div>
				</div>

				<!-- current plan + live usage -->
				{#if me?.tier}
					{@const w5 = winView(usage?.tp5h, me.tier.token_limit_5h)}
					{@const ww = winView(usage?.tpw, me.tier.token_limit_week)}
					<div class="flex items-center gap-2.5 mb-3">
						<span class="ksub-badge" aria-hidden="true">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
								<circle cx="12" cy="12" r="7.2" />
								<circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
							</svg>
						</span>
						<span class="text-sm font-semibold">{$i18n.t('Current plan')}</span>
					</div>
					<div class="mb-7 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
						<div class="flex items-center gap-2.5 flex-wrap">
							<span class="w-2 h-2 rounded-full bg-violet-500 shrink-0"></span>
							<span class="text-xl font-bold">{me.tier.name}</span>
							{#if me.expires_at}
								<span class="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1">
									{$i18n.t('Renews {{date}}', { date: expiryChip(me.expires_at) })}
								</span>
							{/if}
						</div>
						<div class="mt-4 space-y-4">
							{#each [{ label: $i18n.t('Every 5 hours'), w: w5, reset: fmtReset(usage?.tp5h?.resetAt, now) }, { label: $i18n.t('Weekly'), w: ww, reset: fmtReset(usage?.tpw?.resetAt, now) }] as row}
								<div class="flex items-end gap-4">
									<div class="w-32 shrink-0">
										<div class="text-[13px] font-semibold">{row.label}</div>
										{#if row.reset}
											<div class="text-xs text-gray-400 mt-0.5">{row.reset}</div>
										{/if}
									</div>
									<div class="flex-1 min-w-[140px]">
										<div class="text-right text-xs text-gray-500 dark:text-gray-400 mb-1.5">
											{row.w.unlimited ? $i18n.t('Unlimited') : $i18n.t('{{percent}}% used', { percent: Math.round(row.w.pct) })}
										</div>
										<div class="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
											<div
												class="h-full rounded-full bg-[#7cb0f5] transition-[width] duration-300"
												style="width: {row.w.unlimited ? 100 : Math.max(row.w.pct, 0.6)}%"
											></div>
										</div>
									</div>
									<div class="w-28 shrink-0 text-right text-xs text-gray-500 dark:text-gray-400 pb-0.5">
										{row.w.unlimited ? '∞' : `${formatTokens(row.w.used)} / ${formatTokens(row.w.limit)}`}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- tiers -->
				<div class="flex items-center gap-2.5 mb-3">
					<span class="ksub-badge" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="currentColor">
							<rect x="4" y="13" width="4" height="7" rx="1.2" />
							<rect x="10" y="9" width="4" height="11" rx="1.2" />
							<rect x="16" y="5" width="4" height="15" rx="1.2" />
						</svg>
					</span>
					<span class="text-sm font-semibold">{$i18n.t('Available plans')}</span>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
					{#each tiers as tier (tier.id)}
						{@const isCurrent = me?.tier?.id === tier.id}
						{@const isFree = !(tier.price_usd > 0)}
						<div
							class="ksub-card flex flex-col rounded-2xl overflow-hidden bg-white dark:bg-gray-900 {selectedTierId ===
							tier.id
								? 'is-selected'
								: ''}"
							role="button"
							tabindex="0"
							on:click={() => (selectedTierId = tier.id)}
							on:keydown={(e) => e.key === 'Enter' && (selectedTierId = tier.id)}
						>
							<div
								class="px-4 py-2.5 flex items-center justify-between gap-2 {isFree
									? 'bg-gray-100 dark:bg-gray-800'
									: 'bg-violet-50 dark:bg-violet-500/10'}"
							>
								<span class="text-sm font-bold">{tier.name}</span>
								{#if tier.name === 'Max'}
									<span class="text-[11px] text-violet-600 dark:text-violet-300 bg-white dark:bg-gray-900 rounded-full px-2 py-0.5 whitespace-nowrap">
										👍 {$i18n.t('Recommended')}
									</span>
								{/if}
							</div>
							<div class="flex flex-col flex-1 px-3.5 pt-3 pb-3.5">
								<div class="flex items-baseline gap-1.5">
									{#if isFree}
										<span class="text-[22px] font-bold leading-tight">{$i18n.t('Free')}</span>
									{:else}
										<span class="text-[22px] font-bold leading-tight tracking-tight">{tier.price_usd}</span>
										<span class="text-[11px] font-semibold text-gray-400 tracking-wide">USDT</span>
									{/if}
								</div>
								{#if !isFree}
									<div class="mt-1.5">
										<span class="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-2.5 py-0.5">
											{$i18n.t('per {{days}} days', { days: tier.duration_days })}
										</span>
									</div>
								{/if}
								{#if tier.description}
									<div class="mt-2 text-xs text-gray-500 dark:text-gray-400">{tier.description}</div>
								{/if}
								<div class="mt-3.5">
									<div class="flex items-baseline justify-between">
										<span class="text-[11px] text-gray-400">{$i18n.t('Every 5 hours')}</span>
										<span class="text-xs font-semibold">
											{isUnlimitedCap(tier.token_limit_5h) ? $i18n.t('Unlimited') : formatTokens(tier.token_limit_5h)}
										</span>
									</div>
									<div class="h-[5px] rounded-full bg-gray-100 dark:bg-gray-800 mt-1.5 overflow-hidden">
										<div class="h-full rounded-full bg-violet-300 dark:bg-violet-400/60" style="width: {capRatio(tier.token_limit_5h, max5h)}%"></div>
									</div>
									<div class="flex items-baseline justify-between mt-2.5">
										<span class="text-[11px] text-gray-400">{$i18n.t('Weekly')}</span>
										<span class="text-xs font-semibold">
											{isUnlimitedCap(tier.token_limit_week) ? $i18n.t('Unlimited') : formatTokens(tier.token_limit_week)}
										</span>
									</div>
									<div class="h-[5px] rounded-full bg-gray-100 dark:bg-gray-800 mt-1.5 overflow-hidden">
										<div class="h-full rounded-full bg-violet-300 dark:bg-violet-400/60" style="width: {capRatio(tier.token_limit_week, maxWeek)}%"></div>
									</div>
								</div>

								<div class="mt-auto pt-4">
									{#if isCurrent}
										<button
											class="w-full py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm font-semibold cursor-default"
											disabled
										>
											{$i18n.t('Current plan')}
										</button>
									{:else if !isFree}
										<button
											class="w-full py-2 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-semibold transition-colors"
											on:click|stopPropagation={() => {
												selectedTierId = tier.id;
												openCheckout(tier);
											}}
										>
											{$i18n.t('Subscribe')}
										</button>
									{:else}
										<button
											class="w-full py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm font-semibold cursor-default"
											disabled
										>
											{$i18n.t('Default')}
										</button>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>

				{#if tiers.length === 0}
					<div class="text-center text-sm text-gray-500 py-10">
						{$i18n.t('No subscription plans are available right now.')}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- checkout overlay -->
	{#if checkoutTier}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			on:click|self={closeCheckout}
		>
			<div class="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-5 max-h-[90dvh] overflow-y-auto">
				<div class="flex items-center justify-between mb-3">
					<div class="text-lg font-semibold">
						{$i18n.t('Subscribe to {{name}}', { name: checkoutTier.name })}
					</div>
					<button class="text-gray-400 hover:text-gray-700 dark:hover:text-white" on:click={closeCheckout}>✕</button>
				</div>

				{#if !order}
					<!-- chain selection -->
					<div class="text-sm text-gray-500 mb-1">{$i18n.t('Pay with USDT on')}</div>
					<select
						class="w-full mb-4 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 text-sm outline-none"
						bind:value={selectedChainId}
					>
						{#each chains as c}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>

					<div class="flex items-center justify-between text-sm mb-4">
						<span class="text-gray-500">{$i18n.t('Amount')}</span>
						<span class="font-semibold">{checkoutTier.price_usd} USDT</span>
					</div>

					<button
						class="w-full py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
						on:click={createOrder}
						disabled={creating || !selectedChainId}
					>
						{creating ? $i18n.t('Generating…') : $i18n.t('Generate payment address')}
					</button>
				{:else if paid}
					<div class="text-center py-6">
						<div class="text-3xl mb-2">✓</div>
						<div class="text-lg font-semibold mb-1">{$i18n.t('Payment received')}</div>
						<div class="text-sm text-gray-500 mb-4">{$i18n.t('Your {{name}} plan is now active.', { name: checkoutTier.name })}</div>
						<button
							class="px-5 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-semibold transition-colors"
							on:click={closeCheckout}
						>
							{$i18n.t('Done')}
						</button>
					</div>
				{:else}
					<!-- payment instructions -->
					<div class="text-center">
						{#if order.qr_code_image}
							<img src={order.qr_code_image} alt="QR" class="mx-auto w-44 h-44 rounded-lg bg-white p-1" />
						{/if}
						<div class="mt-3 text-xs text-gray-500">
							{$i18n.t('Send exactly')}
						</div>
						<div class="text-lg font-semibold">{order.amount} USDT</div>

						<button
							class="mt-3 w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 text-xs font-mono break-all hover:bg-gray-100 dark:hover:bg-gray-800"
							on:click={copyAddress}
							title={$i18n.t('Click to copy')}
						>
							{order.address}
						</button>

						<div class="mt-3 flex items-center justify-center gap-2 text-sm">
							<span
								class="inline-block w-2 h-2 rounded-full {orderStatus === 'PAID'
									? 'bg-emerald-500'
									: 'bg-yellow-500'}"
							/>
							<span class="text-gray-500">
								{orderStatus === 'PAID' ? $i18n.t('Confirmed') : $i18n.t('Waiting for payment…')}
							</span>
						</div>

						{#if remaining > 0}
							<div class="mt-1 text-xs text-gray-400">
								{$i18n.t('Expires in {{time}}', { time: fmtRemaining(remaining) })}
							</div>
						{:else}
							<div class="mt-1 text-xs text-red-500">{$i18n.t('This payment request has expired.')}</div>
						{/if}

						<div class="mt-3 text-[11px] text-gray-400">
							{$i18n.t('Send only USDT on the selected network. This page updates automatically.')}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}

<style>
	.ksub-badge {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: #ece5fd;
		color: #7c5cf0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}
	:global(.dark) .ksub-badge {
		background: rgba(124, 92, 240, 0.18);
		color: #b6a3f8;
	}
	:global(.dark) .ksub-badge svg,
	.ksub-badge svg {
		width: 14px;
		height: 14px;
	}
	.ksub-card {
		border: 2px solid rgb(243 244 246); /* gray-100 */
		cursor: pointer;
		transition: transform 200ms ease, box-shadow 200ms ease, border-color 160ms ease;
		box-shadow: 0 1px 2px rgba(31, 27, 22, 0.04);
	}
	:global(.dark) .ksub-card {
		border-color: rgb(31 41 55); /* gray-800 */
	}
	.ksub-card:hover:not(.is-selected) {
		transform: translateY(-6px);
		box-shadow: 0 14px 30px rgba(31, 27, 22, 0.1);
	}
	.ksub-card.is-selected {
		transform: translateY(-8px);
		border-color: #a78bfa;
		box-shadow: 0 18px 36px rgba(124, 92, 240, 0.16);
	}
</style>
