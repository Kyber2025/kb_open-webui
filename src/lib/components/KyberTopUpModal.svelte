<script lang="ts">
	// P5 (SESSION-HANDOFF §12.7): USDT top-up modal. User picks an amount + chain,
	// gets a deposit address + QR from the Java payment service (via KyberRouter),
	// pays USDT, and the wallet is auto-credited on confirmation. Polls status.
	import { getContext, createEventDispatcher, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Modal from '$lib/components/common/Modal.svelte';
	import { createKyberTopUp, getKyberTopUpStatus } from '$lib/apis/kyber';

	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher();

	export let show = false;

	const CHAINS = [
		{ id: '1', name: 'Ethereum (ERC20)' },
		{ id: '56', name: 'BSC (BEP20)' },
		{ id: '728126428', name: 'Tron (TRC20)' }
	];

	let step: 'amount' | 'pay' | 'done' = 'amount';
	let amount = 20;
	let chainId = '728126428';
	let creating = false;
	let topup: any = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	$: qrSrc = topup?.qrCodeImage
		? topup.qrCodeImage.startsWith('data:') || topup.qrCodeImage.startsWith('http')
			? topup.qrCodeImage
			: `data:image/png;base64,${topup.qrCodeImage}`
		: null;

	const stopPoll = () => {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = null;
	};

	const reset = () => {
		stopPoll();
		step = 'amount';
		topup = null;
		creating = false;
	};

	const create = async () => {
		if (!(amount > 0)) {
			toast.error($i18n.t('Enter an amount'));
			return;
		}
		creating = true;
		try {
			topup = await createKyberTopUp(localStorage.token, Number(amount), chainId);
			step = 'pay';
			pollTimer = setInterval(poll, 10000);
		} catch (e) {
			toast.error(`${e}`);
		} finally {
			creating = false;
		}
	};

	const poll = async () => {
		if (!topup?.id) return;
		try {
			const s = await getKyberTopUpStatus(localStorage.token, topup.id);
			if (s?.credited || s?.status === 'PAID') {
				stopPoll();
				step = 'done';
				dispatch('credited');
			}
		} catch (e) {
			// keep polling
		}
	};

	const copy = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast.success($i18n.t('Copied to clipboard'));
		} catch (e) {
			//
		}
	};

	const close = () => {
		show = false;
		reset();
	};

	onDestroy(stopPoll);
</script>

<Modal bind:show size="sm" on:close={reset}>
	<div class="p-5">
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-lg font-medium text-gray-800 dark:text-gray-100">{$i18n.t('Top up')}</h2>
			<button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" on:click={close}>✕</button>
		</div>

		{#if step === 'amount'}
			<label class="block text-xs text-gray-500 mb-1">{$i18n.t('Amount (USD)')}</label>
			<input
				type="number"
				min="1"
				bind:value={amount}
				class="w-full mb-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800 text-sm outline-none"
			/>
			<div class="flex gap-2 mb-4">
				{#each [10, 20, 50, 100] as a}
					<button
						class="flex-1 py-1.5 rounded-lg text-sm border {amount == a
							? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
							: 'border-gray-100 dark:border-gray-800 text-gray-500'}"
						on:click={() => (amount = a)}>${a}</button
					>
				{/each}
			</div>
			<label class="block text-xs text-gray-500 mb-1">{$i18n.t('Network')}</label>
			<div class="flex flex-col gap-1.5 mb-4">
				{#each CHAINS as c}
					<button
						class="text-left px-3 py-2 rounded-lg text-sm border {chainId === c.id
							? 'border-emerald-500'
							: 'border-gray-100 dark:border-gray-800'}"
						on:click={() => (chainId = c.id)}>{c.name}</button
					>
				{/each}
			</div>
			<button
				class="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium disabled:opacity-50"
				disabled={creating}
				on:click={create}
			>
				{creating ? $i18n.t('Creating...') : $i18n.t('Continue')}
			</button>
		{:else if step === 'pay'}
			<p class="text-xs text-gray-500 mb-3">
				{$i18n.t('Send exactly')} <span class="font-semibold text-gray-700 dark:text-gray-200">{topup?.usdtAmount} USDT</span>
				{$i18n.t('to the address below. Your balance updates automatically once confirmed on-chain.')}
			</p>
			{#if qrSrc}
				<img src={qrSrc} alt="QR" class="w-40 h-40 mx-auto mb-3 rounded-lg bg-white p-1" />
			{/if}
			<div
				class="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-100 dark:border-gray-800"
			>
				<span class="text-xs break-all text-gray-700 dark:text-gray-200 flex-1">{topup?.address}</span>
				<button class="text-emerald-600 text-xs shrink-0" on:click={() => copy(topup?.address)}
					>{$i18n.t('Copy')}</button
				>
			</div>
			<div class="flex items-center justify-center gap-2 text-xs text-gray-400">
				<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
				{$i18n.t('Waiting for payment...')}
			</div>
		{:else}
			<div class="text-center py-4">
				<div class="text-4xl mb-2">✅</div>
				<p class="font-medium text-gray-800 dark:text-gray-100">{$i18n.t('Top up successful')}</p>
				<p class="text-sm text-gray-500 mt-1">${topup?.amountUsd} {$i18n.t('added to your balance')}</p>
				<button class="mt-4 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white" on:click={close}
					>{$i18n.t('Done')}</button
				>
			</div>
		{/if}
	</div>
</Modal>
