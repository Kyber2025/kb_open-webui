import { describe, it, expect, vi, afterEach } from "vitest";
import { usersApi, usagePercent, syncWarning } from "../src/lib/admin-users";
afterEach(() => vi.unstubAllGlobals());
describe("user administration contracts", () => {
  it("keeps unlimited usage distinct from an empty quota", () => {
    expect(usagePercent({ used: 100, limit: 0 })).toBeNull();
    expect(usagePercent({ used: 100, limit: 200 })).toBe(50);
  });
  it("reports a partial gateway sync failure after a saved plan", () => {
    expect(
      syncWarning({
        token_billing_enabled: true,
        kyber_linked: true,
        rate_limits_synced: false,
      }),
    ).toContain("not synchronized");
    expect(syncWarning({ rate_limits_synced: true })).toBeNull();
  });
  it("sends user ids in one overview request and preserves explicit expiry", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", { headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", { getItem: () => "test-token" });
    await usersApi.overview(["a", "b"]);
    await usersApi.setPlan("a/b", { tier_id: "max", expires_at: 2000000000 });
    await usersApi.reset("a/b", ["fable"]);
    await usersApi.reset("a/b", ["5h", "week"]);
    expect(
      fetchMock.mock.calls.map((call: any) => [
        call[0],
        JSON.parse(call[1].body),
      ]),
    ).toEqual([
      ["/api/v1/subscriptions/admin/users/overview", { user_ids: ["a", "b"] }],
      [
        "/api/v1/subscriptions/admin/users/a%2Fb/subscription",
        { tier_id: "max", expires_at: 2000000000 },
      ],
      [
        "/api/v1/subscriptions/admin/users/a%2Fb/usage/reset",
        { windows: ["fable"] },
      ],
      [
        "/api/v1/subscriptions/admin/users/a%2Fb/usage/reset",
        { windows: ["5h", "week"] },
      ],
    ]);
  });
  it("uses the dedicated cross-service ban endpoint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", { headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", { getItem: () => "test-token" });
    await usersApi.ban("a", true, "Review required");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/users/a/ban",
      expect.objectContaining({
        body: JSON.stringify({ banned: true, reason: "Review required" }),
      }),
    );
  });
});
