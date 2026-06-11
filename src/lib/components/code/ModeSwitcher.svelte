<script lang="ts">
	import { getContext } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	const i18n: any = getContext('i18n');

	// The "Code" i18n key is taken by the gift-card term ("兑换码" in zh), so this
	// toggle uses the dedicated "Coding" key (en: "Code", zh: "编码").

	// `chat` highlights on the chat surfaces (/, /c/...); `code` on /code.
	$: active = $page.url.pathname.startsWith('/code') ? 'code' : 'chat';
</script>

<div
	class="flex items-center gap-0.5 p-0.5 rounded-full bg-gray-100 dark:bg-gray-850 text-sm font-medium select-none"
>
	<button
		class="px-3 py-1 rounded-full transition flex items-center gap-1.5 {active === 'chat'
			? 'bg-white dark:bg-gray-700 shadow-sm'
			: 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}"
		on:click={() => active !== 'chat' && goto('/')}
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
			<path
				fill-rule="evenodd"
				d="M10 3c-4.31 0-8 2.69-8 6 0 1.4.65 2.69 1.74 3.7-.07.85-.37 1.74-.94 2.55a.5.5 0 0 0 .51.78c1.36-.31 2.42-.79 3.2-1.32C7.34 14.88 8.63 15 10 15c4.31 0 8-2.69 8-6s-3.69-6-8-6Z"
				clip-rule="evenodd"
			/>
		</svg>
		{$i18n.t('Chat')}
	</button>
	<button
		class="px-3 py-1 rounded-full transition flex items-center gap-1.5 {active === 'code'
			? 'bg-white dark:bg-gray-700 shadow-sm'
			: 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}"
		on:click={() => active !== 'code' && goto('/code')}
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
			<path
				fill-rule="evenodd"
				d="M7.28 5.22a.75.75 0 0 1 0 1.06L3.56 10l3.72 3.72a.75.75 0 0 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Zm5.44 0a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L16.44 10l-3.72-3.72a.75.75 0 0 1 0-1.06Z"
				clip-rule="evenodd"
			/>
		</svg>
		{$i18n.t('Coding')}
	</button>
</div>
