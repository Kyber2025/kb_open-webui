import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModelRefresher } from '../src/lib/utils/model-refresh.js';

test('paid catalog wins when the pre-redemption Free response arrives last', async () => {
	const pending = [], published = [];
	const connections = { OPENAI_API_BASE_URLS: ['https://local.invalid'] };
	const refresh = createModelRefresher({
		getToken: () => 'same-login', getConnections: () => connections,
		fetchModels: (...args) => {
			assert.deepEqual(args, ['same-login', connections, false, true]);
			return new Promise(resolve => pending.push(resolve));
		}, publish: rows => published.push(rows)
	});
	const old = refresh(), activated = refresh();
	pending[1]([{ id: 'claude-opus-5' }]); await activated;
	pending[0]([{ id: 'gpt-5.2' }]); await old;
	assert.deepEqual(published, [[{ id: 'claude-opus-5' }]]);
});

test('account change discards old models; authoritative empty catalog clears them', async () => {
	let token = 'first', release;
	const published = [];
	const refresh = createModelRefresher({ getToken: () => token, getConnections: () => null,
		fetchModels: () => new Promise(resolve => release = resolve), publish: rows => published.push(rows) });
	const old = refresh(); token = 'second'; release([{ id: 'private-model' }]); await old;
	assert.deepEqual(published, []);
	const fresh = refresh(); release([]); await fresh;
	assert.deepEqual(published, [[]]);
});

test('network error preserves catalog and a subsequent refresh recovers without login', async () => {
	let offline = true;
	const published = [];
	const refresh = createModelRefresher({ getToken: () => 'same-login', getConnections: () => null,
		fetchModels: async () => { if (offline) throw Error('offline'); return [{ id: 'paid' }]; },
		publish: rows => published.push(rows) });
	await assert.rejects(refresh(), /offline/); assert.deepEqual(published, []);
	offline = false; await refresh(); assert.deepEqual(published, [[{ id: 'paid' }]]);
});
