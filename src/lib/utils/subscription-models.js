// Keep provider aliases consistent with the subscription gateway and preview API.
export const canonicalModelId = (id) => id.trim().toLowerCase().replace(/^[^/]*\//, '');

export const normalizeModelIds = (ids) => [...new Set((ids ?? []).map(canonicalModelId))];

export function setModelSelected(ids, modelId, selected) {
	const values = new Set(normalizeModelIds(ids));
	const id = canonicalModelId(modelId);
	if (selected) values.add(id);
	else values.delete(id);
	return [...values];
}

export function configuredModelOptions(catalog, selectedIds) {
	const options = new Map(catalog.filter((m) => m?.id).map((m) => [
		canonicalModelId(m.id), { ...m, id: canonicalModelId(m.id), unavailable: false }
	]));
	for (const id of normalizeModelIds(selectedIds)) {
		if (!options.has(id)) options.set(id, { id, name: id, unavailable: true });
	}
	return [...options.values()];
}
