<script>
	import { createEventDispatcher, getContext } from 'svelte';
	import { toast } from 'svelte-sonner';

	import dayjs from 'dayjs';
	import relativeTime from 'dayjs/plugin/relativeTime';
	import localizedFormat from 'dayjs/plugin/localizedFormat';
	dayjs.extend(relativeTime);
	dayjs.extend(localizedFormat);

	import {
		getAdminTiers,
		getAdminUsersOverview,
		resetUserUsage,
		revokeUserSubscription,
		setUserSubscription
	} from '$lib/apis/subscriptions';

	import Modal from '$lib/components/common/Modal.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher();

	export let show = false;
	export let selectedUser;

	const DEFAULT_TIER_ID = 'free';

	let loading = true;
	let saving = false;
	let resetting = '';

	let tiers = [];
	let state = null; // { tier, subscription, expires_at, kyber_linked, usage }

	let tierId = DEFAULT_TIER_ID;
	let expiresAtLocal = ''; // 'YYYY-MM-DDTHH:mm' in the admin's own timezone

	$: if (show && selectedUser) {
		load();
	}

	// The expiry field only applies to a paid plan — Free is the absence of one.
	$: isFree = tierId === DEFAULT_TIER_ID;
	$: selectedTier = tiers.find((t) => t.id === tierId) ?? null;

	// Moving a user onto a paid plan shouldn't require typing a date: prefill the
	// tier's own term. Only fills a BLANK field, so it never overwrites an edit.
	$: if (!loading && !isFree && !expiresAtLocal) {
		expiresAtLocal = dayjs()
			.add(selectedTier?.duration_days ?? 30, 'day')
			.format('YYYY-MM-DDTHH:mm');
	}

	const toLocalInput = (epochSeconds) =>
		epochSeconds ? dayjs(epochSeconds * 1000).format('YYYY-MM-DDTHH:mm') : '';

	const load = async () => {
		loading = true;
		state = null;

		const [tierList, overview] = await Promise.all([
			getAdminTiers(localStorage.token).catch(() => []),
			getAdminUsersOverview(localStorage.token, [selectedUser.id]).catch((e) => {
				toast.error(`${e}`);
				return null;
			})
		]);

		tiers = tierList ?? [];
		state = overview?.users?.[selectedUser.id] ?? null;

		tierId = state?.subscription?.tier_id ?? state?.tier?.id ?? DEFAULT_TIER_ID;
		// Blank for a user with no active row — the reactive prefill above fills in the
		// tier's term once loading clears.
		expiresAtLocal = toLocalInput(state?.expires_at);
		loading = false;
	};

	/** Shift the expiry by N days from the LATER of "now" and the current expiry, so
	 * "+30 days" extends a live plan instead of silently shortening it. */
	const extend = (days) => {
		const base = dayjs(expiresAtLocal || undefined);
		const from = base.isValid() && base.isAfter(dayjs()) ? base : dayjs();
		expiresAtLocal = from.add(days, 'day').format('YYYY-MM-DDTHH:mm');
	};

	/** Surface the one failure mode this panel exists to catch: the plan is stored here,
	 * but KyberRouter — which owns the limiter and the usage ring — never took the caps. */
	const reportSync = (res) => {
		if (res?.token_billing_enabled && res?.kyber_linked && res?.rate_limits_synced === false) {
			toast.warning(
				$i18n.t(
					'Plan saved, but the new limits were not accepted by the account service. The user keeps their previous caps until it is re-synced.'
				)
			);
		}
	};

	const applyResult = (res) => {
		state = res;
		tierId = res?.subscription?.tier_id ?? res?.tier?.id ?? DEFAULT_TIER_ID;
		expiresAtLocal = toLocalInput(res?.expires_at);
		dispatch('save');
	};

	const submitHandler = async () => {
		if (isFree) {
			await revokeHandler();
			return;
		}

		const expiry = dayjs(expiresAtLocal);
		if (!expiresAtLocal || !expiry.isValid()) {
			toast.error($i18n.t('Please choose an expiry date'));
			return;
		}
		if (!expiry.isAfter(dayjs())) {
			toast.error($i18n.t('Expiry must be in the future'));
			return;
		}

		saving = true;
		const res = await setUserSubscription(localStorage.token, selectedUser.id, {
			tier_id: tierId,
			expires_at: expiry.unix()
		}).catch((e) => {
			toast.error(`${e}`);
			return null;
		});
		saving = false;

		if (res) {
			applyResult(res);
			reportSync(res);
			toast.success($i18n.t('Plan updated'));
		}
	};

	const revokeHandler = async () => {
		saving = true;
		const res = await revokeUserSubscription(localStorage.token, selectedUser.id).catch((e) => {
			toast.error(`${e}`);
			return null;
		});
		saving = false;

		if (res) {
			applyResult(res);
			reportSync(res);
			toast.success($i18n.t('Subscription revoked'));
		}
	};

	const resetHandler = async (windows) => {
		resetting = windows?.[0] ?? 'all';
		const res = await resetUserUsage(localStorage.token, selectedUser.id, windows).catch((e) => {
			toast.error(`${e}`);
			return null;
		});
		resetting = '';

		if (res) {
			state = { ...state, ...res };
			dispatch('save');
			toast.success($i18n.t('Usage reset'));
		}
	};

	const compact = new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1
	});

	// limit 0 (or missing) = unlimited by KyberRouter's convention → no percentage.
	const percent = (w) =>
		w && w.limit > 0 ? Math.min(100, Math.round((w.used / w.limit) * 1000) / 10) : null;

	const barClass = (p) =>
		p === null
			? 'bg-gray-400'
			: p >= 90
				? 'bg-red-500'
				: p >= 70
					? 'bg-yellow-500'
					: 'bg-green-500';
