// Shared by initial loading, subscription changes and window focus. Only the
// newest request for the current login may publish the account model catalog.
/**
 * @template Model
 * @param {{
 *   getToken: () => string | undefined,
 *   getConnections: () => object | null,
 *   fetchModels: (token: string, connections: object | null, base: boolean, refresh: boolean) => Promise<Model[]>,
 *   publish: (models: Model[]) => void
 * }} dependencies
 */
export function createModelRefresher({ getToken, getConnections, fetchModels, publish }) {
	let revision = 0;
	return async () => {
		const current = ++revision;
		const token = getToken();
		if (!token) return;
		const models = await fetchModels(token, getConnections(), false, true);
		if (current === revision && token === getToken()) publish(models);
	};
}
