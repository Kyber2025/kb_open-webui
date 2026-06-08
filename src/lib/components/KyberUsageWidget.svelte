<script lang="ts">
	// Bottom-right usage indicator (Claude-style). Shows the signed-in user's
	// subscription token-cap consumption (5-hour + weekly %), wallet balance, and a
	// paid "extra usage" (overflow) opt-in + top-up. Renders nothing unless token
	// billing is enabled AND the user has a linked KyberRouter key, so it's invisible
	// for admins / when billing is off.
	import { getContext, onMount, onDestroy } from 'svelte';
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

	// Percent used of a token window. limit 0/undefined = unlimited → 0%.
	const pct = (w: any): number => {
		const limit = Number(w?.limit) || 0;
		if (limit <= 0) return 0;
		return Math.min(100, Math.round(((Number(w?.used) || 0) / limit) * 100));
	};
	const isUnlimited = (w: any): boolean => !(Number(w?.limit) > 0);

	// Relative "resets in ~X" for a window's resetAt (epoch ms).
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

	// The headline % shown on the collapsed pill = the more-consumed of the two windows.
	$: headlinePct = limits ? Math.max(pct(limits.tp5h), pct(limits.tpw)) : 0;
	$: barColor = (p: number) =>
		p >= 100 ? 'bg-red-500' : p >= 80 ? 'bg-amber-500' : 'bg-emerald-500';

	const refresh = async () => {
		if (!enabled || loading) return;
		loading = true;
		try {
			const res = await getKyberUsageLimits(localStorage.token);
			linked = !!res?.linked;
			limits = linked ? res : null;
		} catch (e) {
			// Non-fatal: keep last known value.
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
			// leave state unchanged on failure
		} finally {
			toggling = false;
		}
	};

	onMount(() => {
		if (enabled) {
			refresh();
			timer = setInterval(refresh, 60000);
		}
	});

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

{#if enabled && linked && limits}
	<div class="fixed bottom-2.5 right-2.5 z-40 flex flex-col items-end text-xs select-none">
		{#if open}
			<div
				class="mb-1.5 w-64 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg p-3"
			>
				<div class="flex items-center justify-between mb-2">
					<span class="font-medium text-gray-700 dark:text-gray-200">{$i18n.t('Usage')}</span>
					<button
						class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
						on:click={refresh}
						title={$i18n.t('Refresh')}
						aria-label={$i18n.t('Refresh')}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							fill="currentColor"
							class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}"
						>
							<path
								fill-rule="evenodd"
								d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.841V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5a.75.75 0 0 1 .584.885 6 6 0 0 1-9.44 1.243l-.842-.84v1.37a.75.75 0 0 1-1.5 0V9.358a.75.75 0 0 1 .75-.75h3.182a.75.75 0 0 1 0 1.5h-1.37l.84.84a4.5 4.5 0 0 0 7.08-.93.75.75 0 0 1 .916-.49Z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>
				</div>

				<!-- 5-hour window -->
				<div class="py-1">
					<div class="flex items-baseline justify-between">
						<span class="text-gray-500 dark:text-gray-400">{$i18n.t('5-hour limit')}</span>
						<span class="text-gray-700 dark:text-gray-200">
							{isUnlimited(limits.tp5h) ? $i18n.t('Unlimited') : `${pct(limits.tp5h)}%`}
						</span>
					</div>
					{#if !isUnlimited(limits.tp5h)}
						<div class="mt-1 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
							<div class="h-full rounded-full {barColor(pct(limits.tp5h))}" style="width: {pct(limits.tp5h)}%"></div>
						</div>
						{#if limits.tp5h?.resetAt}
							<div class="mt-0.5 text-[10px] text-gray-400">{fmtReset(limits.tp5h.resetAt)}</div>
						{/if}
					{/if}
				</div>

				<!-- Weekly window -->
				<div class="py-1">
					<div class="flex items-baseline justify-between">
						<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Weekly limit')}</span>
						<span class="text-gray-700 dark:text-gray-200">
							{isUnlimited(limits.tpw) ? $i18n.t('Unlimited') : `${pct(limits.tpw)}%`}
						</span>
					</div>
					{#if !isUnlimited(limits.tpw)}
						<div class="mt-1 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
							<div class="h-full rounded-full {barColor(pct(limits.tpw))}" style="width: {pct(limits.tpw)}%"></div>
						</div>
						{#if limits.tpw?.resetAt}
							<div class="mt-0.5 text-[10px] text-gray-400">{fmtReset(limits.tpw.resetAt)}</div>
						{/if}
					{/if}
				</div>

				<div class="my-2 border-t border-gray-100 dark:border-gray-800"></div>

				<!-- Wallet balance -->
				<div class="flex items-baseline justify-between py-1">
					<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Extra-usage balance')}</span>
					<span
						class="font-semibold {(limits.credits ?? 0) <= 0
							? 'text-red-500'
							: 'text-emerald-600 dark:text-emerald-400'}">{fmtUsd(limits.credits)}</span
					>
				</div>

				<!-- Extra-usage opt-in -->
				<div class="flex items-center justify-between py-1">
					<span class="text-gray-500 dark:text-gray-400">
						{$i18n.t('Use extra usage')}
						{#if Number(limits.extraUsageMultiplier) && Number(limits.extraUsageMultiplier) !== 1}
							<span class="text-[10px] text-gray-400">({limits.extraUsageMultiplier}×)</span>
						{/if}
					</span>
					<button
						type="button"
						role="switch"
						aria-checked={limits.extraUsageEnabled}
						disabled={toggling}
						on:click={toggleExtra}
						class="relative inline-flex h-4 w-7 items-center rounded-full transition {limits.extraUsageEnabled
							? 'bg-emerald-600'
							: 'bg-gray-300 dark:bg-gray-700'} {toggling ? 'opacity-60' : ''}"
					>
						<span
							class="inline-block h-3 w-3 transform rounded-full bg-white transition {limits.extraUsageEnabled
								? 'translate-x-3.5'
								: 'translate-x-0.5'}"
						></span>
					</button>
				</div>
				<p class="text-[10px] text-gray-400 leading-snug">
					{$i18n.t('When your plan limit is reached, keep going by spending your balance per token.')}
				</p>

				<button
					on:click={() => (showTopUp = true)}
					class="mt-2 block w-full text-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 font-medium transition"
				>
					{$i18n.t('Top up')}
				</button>
				{#if limits.topup_url}
					<a
						href={limits.topup_url}
						target="_blank"
						rel="noopener noreferrer"
						class="mt-1 block w-full text-center text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
					>
						{$i18n.t('Open billing dashboard')}
					</a>
				{/if}
			</div>
		{/if}

		<button
			class="rounded-full border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-md px-3 py-1.5 flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
			on:click={() => (open = !open)}
			title={$i18n.t('Usage')}
		>
			<div class="h-1.5 w-10 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
				<div class="h-full rounded-full {barColor(headlinePct)}" style="width: {headlinePct}%"></div>
			</div>
			<span class="font-semibold text-gray-700 dark:text-gray-200">{headlinePct}%</span>
		</button>
	</div>
{/if}

<KyberTopUpModal bind:show={showTopUp} on:credited={refresh} />