</script>

<Modal size="sm" bind:show>
	<div class="dark:text-gray-200">
		<div class="flex justify-between px-5 pt-4 pb-2">
			<div class="text-lg font-medium self-center">{$i18n.t('Plan & Usage')}</div>
			<button
				class="self-center"
				aria-label={$i18n.t('Close')}
				on:click={() => {
					show = false;
				}}
			>
				<XMark className={'size-5'} />
			</button>
		</div>

		<div class="px-5 pb-5">
			<div class="text-xs text-gray-500 mb-3 truncate">
				{selectedUser?.name}
				<span class="text-gray-400">·</span>
				{selectedUser?.email}
			</div>

			{#if loading}
				<div class="my-10 flex justify-center">
					<Spinner className="size-5" />
				</div>
			{:else}
				<!-- ── Plan ─────────────────────────────────────────── -->
				<div class="flex flex-col gap-2">
					<div class="flex gap-2">
						<div class="flex flex-col flex-1 min-w-0">
							<div class="mb-1 text-xs text-gray-500">{$i18n.t('Plan')}</div>
							<select
								class="w-full text-sm bg-transparent border border-gray-100 dark:border-gray-800 rounded-lg px-2.5 py-2 outline-hidden"
								bind:value={tierId}
							>
								{#each tiers as tier (tier.id)}
									<option value={tier.id} class="dark:bg-gray-900">
										{tier.name}{tier.enabled ? '' : ` (${$i18n.t('Disabled')})`}
									</option>
								{/each}
							</select>
						</div>

						<div class="flex flex-col flex-1 min-w-0">
							<div class="mb-1 text-xs text-gray-500">{$i18n.t('Expires at')}</div>
							<input
								class="w-full text-sm bg-transparent border border-gray-100 dark:border-gray-800 rounded-lg px-2.5 py-2 outline-hidden disabled:opacity-40"
								type="datetime-local"
								disabled={isFree}
								bind:value={expiresAtLocal}
							/>
						</div>
					</div>

					{#if isFree}
						<div class="text-xs text-gray-500">
							{$i18n.t('The free plan has no expiry — saving revokes any active subscription.')}
						</div>
					{:else}
						<div class="flex items-center gap-1.5 text-xs">
							<span class="text-gray-500">{$i18n.t('Extend')}</span>
							{#each [30, 90, 365] as days}
								<button
									class="px-2 py-0.5 rounded-lg bg-gray-50 dark:bg-gray-850 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
									on:click={() => extend(days)}
								>
									+{days}d
								</button>
							{/each}
							{#if expiresAtLocal && dayjs(expiresAtLocal).isValid()}
								<span class="text-gray-500 truncate">
									({dayjs(expiresAtLocal).fromNow()})
								</span>
							{/if}
						</div>
						{#if selectedTier}
							<div class="text-xs text-gray-500">
								{$i18n.t('Caps')}: {selectedTier.token_limit_5h
									? compact.format(selectedTier.token_limit_5h)
									: '∞'} / 5h · {selectedTier.token_limit_week
									? compact.format(selectedTier.token_limit_week)
									: '∞'} / {$i18n.t('week')}
							</div>
						{/if}
					{/if}

					<div class="flex justify-end gap-2 mt-1">
						{#if state?.subscription}
							<button
								class="px-3 py-1.5 text-sm rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-850 transition disabled:opacity-50"
								disabled={saving}
								on:click={revokeHandler}
							>
								{$i18n.t('Revoke')}
							</button>
						{/if}
						<button
							class="px-3 py-1.5 text-sm rounded-lg bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition disabled:opacity-50"
							disabled={saving}
							on:click={submitHandler}
						>
							{saving ? $i18n.t('Saving...') : $i18n.t('Save')}
						</button>
					</div>
				</div>

				<hr class="border-gray-50 dark:border-gray-850 my-4" />

				<!-- ── Usage ────────────────────────────────────────── -->
				<div class="flex items-center justify-between mb-2">
					<div class="text-xs text-gray-500">{$i18n.t('Token usage')}</div>
					{#if state?.usage}
						<button
							class="text-xs px-2 py-0.5 rounded-lg bg-gray-50 dark:bg-gray-850 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50"
							disabled={resetting !== ''}
							on:click={() => resetHandler(['5h', 'week'])}
						>
							{$i18n.t('Reset both')}
						</button>
					{/if}
				</div>

				{#if !state?.kyber_linked}
					<div class="text-xs text-gray-500">
						{$i18n.t('This user is not linked to a wallet yet, so there is no usage to show.')}
					</div>
				{:else if !state?.usage}
					<div class="text-xs text-gray-500">
						{$i18n.t('Usage is unavailable — the account service did not respond.')}
					</div>
				{:else}
					{#each [{ key: '5h', label: $i18n.t('5-hour window'), window: state.usage.tp5h }, { key: 'week', label: $i18n.t('Weekly window'), window: state.usage.tpw }] as row (row.key)}
						{@const p = percent(row.window)}
						<div class="mb-3">
							<div class="flex items-center justify-between text-xs mb-1">
								<div class="text-gray-500">{row.label}</div>
								<div class="flex items-center gap-2">
									<span class="font-medium">
										{compact.format(row.window?.used ?? 0)}
										{#if row.window?.limit > 0}
											/ {compact.format(row.window.limit)}
											<span class="text-gray-500">({p}%)</span>
										{:else}
											<span class="text-gray-500">/ ∞</span>
										{/if}
									</span>
									<button
										class="px-2 py-0.5 rounded-lg bg-gray-50 dark:bg-gray-850 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50"
										disabled={resetting !== ''}
										on:click={() => resetHandler([row.key])}
									>
										{$i18n.t('Reset')}
									</button>
								</div>
							</div>
							<div class="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-850 overflow-hidden">
								<div
									class="h-full rounded-full {barClass(p)}"
									style="width: {p === null ? 0 : p}%"
								></div>
							</div>
							<div class="text-[10px] text-gray-500 mt-0.5">
								{#if row.window?.resetAt}
									{$i18n.t('Resets')}
									{dayjs(row.window.resetAt).fromNow()}
								{:else}
									{$i18n.t('Window not started')}
								{/if}
							</div>
						</div>
					{/each}

					{#if state.usage.subscriptionManaged === false}
						<Tooltip
							content={$i18n.t(
								'The account service is not treating this user as subscription-managed, so the plan caps above are not what it enforces.'
							)}
						>
							<div class="text-xs text-yellow-600 dark:text-yellow-400">
								⚠ {$i18n.t('Not subscription-managed')}
							</div>
						</Tooltip>
					{/if}
				{/if}
			{/if}
		</div>
	</div>
</Modal>
