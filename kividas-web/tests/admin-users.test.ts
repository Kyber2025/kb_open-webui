import { describe, it, expect, vi, afterEach } from "vitest";
import { usersApi, usagePercent, syncWarning } from "../src/lib/admin-users";
afterEach(() => vi.unstubAllGlobals());
describe("user administration contracts", () => {
  it("combines source, agent, plan and search in the server-side paginated request", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"users":[],"total":0}', {headers:{'Content-Type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock); vi.stubGlobal('localStorage',{getItem:()=> 'test-token'});
    await usersApi.list(2,'customer','name','asc','pro',10,'reseller','agent/a');
    const params = new URL(String(fetchMock.mock.calls[0][0]),'https://example.test').searchParams;
    expect(Object.fromEntries(params)).toEqual({page:'2',query:'customer',order_by:'name',direction:'asc',plan:'pro',limit:'10',source:'reseller',reseller_invite_id:'agent/a'});
  });
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
