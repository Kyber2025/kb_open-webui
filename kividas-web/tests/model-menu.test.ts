import { describe, it, expect } from "vitest";
import {
  modelLabel,
  primaryModels,
  reasoningParams,
  validEffort,
} from "../src/lib/model-menu";
import { complete } from "../src/lib/api";
import { vi } from "vitest";
const opus = { id: "claude-opus-5-5", name: "Claude Opus 5.5" };
describe("model and effort selection", () => {
  it("uses backend model ids while presenting the concise Claude name", () =>
    expect(modelLabel(opus)).toBe("Opus 5.5"));
  it("keeps only the first available model in each main family", () => {
    const older = { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
      fable = { id: "fable", name: "Claude Fable 5.1" };
    expect(
      primaryModels([{ id: "gpt-5", name: "GPT-5" }, opus, older, fable]),
    ).toEqual([fable, opus]);
  });
  it("does not add unavailable models to a user's menu", () =>
    expect(primaryModels([opus])).toEqual([opus]));
  it("falls back safely for invalid saved effort values", () =>
    expect(validEffort("ultra")).toBe("medium"));
  it("maps the Extra label to the gateway's xhigh value", () =>
    expect(reasoningParams(opus, "xhigh")).toEqual({
      reasoning_effort: "xhigh",
    }));
  it("omits reasoning parameters for unsupported models", () => {
    expect(reasoningParams({ id: "gpt-4o", name: "GPT-4o" }, "max")).toEqual(
      {},
    );
    expect(
      reasoningParams(
        { ...opus, info: { meta: { capabilities: { reasoning: false } } } },
        "max",
      ),
    ).toEqual({});
  });
  it("sends the chosen effort on the actual completion endpoint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Hello" } }] }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("localStorage", { getItem: () => "test-token" });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await complete(
        { model: opus.id, params: reasoningParams(opus, "max") },
        new AbortController().signal,
        () => {},
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat/completions",
        expect.objectContaining({
          body: JSON.stringify({
            model: opus.id,
            params: { reasoning_effort: "max" },
          }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
