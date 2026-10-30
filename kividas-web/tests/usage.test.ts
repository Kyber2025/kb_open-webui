import { describe, expect, it } from "vitest";
import { resetLabel, usageSummary, windowPercent, usageWindowDetail, officialCacheNote, retainLastUsage, type UsageLimits } from "../src/lib/usage";
const now = Date.parse("2026-10-22T03:00:00Z");
const base: UsageLimits = {
  linked: true,
  tp5h: { used: 25, limit: 100 },
  tpw: { used: 10, limit: 100 },
  sharedAccount: { seats: 2, stale: false, observedAt: new Date(now).toISOString(), fiveHour: { usedPercent: 80 }, sevenDay: { usedPercent: 45 } },
};
describe("usage data shown to the signed-in user", () => {
  it("never turns missing, invalid, unlimited or unlinked data into zero usage", () => {
    expect(windowPercent()).toBeNull();
    expect(windowPercent({ used: 0, limit: 0 })).toBeNull();
    expect(windowPercent({ used: NaN, limit: 100 })).toBeNull();
    expect(windowPercent({ used: -1, limit: 100 })).toBeNull();
    expect(usageSummary({ ...base, linked: false }).percent).toBeNull();
    expect(windowPercent({ used: 0, limit: 100 })).toBe(0);
  });
  it("preserves a real overage for text while allowing the view to cap bar width", () => {
    expect(windowPercent({ used: 115, limit: 100 })).toBe(115);
  });
  it('uses server-selected official 20x percentages without relabelling them as tokens', () => {
    const official: UsageLimits = { linked: true, usageSource: 'official_cache',
      tp5h: { used: 65.5, limit: 100, unit: 'percent', stopAt: 80 },
      tpw: { used: 30, limit: 100, unit: 'percent', stopAt: 90 } };
    expect(usageSummary(official).percent).toBe(65.5);
    expect(usageWindowDetail(official.tp5h)).toBe('Official Claude usage: 65.5% · Platform stops at 80%');
    expect(windowPercent({ used: null, limit: 100, unit: 'percent' })).toBeNull();
    expect(usageWindowDetail({ used: null, limit: 100, unit: 'percent' })).toBe('Unavailable');
    expect(usageWindowDetail(base.tp5h)).toBe('25 / 100 tokens');
  });
  it('reports the server observation age rather than making every refresh look fresh', () => {
    expect(officialCacheNote({ source: 'official_cache', provider: 'claude', observedAt: new Date(now - 1200000).toISOString(), stale: true }, now))
      .toBe('Showing the last official Claude reading · Updated 20 min ago.');
    expect(officialCacheNote({ source: 'official_cache', provider: 'claude', observedAt: null, stale: true }, now))
      .toBe('Official Claude usage is awaiting an update.');
  });
  it('retains previous usage only for the same allocation', () => {
    const previous: UsageLimits = { ...base, officialUsage: { source: 'official_cache' as const, provider: 'claude' as const, bindingId: 'a', observedAt: new Date(now).toISOString(), stale: false } };
    const missing = { ...previous, tp5h: { used: null, limit: 100 }, tpw: { used: null, limit: 100 } };
    expect(retainLastUsage(previous, missing).tp5h?.used).toBe(25);
    expect(retainLastUsage(previous, { ...missing, officialUsage: { ...missing.officialUsage!, bindingId: 'b' } }).tp5h?.used).toBeNull();
    expect(retainLastUsage(previous, { ...missing, officialUsage: null }).tp5h?.used).toBeNull();
  });
  it("shows only the user's platform use even when the shared account is nearly full", () => {
    expect(usageSummary(base).percent).toBe(25);
    expect(usageSummary({ ...base, sharedAccount: { ...base.sharedAccount!, seats: 1, fiveHour: { usedPercent: 99 } } }).percent).toBe(25);
  });
  it("never substitutes account totals when the user's counters are unavailable", () => {
    expect(usageSummary({ linked: true, sharedAccount: base.sharedAccount }).percent).toBeNull();
    expect(usageSummary({ ...base, sharedAccount: { ...base.sharedAccount!, stale: true } }).percent).toBe(25);
  });
  it("uses the organization seat allowance without mixing personal or upstream limits", () => {
    expect(usageSummary({ ...base, enterprise: { used: 12, quota: 100 } }).percent).toBe(12);
  });
  it("includes the user's Fable limit when it is more restrictive", () => {
    expect(usageSummary({ ...base, tpwFable: { used: 92, limit: 100 } }).percent).toBe(92);
  });
  it("supports seconds, milliseconds and ISO reset times, without inventing resets", () => {
    expect(resetLabel((now + 3600000) / 1000, now)).toBe("Resets in 1 hr 0 min");
    expect(resetLabel(now + 3600000, now)).toBe("Resets in 1 hr 0 min");
    expect(resetLabel(new Date(now + 3600000).toISOString(), now)).toBe("Resets in 1 hr 0 min");
    expect(resetLabel(null, now)).toBe("Reset time unavailable");
    expect(resetLabel(now - 1000, now)).toBe("Awaiting reset update");
  });
  it("labels later resets in English whatever the browser locale", () => {
    expect(resetLabel(now + 3 * 86400000, now)).toMatch(/^Resets (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2}\s[AP]M$/);
  });
});
