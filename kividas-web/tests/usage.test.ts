import { describe, expect, it } from "vitest";
import { resetLabel, usageSummary, windowPercent, type UsageLimits } from "../src/lib/usage";
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
});
