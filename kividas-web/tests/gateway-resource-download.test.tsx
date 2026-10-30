// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { GatewayResources } from '../src/components/GatewayResources';
import { gatewayResources } from '../src/lib/gateway';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('downloads through the authenticated account endpoint without a public original-file link', async () => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => new Response(new Blob(['%PDF-test'])));
  vi.stubGlobal('fetch', fetch);
  localStorage.setItem('token', 'subscriber-test-session');
  const createObjectURL = vi.fn(() => 'blob:account-resource');
  vi.stubGlobal('URL', {createObjectURL, revokeObjectURL:vi.fn()});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<GatewayResources />));
    expect(host.querySelector('a[href^="/gateway/"]')).toBeNull();
    const buttons = [...host.querySelectorAll('button')];
    for (const [i, resource] of gatewayResources.entries()) {
      await act(async () => buttons[i].click());
      expect(fetch.mock.calls.at(-1)?.[0]).toBe(`/api/v1/kyber/gateway/resources/${resource.file}`);
      const options = (fetch.mock.calls.at(-1) as any)[1];
      expect(options.headers.get('Authorization')).toBe('Bearer subscriber-test-session');
      expect(options.credentials).toBe('include');
    }
    expect(click).toHaveBeenCalledTimes(4);
  } finally { await act(async () => root.unmount()); host.remove(); localStorage.clear(); }
});
