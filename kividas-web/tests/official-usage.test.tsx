// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UsageRing } from '../src/components/UsageRing';
import { UsageSettings } from '../src/components/UsageSettings';
import { AdminUsage, usageResetLabel } from '../src/components/AdminUsage';
import { resetLabel, usageResetDate } from '../src/lib/usage';
import { api } from '../src/lib/api';
vi.mock('../src/lib/api', () => ({ api: { usage: vi.fn(), subscription: vi.fn() } }));
const official = { linked: true, usageSource: 'official_cache' as const,
  officialUsage: { source: 'official_cache' as const, provider: 'claude' as const, bindingId: 'binding-1', observedAt: new Date(Date.now() - 1200000).toISOString(), stale: true },
  tp5h: { used: 60, limit: 100, unit: 'percent' as const, stopAt: 80, resetAt: Date.now() + 3600000 },
  tpw: { used: 25, limit: 100, unit: 'percent' as const, stopAt: 90, resetAt: Date.now() + 86400000 } };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(api.usage).mockResolvedValue(official);
  vi.mocked(api.subscription).mockResolvedValue({ tier: { name: 'Ultra' } } as any);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('preserves the existing user display without showing stop lines or sync times', async () => {
  await act(async () => root.render(<UsageRing />));
  expect(host.querySelector('button')!.getAttribute('aria-label')).toContain('60%');
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).not.toContain('Platform stops');
  expect(host.textContent).not.toContain('Official Claude');
  expect(host.textContent).not.toContain('Updated 20 min ago');
  expect(host.textContent).not.toContain('tokens');
});
it('keeps the previous usage when the next refresh has a cache gap', async () => {
  await act(async () => root.render(<UsageSettings billing={() => {}} />));
  expect(host.textContent).toContain('60% used');
  vi.mocked(api.usage).mockResolvedValue({ ...official, tp5h: { ...official.tp5h, used: null }, tpw: { ...official.tpw, used: null } });
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh usage"]')!.click());
  expect(host.textContent).toContain('60% used');
  expect(host.textContent).toContain('25% used');
  expect(host.textContent).not.toContain('Unavailable');
  expect(host.textContent).not.toContain('Platform stops');
  expect(host.textContent).not.toContain('Official Claude');
  expect([...host.querySelectorAll('.kvu-percent')].map(node => node.textContent)).not.toContain('0% used');
});
it('prevents local resets of official windows while leaving 5x reset controls', async () => {
  const onReset = vi.fn();
  await act(async () => root.render(<AdminUsage plan={{ kyber_linked: true, usage: official }} busy={false} onReset={onReset} />));
  expect(host.textContent).toContain('Official windows cannot be reset here');
  expect(host.querySelectorAll('button')).toHaveLength(0);
  expect(host.textContent).not.toContain('tokens');
  await act(async () => root.render(<AdminUsage plan={{ kyber_linked: true, usage: { tp5h: { used: 400, limit: 1000 } } }} busy={false} onReset={onReset} />));
  expect(host.textContent).toContain('400 / 1,000 tokens');
  expect(host.querySelectorAll('button').length).toBeGreaterThan(0);
});

it('removal hides session in settings and old cache cannot restore it', async () => {
  await act(async () => root.render(<UsageSettings billing={() => {}} />));
  expect(host.textContent).toContain('Current session');
  vi.mocked(api.usage).mockResolvedValue({ ...official, tp5h: { ...official.tp5h, supported: false, used: null } });
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh usage"]')!.click());
  expect(host.textContent).not.toContain('Current session');
  expect(host.textContent).not.toContain('60% used');
  expect(host.textContent).toContain('25% used');
});
it('the weekly ring and popup have no session for verified accounts', async () => {
  vi.mocked(api.usage).mockResolvedValue({ ...official, tp5h: { ...official.tp5h, supported: false, used: null } });
  await act(async () => root.render(<UsageRing />));
  expect(host.querySelector('button')!.getAttribute('aria-label')).toContain('25%');
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).not.toContain('Current session');
  expect(host.textContent).not.toContain('5 hours');
});

it('admin distinguishes an explicitly removed session limit from unavailable telemetry', async () => {
  const usage = { ...official, tp5h: { ...official.tp5h, supported: false, used: null, resetAt: null } };
  await act(async () => root.render(<AdminUsage plan={{ kyber_linked: true, usage }} busy={false} onReset={vi.fn()} />));
  expect(host.textContent).toContain('No 5-hour limit');
  expect(host.textContent).not.toContain('Usage unavailable');
  expect(host.querySelector('[role="progressbar"][aria-label="5-hour limit"]')).toBeNull();
  await act(async () => root.render(<AdminUsage plan={{ kyber_linked: true, usage: { ...usage, tp5h: { ...usage.tp5h, supported: true } } }} busy={false} onReset={vi.fn()} />));
  expect(host.textContent).toContain('Usage unavailable');
  expect(host.textContent).not.toContain('No 5-hour limit');
});

it('a missing official Fable observation shows no invented percentage or reset', async () => {
  const usage = { ...official, tpwFable: { used: null, limit: 100, unit: 'percent' as const, resetAt: null, stale: true } };
  await act(async () => root.render(<AdminUsage plan={{ kyber_linked: true, usage }} busy={false} onReset={vi.fn()} />));
  const fable = [...host.querySelectorAll('.admin-usage-window')].find(row => row.textContent?.includes('Weekly · Fable'))!;
  expect(fable.textContent).toContain('Usage unavailable');
  expect(fable.textContent).not.toContain('Resets ');
  expect(fable.textContent).not.toContain('0%');
  expect(fable.textContent).not.toContain('tokens');
});

it('official subsecond reset jitter does not display an entire minute early', () => {
  const exact = Date.parse('2026-11-14T07:00:00Z');
  const early = '2026-11-14T06:59:59.806201+00:00';
  const now = Date.parse('2026-11-10T03:00:00Z');
  expect(usageResetDate(early).getTime()).toBe(exact);
  expect(usageResetDate(exact / 1000).getTime()).toBe(exact);
  expect(usageResetLabel(early, false, now)).toBe(usageResetLabel(exact, false, now));
  expect(resetLabel(early, now)).toBe(resetLabel(exact, now));
  expect(usageResetLabel(exact - 60_000, false, now)).not.toBe(usageResetLabel(exact, false, now));
});
