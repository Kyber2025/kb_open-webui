import { describe, it, expect } from "vitest";
import {
  activeMessages,
  canonicalId,
  chatPayload,
  csvRows,
  guestModelAllowed,
  guestPolicy,
  modelOptions,
  normalizeIds,
  sseEvents,
} from "../src/lib/domain";
import type { ChatData, GuestConfig, Message } from "../src/lib/types";
const models = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
];
const cfg: GuestConfig = {
  ENABLE_GUEST_ACCESS: true,
  GUEST_DAILY_LIMIT: 5,
  GUEST_ALLOWED_MODEL_IDS: [],
  GUEST_BLOCKED_MODEL_IDS: [],
};
describe("subscription policies", () => {
  it("normalizes provider aliases and duplicates", () =>
    expect(
      normalizeIds(["Provider/Claude-Opus", "claude-opus", " GPT-5 "]),
    ).toEqual(["claude-opus", "gpt-5"]));
  it("retains unavailable models while editing a plan", () =>
    expect(
      modelOptions([{ id: "vendor/a", name: "A" }], ["A", "old-model"]),
    ).toEqual([
      { id: "a", name: "A" },
      { id: "old-model", name: "old-model", unavailable: true },
    ]));
  it("does not change a provider-free model id", () =>
    expect(canonicalId("claude-opus")).toBe("claude-opus"));
});
describe("guest policies", () => {
  it("none means block every known model, not allow all", () => {
    const result = guestPolicy(cfg, models, []);
    expect(result.GUEST_ALLOWED_MODEL_IDS).toEqual([]);
    expect(result.GUEST_BLOCKED_MODEL_IDS).toEqual(["a", "b"]);
    expect(models.every((m) => !guestModelAllowed(result, m.id))).toBe(true);
  });
  it("all includes models added to the backend later", () => {
    const result = guestPolicy(cfg, models, ["a", "b"]);
    expect(result.GUEST_ALLOWED_MODEL_IDS).toEqual([]);
    expect(guestModelAllowed(result, "future-model")).toBe(true);
  });
  it("a partial selection becomes an explicit allow-list", () => {
    const result = guestPolicy(cfg, models, ["a"]);
    expect(guestModelAllowed(result, "a")).toBe(true);
    expect(guestModelAllowed(result, "b")).toBe(false);
  });
  it("retains configured models not in the current catalog", () => {
    const result = guestPolicy(
      { ...cfg, GUEST_ALLOWED_MODEL_IDS: ["a", "hidden"] },
      models,
      ["a"],
    );
    expect(result.GUEST_ALLOWED_MODEL_IDS).toEqual(["a", "hidden"]);
  });
  it("preserves unknown blocked ids", () =>
    expect(
      guestPolicy({ ...cfg, GUEST_BLOCKED_MODEL_IDS: ["hidden"] }, models, [])
        .GUEST_BLOCKED_MODEL_IDS,
    ).toContain("hidden"));
});
describe("existing conversation data", () => {
  const a: Message = {
      id: "a",
      role: "user",
      content: "Question",
      parentId: null,
      childrenIds: ["b", "c"],
    },
    b: Message = {
      id: "b",
      role: "assistant",
      content: "Old branch",
      parentId: "a",
    },
    c: Message = {
      id: "c",
      role: "assistant",
      content: "Selected branch",
      parentId: "a",
    };
  const chat: ChatData = {
    title: "My work",
    models: ["x"],
    messages: [],
    history: { currentId: "c", messages: { a, b, c } },
  };
  it("loads the active branch instead of every historical message", () =>
    expect(activeMessages(chat).map((m) => m.id)).toEqual(["a", "c"]));
  it("does not erase other branches when saving", () => {
    const result = chatPayload(
      [
        ...activeMessages(chat),
        { id: "d", role: "user", content: "Follow up" },
      ],
      "y",
      chat,
    );
    expect(result.history?.messages.b).toEqual(b);
    expect(result.history?.messages.a.childrenIds).toEqual(["b", "c"]);
    expect(result.history?.currentId).toBe("d");
    expect(result.title).toBe("My work");
  });
  it("handles corrupt cyclic history without hanging", () =>
    expect(
      activeMessages({
        ...chat,
        history: { currentId: "a", messages: { a: { ...a, parentId: "a" } } },
      }),
    ).toHaveLength(1));
});
describe("streaming and export", () => {
  it("parses UTF-8 split across arbitrary stream chunks", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"text":"你好"}\r\n\r\ndata: {"text":"world"}\n\ndata: [DONE]\n\n',
    );
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 2)
          c.enqueue(bytes.slice(i, i + 2));
        c.close();
      },
    });
    const result = [];
    for await (const event of sseEvents(body)) result.push(event);
    expect(result).toEqual([{ text: "你好" }, { text: "world" }]);
  });
  it("accepts the final event without a trailing newline", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"done":true}'));
        c.close();
      },
    });
    const result = [];
    for await (const event of sseEvents(body)) result.push(event);
    expect(result).toEqual([{ done: true }]);
  });
  it("escapes CSV quotes and neutralizes spreadsheet formulas", () =>
    expect(csvRows([['=HYPERLINK("bad")', "a,b", "normal"]])).toBe(
      '\ufeff"\'=HYPERLINK(""bad"")","a,b","normal"',
    ));
});
