<script lang="ts">
	// P3 (SESSION-HANDOFF §12.7): bottom-right wallet/usage widget. Shows the
	// signed-in user's KyberRouter balance (credits) + today/month token usage and
	// a top-up entry. Renders nothing unless token billing is enabled AND the user
	// has a linked KyberRouter key, so it's invisible for admins / when billing off.
	import { getContext, onMount, onDestroy } from 'svelte';
	import { config } from '$lib/stores';
	import { getKyberUsage } from '$lib/apis/kyber';

	const i18n = getContext('i18n');

	let usage: any = null;
	let linked = false;
	let open = false;
	let loading = false;
	let timer: ReturnType<typeof setInterval> | null = null;

	$: enabled = $config?.enable_kyber_token_billing ?? false;

	const fmtUsd = (n: number) =>
		`$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
	const fmtNum = (n: number) => (Number(n) || 0).toLocaleString();

	const refresh = async () => {
		if (!enabled || loading) return;
		loading = true;
		try {
			const res = await getKyberUsage(localStorage.token);
			linked = !!res?.linked;
			usage = linked ? res : null;
		} catch (e) {
			// Non-fatal: keep last known value, just stop showing stale errors.
		} finally {
			loading = false;
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

{#if enabled && linked && usage}
	<div class="fixed bottom-2.5 right-2.5 z-40 flex flex-col items-end text-xs select-none">
		{#if open}
			<div
				class="mb-1.5 w-60 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg p-3"
			>
				<div class="flex items-center justify-between mb-2">
					<span class="font-medium text-gray-700 dark:text-gray-200"
						>{$i18n.t('Usage & balance')}</span
					>
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

				<div class="flex items-baseline justify-between py-1">
					<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Balance')}</span>
					<span
						class="font-semibold {(usage.credits ?? 0) <= 0
							? 'text-red-500'
							: 'text-emerald-600 dark:text-emerald-400'}">{fmtUsd(usage.credits)}</span
					>
				</div>
				<div class="flex items-baseline justify-between py-1">
					<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Today')}</span>
					<span class="text-gray-700 dark:text-gray-200"
						>{fmtNum(usage.today?.tokens)} {$i18n.t('tokens')}</span
					>
				</div>
				<div class="flex items-baseline justify-between py-1">
					<span class="text-gray-500 dark:text-gray-400">{$i18n.t('This month')}</span>
					<span class="text-gray-700 dark:text-gray-200"
						>{fmtNum(usage.thisMonth?.tokens)} {$i18n.t('tokens')}</span
					>
				</div>

				{#if usage.topup_url}
					<a
						href={usage.topup_url}
						target="_blank"
						rel="noopener noreferrer"
						class="mt-2 block w-full text-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 font-medium transition"
					>
						{$i18n.t('Top up')}
					</a>
				{/if}
			</div>
		{/if}

		<button
			class="rounded-full border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-md px-3 py-1.5 flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
			on:click={() => (open = !open)}
			title={$i18n.t('Usage & balance')}
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400">
				<path d="M1 4.25C1 3.56 1.56 3 2.25 3h11.5c.69 0 1.25.56 1.25 1.25v.5H1v-.5Z" />
				<path fill-rule="evenodd" d="M1 6.25v5.5C1 12.44 1.56 13 2.25 13h11.5c.69 0 1.25-.56 1.25-1.25v-5.5H1Zm9.5 3a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1-.75-.75Z" clip-rule="evenodd" />
			</svg>
			<span
				class="font-semibold {(usage.credits ?? 0) <= 0
					? 'text-red-500'
					: 'text-gray-700 dark:text-gray-200'}">{fmtUsd(usage.credits)}</span
			>
		</button>
	</div>
{/if}
