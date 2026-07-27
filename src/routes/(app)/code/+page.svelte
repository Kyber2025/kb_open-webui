<script>
	import { getContext, onMount } from 'svelte';

	const i18n = getContext('i18n');

	import { showSidebar } from '$lib/stores';
	import {
		WEBUI_API_BASE_URL,
		KIVIDAS_CODE_VERSION,
		KIVIDAS_CODE_DOWNLOAD_URL,
		KIVIDAS_CODE_MAC_VERSION,
		KIVIDAS_CODE_MAC_DOWNLOAD_URL
	} from '$lib/constants';
	import Sidebar from '$lib/components/icons/Sidebar.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Code from '$lib/components/icons/Code.svelte';

	// Latest installer per platform, from the desktop release feed (proxied server-side
	// to dodge CORS); fall back to the bundled constants if the feed is unreachable.
	// Each platform carries its own version — a release that ships only one platform
	// must not blank out the other one's download.
	let windowsBuild = { version: KIVIDAS_CODE_VERSION, url: KIVIDAS_CODE_DOWNLOAD_URL };
	let macBuild = { version: KIVIDAS_CODE_MAC_VERSION, url: KIVIDAS_CODE_MAC_DOWNLOAD_URL };

	// Offer the visitor's own platform first; the other one stays available below it.
	let isMac = false;

	onMount(async () => {
		isMac = /Mac/.test(navigator.platform ?? '') || /Mac OS X/.test(navigator.userAgent ?? '');

		try {
			const res = await fetch(`${WEBUI_API_BASE_URL}/code/latest`, {
				headers: { Authorization: `Bearer ${localStorage.token}` }
			});
			if (res.ok) {
				const d = await res.json();
				const platforms = d?.platforms ?? {};
				if (platforms.windows?.version && platforms.windows?.url) {
					windowsBuild = platforms.windows;
				} else if (d?.version && d?.url) {
					// Response from the pre-platforms endpoint: the top-level pair is Windows.
					windowsBuild = { version: d.version, url: d.url };
				}
				if (platforms.mac?.version && platforms.mac?.url) {
					macBuild = platforms.mac;
				}
			}
		} catch (e) {
			// keep the fallback constants
		}
	});
</script>

<svelte:head>
	<title>Kividas Code</title>
</svelte:head>

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
		<div class="text-lg font-medium">Kividas Code</div>
	</div>

	<div class="flex-1 overflow-y-auto px-4 md:px-8 py-6">
		<div class="max-w-xl mx-auto w-full">
			<div
				class="flex flex-col items-center text-center rounded-2xl border border-gray-100 dark:border-gray-800 p-8"
			>
				<div
					class="flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-850 mb-4"
				>
					<Code className="size-8" strokeWidth="2" />
				</div>

				<div class="text-2xl font-semibold">Kividas Code</div>
				<div class="mt-2 text-sm text-gray-500">
					{$i18n.t('AI coding desktop client for Windows and macOS.')}
				</div>

				<div class="mt-6 w-full flex flex-col items-center gap-4">
					{#each isMac ? ['mac', 'windows'] : ['windows', 'mac'] as platform, i (platform)}
						{@const build = platform === 'mac' ? macBuild : windowsBuild}
						<div class="w-full max-w-xs flex flex-col items-center gap-1.5">
							<a
								href={build.url}
								download
								class="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-medium hover:opacity-90 transition {i ===
								0
									? 'bg-black text-white dark:bg-white dark:text-black'
									: 'border border-gray-200 dark:border-gray-700'}"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									class="size-5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-6L12 15m0 0 4.5-4.5M12 15V3"
									/>
								</svg>
								{platform === 'mac'
									? $i18n.t('Download for macOS (.dmg)')
									: $i18n.t('Download for Windows (.exe)')}
							</a>
							<div class="text-xs text-gray-400">
								{#if platform === 'mac'}
									{$i18n.t('Apple Silicon')} · {$i18n.t('Version {{version}}', {
										version: build.version
									})}
								{:else}
									{$i18n.t('Version {{version}}', { version: build.version })}
								{/if}
							</div>
						</div>
					{/each}
				</div>

				<div class="mt-6 max-w-sm text-xs text-gray-400 leading-relaxed">
					<div>
						{$i18n.t(
							'macOS may report the app as "damaged" on first install. Drag it into Applications, then run this in Terminal and open it again:'
						)}
					</div>
					<code
						class="mt-1.5 inline-block px-2 py-1 rounded bg-gray-100 dark:bg-gray-850 text-[11px] text-gray-500 select-all break-all"
					>
						sudo xattr -rd com.apple.quarantine "/Applications/Kividas Code.app"
					</code>
				</div>
			</div>
		</div>
	</div>
</div>
