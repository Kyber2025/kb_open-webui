import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gatewayApi, gatewayResources } from '../src/lib/gateway';
afterEach(() => vi.unstubAllGlobals());
describe('subscriber Gateway downloads', () => {
  it('uses only the current-session endpoints and never sends a user id or policy', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('localStorage', {getItem: () => 'subscriber-session'});
    await gatewayApi.status(); await gatewayApi.create('My Mac'); await gatewayApi.download('key/a'); await gatewayApi.download('key/a');
    expect(fetch.mock.calls.map((call:any) => call[0])).toEqual([
      '/api/v1/kyber/gateway', '/api/v1/kyber/gateway/keys', '/api/v1/kyber/gateway/keys/key%2Fa/download', '/api/v1/kyber/gateway/keys/key%2Fa/download',
    ]);
    expect(JSON.parse((fetch.mock.calls[1] as any)[1].body)).toEqual({label:'My Mac'});
    expect(JSON.parse((fetch.mock.calls[2] as any)[1].body)).toEqual({});
    expect(Object.keys(gatewayApi)).toEqual(['status', 'create', 'download']);
  });
  it('puts the one-click setup first with the only recommended badge', () => {
    expect(gatewayResources[0]).toMatchObject({ id: 'setup', title: '一键配置', badge: '推荐', format: 'ZIP' });
    expect(gatewayResources.filter(resource => resource.badge)).toHaveLength(1);
  });
  it('ships actual PDF and ZIP files at every download link', () => {
    expect(gatewayResources).toHaveLength(4);
    for (const resource of gatewayResources) {
      const bytes = readFileSync(new URL(`../public/gateway/${resource.file}`, import.meta.url));
      expect(bytes.subarray(0, resource.format === 'PDF' ? 4 : 2).toString()).toBe(resource.format === 'PDF' ? '%PDF' : 'PK');
    }
  });
});
