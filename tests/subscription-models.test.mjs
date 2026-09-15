import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeModelIds, setModelSelected, configuredModelOptions } from '../src/lib/utils/subscription-models.js';

test('unchecking GPT-4o removes every historical alias and preserves other selections', () => {
	const saved = ['openai/gpt-4o', 'gpt-4o', ' OpenAI/GPT-4O ', 'claude-sonnet-5'];
	assert.deepEqual(normalizeModelIds(saved), ['gpt-4o', 'claude-sonnet-5']);
	assert.deepEqual(setModelSelected(saved, 'gpt-4o', false), ['claude-sonnet-5']);
});

test('models absent from the catalog remain visible and removable in the editor', () => {
	const options = configuredModelOptions([{ id: 'gpt-4o', name: 'GPT-4o' }], ['openai/gpt-4o', 'retired-model']);
	assert.equal(options.length, 2);
	assert.deepEqual(options[1], { id: 'retired-model', name: 'retired-model', unavailable: true });
	assert.deepEqual(setModelSelected(['retired-model', 'gpt-4o'], options[1].id, false), ['gpt-4o']);
});

test('explicit empty selection retains the existing all-models setting', () => {
	assert.deepEqual(normalizeModelIds(null), []);
	assert.deepEqual(setModelSelected([], 'OpenAI/GPT-4o', true), ['gpt-4o']);
});
