<script lang="ts">
	// Settings → Usage (Claude-style). Shows the user's current plan, their token-cap
	// consumption (5-hour + weekly), the paid extra-usage opt-in + balance, and entry
	// points to top up or upgrade. Data: /subscriptions/me (plan) + /kyber/usage/limits
	// (live caps/usage/wallet/extra-usage state).
	import { getContext, onMount } from 'svelte';
	import { goto } from '$app/navigation';

	import { getMySubscription, setExtraUsage } from '$lib/apis/subscriptions';
	import { getKyberUsageLimits } from '$lib/apis/kyber';
	import KyberTopUpModal from '$lib/components/KyberTopUpModal.svelte';

	const i18n = getContext('i18n');

	let me: any = null;
	let limits: any = null;
	let loading = true;
	let toggling = false;
	let showTopUp = false;

	const fmtUsd = (n: number) =>
		`$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

	const pct = (w: any): number => {
		const limit = Number(w?.limit) || 0;
		if (limit <= 0) return 0;
		return Math.min(100, Math.round(((Number(w?.used) || 0) / limit) * 100));
	};
	const isUnlimited = (w: any): boolean => !(Number(w?.limit) > 0);
	const fmtNum = (n: number) => (Number(n) || 0).toLocaleString();
	const barColor = (p: number) => (p >= 100 ? 'bg-red-500' : p >= 80 ? 'bg-amber-500' : 'bg-emerald-500');

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

	const load = async () => {
		loading = true;
		try {
			me = await getMySubscription(localStorage.token).catch(() => null);
		} catch (e) {
			me = null;
		}
		try {
			const res = await getKyberUsageLimits(localStorage.token).catch(() => null);
			limits = res?.linked ? res : null;
		} catch (e) {
			limits = null;
		}
		loading = false;
	};

	const toggleExtra = async () => {
		if (toggling || !limits) return;
		toggling = true;
		const next = !limits.extraUsageEnabled;
		try {
			await setExtraUsage(localStorage.token, next);
			limits = { ...limits, extraUsageEnabled: next };
		} catch (e) {
			// leave unchanged on failure
		} finally {
			toggling = false;
		}
	};

	onMount(load);
</script>

<div class="flex flex-col h-full justify-between text-sm">
	<div class="overflow-y-auto pr-1 max-h-[28rem]">
		{#if loading}
			<div class="text-gray-500 dark:text-gray-400 py-8 text-center">{$i18n.t('Loading...')}</div>
		{:else}
			<!-- Current plan -->
			<div class="flex items-center justify-between mb-3">
				<div>
					<div class="text-base font-medium text-gray-800 dark:text-gray-100">
						{me?.tier?.name ?? $i18n.t('Free')}
						<span class="text-xs text-gray-400 font-normal">{$i18n.t('plan')}</span>
					</div>
					{#if me?.expires_at}
						<div class="text-xs text-gray-400">
							{$i18n.t('Renews / expires')}
							{new Date(me.expires_at * 1000).toLocaleDateString()}
						</div>
					{/if}
				</div>
				<button
					class="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
					on:click={() => goto('/subscription')}
				>
					{$i18n.t('Manage plan')}
				</button>
			</div>

			{#if limits}
				<!-- Plan usage limits -->
				<div class="mb-1 mt-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
					{$i18n.t('Plan usage limits')}
				</div>

				<div class="py-2">
					<div class="flex items-baseline justify-between">
						<span class="text-gray-700 dark:text-gray-200">{$i18n.t('5-hour limit')}</span>
						<span class="text-gray-500 dark:text-gray-400">
							{#if isUnlimited(limits.tp5h)}
								{$i18n.t('Unlimited')}
							{:else}
								{pct(limits.tp5h)}% · {fmtNum(limits.tp5h?.used)} / {fmtNum(limits.tp5h?.limit)}
							{/if}
						</span>
					</div>
					{#if !isUnlimited(limits.tp5h)}
						<div class="mt-1 h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
							<div class="h-full rounded-full {barColor(pct(limits.tp5h))}" style="width: {pct(limits.tp5h)}%"></div>
						</div>
						{#if limits.tp5h?.resetAt}
							<div class="mt-0.5 text-[11px] text-gray-400">{fmtReset(limits.tp5h.resetAt)}</div>
						{/if}
					{/if}
				</div>

				<div class="py-2">
					<div class="flex items-baseline justify-between">
						<span class="text-gray-700 dark:text-gray-200">{$i18n.t('Weekly limit')}</span>
						<span class="text-gray-500 dark:text-gray-400">
							{#if isUnlimited(limits.tpw)}
								{$i18n.t('Unlimited')}
							{:else}
								{pct(limits.tpw)}% · {fmtNum(limits.tpw?.used)} / {fmtNum(limits.tpw?.limit)}
							{/if}
						</span>
					</div>
					{#if !isUnlimited(limits.tpw)}
						<div class="mt-1 h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
							<div class="h-full rounded-full {barColor(pct(limits.tpw))}" style="width: {pct(limits.tpw)}%"></div>
						</div>
						{#if limits.tpw?.resetAt}
							<div class="mt-0.5 text-[11px] text-gray-400">{fmtReset(limits.tpw.resetAt)}</div>
						{/if}
					{/if}
				</div>

				<!-- Extra usage -->
				<div class="mb-1 mt-5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
					{$i18n.t('Extra usage')}
				</div>
				<p class="text-xs text-gray-400 mb-2 leading-snug">
					{$i18n.t(
						'When you reach a plan limit, turn this on to keep going — extra usage is billed per token from your balance.'
					)}
					{#if Number(limits.extraUsageMultiplier) && Number(limits.extraUsageMultiplier) !== 1}
						{$i18n.t('Extra tokens cost {{n}}× the standard model price.', {
							n: limits.extraUsageMultiplier
						})}
					{/if}
				</p>

				<div class="flex items-center justify-between py-1.5">
					<span class="text-gray-700 dark:text-gray-200">{$i18n.t('Use extra usage')}</span>
					<button
						type="button"
						role="switch"
						aria-checked={limits.extraUsageEnabled}
						disabled={toggling}
						on:click={toggleExtra}
						class="relative inline-flex h-5 w-9 items-center rounded-full transition {limits.extraUsageEnabled
							? 'bg-emerald-600'
							: 'bg-gray-300 dark:bg-gray-700'} {toggling ? 'opacity-60' : ''}"
					>
						<span
							class="inline-block h-4 w-4 transform rounded-full bg-white transition {limits.extraUsageEnabled
								? 'translate-x-4'
								: 'translate-x-0.5'}"
						></span>
					</button>
				</div>

				<div class="flex items-baseline justify-between py-1.5">
					<span class="text-gray-700 dark:text-gray-200">{$i18n.t('Extra-usage balance')}</span>
					<span
						class="font-semibold {(limits.credits ?? 0) <= 0
							? 'text-red-500'
							: 'text-emerald-600 dark:text-emerald-400'}">{fmtUsd(limits.credits)}</span
					>
				</div>

				<button
					on:click={() => (showTopUp = true)}
					class="mt-2 w-full text-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white py-2 font-medium transition"
				>
					{$i18n.t('Top up balance')}
				</button>
			{:else}
				<div class="text-xs text-gray-400 py-4">
					{$i18n.t('Usage details are unavailable — your account is not linked to a wallet yet.')}
				</div>
			{/if}
		{/if}
	</div>
</div>

<KyberTopUpModal bind:show={showTopUp} on:credited={load} />
