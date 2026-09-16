import { get } from 'svelte/store';
import { getModels } from '$lib/apis';
import { config, models, settings } from '$lib/stores';
import type { Model } from '$lib/stores';
import { createModelRefresher } from './model-refresh.js';

export const refreshAccountModels = createModelRefresher<Model>({
	getToken: () => localStorage.token,
	getConnections: () =>
		get(config)?.features?.enable_direct_connections
			? (get(settings)?.directConnections ?? null)
			: null,
	fetchModels: getModels,
	publish: (catalog) => models.set(catalog)
});
