<script lang="ts">
	import { getContext } from 'svelte';
	export let window: { used: number; limit: number; resetAt: number | null } | null = null;
	export let reset = '';
	const i18n = getContext('i18n');
	$: valid =
		window &&
		Number.isFinite(window.used) &&
		window.used >= 0 &&
		Number.isFinite(window.limit) &&
		window.limit > 0;
	$: percent = valid ? Math.min(100, Math.round((window!.used / window!.limit) * 100)) : 0;
</script>

{#if window}
	<div class="py-1">
		<div class="flex items-baseline justify-between gap-3">
			<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Weekly · Fable')}</span>
			<span class="text-gray-700 dark:text-gray-200"
				>{valid ? `${percent}%` : $i18n.t('Unavailable')}</span
			>
		</div>
		{#if valid}
			<div
				class="mt-1 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
				role="progressbar"
				aria-label={$i18n.t('Weekly · Fable')}
				aria-valuenow={percent}
				aria-valuemin="0"
				aria-valuemax="100"
			>
				<div
					class="h-full rounded-full {percent >= 90
						? 'bg-red-500'
						: percent >= 80
							? 'bg-amber-500'
							: 'bg-blue-500'}"
					style="width: {percent}%"
				></div>
			</div>
			{#if reset}<div class="mt-0.5 text-[10px] text-gray-400">{reset}</div>{/if}
		{/if}
	</div>
{/if}
