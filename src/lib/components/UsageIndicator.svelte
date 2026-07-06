<script lang="ts">
	// Inline usage indicator for the chat-box bottom toolbar (Claude-style). Shows a
	// compact % (or an ∞ icon when the plan is unlimited); clicking opens an upward
	// popup with the 5-hour + weekly progress bars, wallet balance, the paid
	// extra-usage opt-in, and a top-up button. Renders nothing unless token billing
	// is enabled AND the user has a linked KyberRouter key.
	import { getContext, onDestroy } from 'svelte';
	import { config } from '$lib/stores';
	import { getKyberUsageLimits } from '$lib/apis/kyber';
	import { setExtraUsage } from '$lib/apis/subscriptions';
	import KyberTopUpModal from '$lib/components/KyberTopUpModal.svelte';

	const i18n = getContext('i18n');

	let limits: any = null;
	let linked = false;
	let open = false;
	let loading = false;
	let toggling = false;
	let showTopUp = false;
	let timer: ReturnType<typeof setInterval> | null = null;

	$: enabled = $config?.features?.enable_kyber_token_billing ?? false;

	const fmtUsd = (n: number) =>
		`$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
	const fmtNum = (n: number) => (Number(n) || 0).toLocaleString();

	const pct = (w: any): number => {
		const limit = Number(w?.limit) || 0;
		if (limit <= 0) return 0;
		return Math.min(100, Math.round(((Number(w?.used) || 0) / limit) * 100));
	};
	const isUnlimited = (w: any): boolean => !(Number(w?.limit) > 0);

	// Enterprise (org-seat) member? Mirror the desktop client: show the monthly seat
	// quota + org-wallet overflow instead of the personal 5h/weekly plan view.
	$: enterprise = limits?.enterprise ?? null;
	const entPct = (e: any): number => {
		const q = Number(e?.quota) || 0;
		if (q <= 0) return 0;
		return Math.min(100, Math.round(((Number(e?.used) || 0) / q) * 100));
	};
	// Whole days until the monthly seat cycle resets (from an ISO cycleEndsAt).
	const fmtDaysReset = (iso: string | null): string => {
		if (!iso) return '';
		const ms = new Date(iso).getTime() - Date.now();
		if (ms <= 0) return $i18n.t('resets soon');
		return $i18n.t('Resets in ~{{n}} days', { n: Math.max(1, Math.ceil(ms / 86400000)) });
	};

	const fmtReset = (resetAt: number | null): string => {
		if (!resetAt) return '';
		const ms = resetAt - Date.now();
		if (ms <= 0) return $i18n.t('resets soon');
		const mins = Math.round(ms / 60000);
		if (mins < 60) return $i18n.t('resets in ~{{n}}m', { n: mins });
		const hrs = Math.round(mins / 60);
		if (hrs < 48) return $i18n.t('resets in ~{{n}}h', { n: hrs });
		return $i18n.t('resets in ~{{n}}d', { n: Math.round(hrs / 24) });
	};

	// Enterprise: the collapsed pill shows the seat-quota % as a ring, never the ∞ icon.
	$: allUnlimited = enterprise ? false : limits ? isUnlimited(limits.tp5h) && isUnlimited(limits.tpw) : true;
	$: headlinePct = enterprise
		? entPct(enterprise)
		: limits
			? Math.max(pct(limits.tp5h), pct(limits.tpw))
			: 0;
	// Claude-style thresholds: <80% blue, 80–90% yellow, ≥90% red.
	const barColor = (p: number) => (p >= 90 ? 'bg-red-500' : p >= 80 ? 'bg-amber-500' : 'bg-blue-500');
	const ringColor = (p: number) => (p >= 90 ? '#ef4444' : p >= 80 ? '#f59e0b' : '#3b82f6');
	const RING_C = 2 * Math.PI * 15; // ring circumference for r=15

	const refresh = async () => {
		if (!enabled || loading) return;
		loading = true;
		try {
			const res = await getKyberUsageLimits(localStorage.token);
			linked = !!res?.linked;
			limits = linked ? res : null;
		} catch (e) {
			// keep last value
		} finally {
			loading = false;
		}
	};

	const toggleExtra = async () => {
		if (toggling || !limits) return;
		toggling = true;
		const next = !limits.extraUsageEnabled;
		try {
			await setExtraUsage(localStorage.token, next);
			limits = { ...limits, extraUsageEnabled: next };
		} catch (e) {
			// no-op
		} finally {
			toggling = false;
		}
	};

	// Start as soon as `enabled` becomes true (reactively), not gated on mount —
	// $config may not be loaded yet when this mounts, which would otherwise leave
	// the indicator permanently hidden.
	let started = false;
	$: if (enabled && !started) {
		started = true;
		refresh();
		timer = setInterval(refresh, 60000);
	}
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

{#if enabled && linked && limits}
	<div class="relative text-xs select-none">
		<!-- trigger -->
		<button
			type="button"
			class="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-gray-600 dark:text-gray-300"
			on:click={() => (open = !open)}
			title={$i18n.t('Usage')}
		>
			{#if allUnlimited}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
				</svg>
				<span>{$i18n.t('Usage')}</span>
			{:else}
				<svg viewBox="0 0 36 36" class="w-4 h-4 -rotate-90">
					<circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="5" class="text-gray-200 dark:text-gray-700" />
					<circle
						cx="18"
						cy="18"
						r="15"
						fill="none"
						stroke-width="5"
						stroke-linecap="round"
						stroke={ringColor(headlinePct)}
						stroke-dasharray="{(headlinePct / 100) * RING_C} {RING_C}"
					/>
				</svg>
				<span class="font-medium">{headlinePct}%</span>
			{/if}
		</button>

		{#if open}
			<!-- click-away backdrop -->
			<button class="fixed inset-0 z-30 cursor-default" tabindex="-1" aria-label="close" on:click={() => (open = false)}></button>
			<div
				class="absolute bottom-full right-0 mb-1.5 w-64 z-40 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg p-3"
			>
				<div class="flex items-center justify-between mb-2">
					<span class="font-medium text-gray-700 dark:text-gray-200">{$i18n.t('Plan usage limits')}</span>
					<button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" on:click|stopPropagation={refresh} title={$i18n.t('Refresh')} aria-label={$i18n.t('Refresh')}>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}">
							<path fill-rule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.841V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5a.75.75 0 0 1 .584.885 6 6 0 0 1-9.44 1.243l-.842-.84v1.37a.75.75 0 0 1-1.5 0V9.358a.75.75 0 0 1 .75-.75h3.182a.75.75 0 0 1 0 1.5h-1.37l.84.84a4.5 4.5 0 0 0 7.08-.93.75.75 0 0 1 .916-.49Z" clip-rule="evenodd" />
						</svg>
					</button>
				</div>

				{#if enterprise}
					<!-- Enterprise seat quota (desktop parity): monthly seat quota, then 无限制 windows. -->
					<div class="py-1">
						<div class="flex items-baseline justify-between">
							<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Seat quota ({{org}})', { org: enterprise.orgName })}</span>
							<span class="text-gray-700 dark:text-gray-200">{entPct(enterprise)}%</span>
						</div>
						<div class="mt-1 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
							<div class="h-full rounded-full {barColor(entPct(enterprise))}" style="width: {entPct(enterprise)}%"></div>
						</div>
						{#if enterprise.cycleEndsAt}<div class="mt-0.5 text-[10px] text-gray-400">{fmtDaysReset(enterprise.cycleEndsAt)}</div>{/if}
					</div>

					<div class="py-1 flex items-baseline justify-between">
						<span class="text-gray-500 dark:text-gray-400">{$i18n.t('5-hour limit')}</span>
						<span class="text-gray-700 dark:text-gray-200">{$i18n.t('Unlimited')}</span>
					</div>
					<div class="py-1 flex items-baseline justify-between">
						<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Weekly limit')}</span>
						<span class="text-gray-700 dark:text-gray-200">{$i18n.t('Unlimited')}</span>
					</div>

					<p class="mt-1 text-[10px] text-gray-400 leading-snug">{$i18n.t('When the monthly quota is used up, the org wallet balance is used automatically — no action needed.')}</p>
				{:else}
					<div class="py-1">
						<div class="flex items-baseline justify-between">
							<span class="text-gray-500 dark:text-gray-400">{$i18n.t('5-hour limit')}</span>
							<span class="text-gray-700 dark:text-gray-200">{isUnlimited(limits.tp5h) ? $i18n.t('Unlimited') : `${pct(limits.tp5h)}%`}</span>
						</div>
						{#if !isUnlimited(limits.tp5h)}
							<div class="mt-1 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
								<div class="h-full rounded-full {barColor(pct(limits.tp5h))}" style="width: {pct(limits.tp5h)}%"></div>
							</div>
							{#if limits.tp5h?.resetAt}<div class="mt-0.5 text-[10px] text-gray-400">{fmtReset(limits.tp5h.resetAt)}</div>{/if}
						{/if}
					</div>

					<div class="py-1">
						<div class="flex items-baseline justify-between">
							<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Weekly limit')}</span>
							<span class="text-gray-700 dark:text-gray-200">{isUnlimited(limits.tpw) ? $i18n.t('Unlimited') : `${pct(limits.tpw)}%`}</span>
						</div>
						{#if !isUnlimited(limits.tpw)}
							<div class="mt-1 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
								<div class="h-full rounded-full {barColor(pct(limits.tpw))}" style="width: {pct(limits.tpw)}%"></div>
							</div>
							{#if limits.tpw?.resetAt}<div class="mt-0.5 text-[10px] text-gray-400">{fmtReset(limits.tpw.resetAt)}</div>{/if}
						{/if}
					</div>
				{/if}

				<div class="my-2 border-t border-gray-100 dark:border-gray-800"></div>

				<div class="flex items-baseline justify-between py-1">
					<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Extra-usage balance')}</span>
					<span class="font-semibold {(limits.credits ?? 0) <= 0 ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}">{fmtUsd(limits.credits)}</span>
				</div>
				<div class="flex items-center justify-between py-1">
					<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Use extra usage')}</span>
					<button type="button" role="switch" aria-checked={limits.extraUsageEnabled} aria-label={$i18n.t('Use extra usage')} disabled={toggling} on:click|stopPropagation={toggleExtra}
						class="relative inline-flex h-4 w-7 items-center rounded-full transition {limits.extraUsageEnabled ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-gray-700'} {toggling ? 'opacity-60' : ''}">
						<span class="inline-block h-3 w-3 transform rounded-full bg-white transition {limits.extraUsageEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}"></span>
					</button>
				</div>

				<button on:click|stopPropagation={() => (showTopUp = true)} class="mt-2 block w-full text-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 font-medium transition">
					{$i18n.t('Top up')}
				</button>
			</div>
		{/if}
	</div>

	<KyberTopUpModal bind:show={showTopUp} on:credited={refresh} />
{/if}
