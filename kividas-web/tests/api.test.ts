import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { api, ApiError } from "../src/lib/api";
const fetchMock = vi.fn(),
  dispatch = vi.fn(),
  remove = vi.fn();
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => "test-token",
    removeItem: remove,
    setItem: vi.fn(),
  });
  vi.stubGlobal("window", { dispatchEvent: dispatch });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(
    async () =>
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("backend compatibility", () => {
  it("preserves null quota inheritance and explicit zero unlimited quotas", async () => {
    await api.saveTier({
      id: "pro",
      name: "Pro",
      description: "",
      price_usd: 90,
      duration_days: 30,
      token_limit_5h: null,
      token_limit_week: 0,
      extra_usage_multiplier: 1,
      allowed_model_ids: ["a"],
      enabled: true,
      sort_order: 0,
    });
    const [path, opts] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/v1/subscriptions/admin/tiers");
    expect(JSON.parse(opts.body)).toMatchObject({
      token_limit_5h: null,
      token_limit_week: 0,
    });
    expect(opts.headers.get("Authorization")).toBe("Bearer test-token");
  });
  it("distinguishes disabling a code from revoking its granted subscription", async () => {
    await api.cardStatus("AB/CD", false);
    await api.invalidateCard("AB/CD");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/subscriptions/admin/gift-cards/AB%2FCD/status",
      "/api/v1/subscriptions/admin/gift-cards/AB%2FCD/invalidate",
    ]);
  });
  it("includes search and status in the server-side gift card query", async () => {
    await api.giftCards("disabled", "ABC-123");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/subscriptions/admin/gift-cards?status_filter=disabled&search=ABC-123",
    );
  });
  it("sends gift generation duration and note as nullable fields", async () => {
    await api.generateCards({
      tier_id: "pro",
      count: 2,
      duration_days: null,
      note: null,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      tier_id: "pro",
      count: 2,
      duration_days: null,
      note: null,
    });
  });
  it("does not hide gateway synchronization errors", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: "Saved, but gateway synchronization failed. Retry.",
        }),
        { status: 503 },
      ),
    );
    await expect(api.tiers()).rejects.toThrow("gateway synchronization failed");
    expect(remove).not.toHaveBeenCalled();
  });
  it("expires rejected sessions but does not treat forbidden as expired", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Admin only" }), { status: 403 }),
    );
    await expect(api.tiers()).rejects.toBeInstanceOf(ApiError);
    expect(remove).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Expired" }), { status: 401 }),
    );
    await expect(api.me()).rejects.toThrow("Expired");
    expect(remove).toHaveBeenCalledWith("token");
    expect(dispatch).toHaveBeenCalledOnce();
  });
});

it("signs out using the backend POST endpoint", async () => {
  await api.logout();
  expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/auths/signout");
  expect(fetchMock.mock.calls[0][1].method).toBe("POST");
});
describe("conversation organization", () => {
  it("renames with a partial update so branches and attachments remain intact", async () => {
    await api.renameChat("chat/1", "New title");
    const [path, opts] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/v1/chats/chat%2F1");
    expect(JSON.parse(opts.body)).toEqual({ chat: { title: "New title" } });
  });
  it("uses backend pin, archive and project endpoints", async () => {
    await api.pinChat("a");
    await api.archiveChat("a");
    await api.moveChat("a", null);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/chats/a/pin",
      "/api/v1/chats/a/archive",
      "/api/v1/chats/a/folder",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      folder_id: null,
    });
  });
});

it("loads subscription plans and model previews using user-accessible endpoints", async () => {
  await api.plans();
  await api.planModels("max/20");
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    "/api/v1/subscriptions/tiers",
    "/api/v1/subscriptions/tiers/max%2F20/models",
  ]);
  expect(fetchMock.mock.calls.every((call) => !call[0].includes("/admin/"))).toBe(true);
});
