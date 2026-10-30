import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { complete } from "../src/lib/api";
import { chatPayload } from "../src/lib/domain";
const transport = vi.hoisted(() => ({ listen: vi.fn(), close: vi.fn() }));
vi.mock("../src/lib/chat-events", () => ({ listenToChat: transport.listen }));
const fetchMock = vi.fn();
let event: (type: string, data: any) => void;
const payload = { chat_id: "chat-1", id: "answer-1", stream: true };
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const saved = (message: Record<string, unknown>) => json({ chat: { history: { messages: { "answer-1": { id: "answer-1", role: "assistant", ...message } } } } });
beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => "test-token" });
  vi.stubGlobal("fetch", fetchMock);
  transport.listen.mockImplementation(async (_token, _chat, _message, _signal, callback) => {
    event = callback;
    return transport.close;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe("production saved-chat transport", () => {
  it("streams snapshots before the HTTP null acknowledgement and preserves the final server message", async () => {
    const updates: string[] = [];
    let message: any;
    fetchMock.mockImplementationOnce(async () => {
      event("chat:completion", { content: "你" });
      event("chat:completion", { content: "你好" });
      expect(updates).toEqual(["你", "你好"]);
      return json(null);
    }).mockResolvedValueOnce(saved({ content: "你好！", done: true, usage: { total_tokens: 5 } }));
    await complete(payload, new AbortController().signal, vi.fn(), (m) => { message = m; updates.push(m.content!); });
    expect(updates).toEqual(["你", "你好", "你好！"]);
    expect(message.usage.total_tokens).toBe(5);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("session_id");
  });
  it("forwards web search progress and sources ahead of the reply text", async () => {
    const seen: any[] = [];
    fetchMock.mockImplementationOnce(async () => {
      event("status", { action: "web_search", description: "Searching the web", done: false });
      event("status", { action: "web_search", description: "Searched {{count}} sites", urls: ["https://a.test"], done: true });
      event("chat:completion", { sources: [{ source: { name: "q" }, document: ["d"], metadata: [{ source: "https://a.test" }] }] });
      event("chat:completion", { content: "Answer [1]" });
      return json(null);
    }).mockResolvedValueOnce(saved({ content: "Answer [1]", done: true }));
    await complete(payload, new AbortController().signal, vi.fn(), (m) => seen.push(m));
    expect(seen[0].statusHistory.map((s: any) => s.done)).toEqual([false]);
    expect(seen[1].statusHistory.map((s: any) => s.done)).toEqual([false, true]);
    expect(seen[2]).toEqual({ sources: [{ source: { name: "q" }, document: ["d"], metadata: [{ source: "https://a.test" }] }] });
    expect(seen[3].content).toBe("Answer [1]");
  });
  it("keeps the model's own tool calls and collects the sources they found", async () => {
    const seen: any[] = [];
    const output = [
      { type: "function_call", call_id: "c1", name: "search_web", arguments: '{"query":"深圳天气"}', status: "completed" },
      { type: "function_call_output", call_id: "c1", output: [{ type: "input_text", text: "[]" }] },
      { type: "message", content: [{ type: "output_text", text: "多云 [1]" }] },
    ];
    const page = (url: string) => ({ source: { name: "search_web", id: "search_web" }, document: ["t"], metadata: [{ source: url, name: "T", url }] });
    fetchMock.mockImplementationOnce(async () => {
      event("chat:completion", { content: '<details type="tool_calls" done="false">', output: output.slice(0, 1) });
      event("source", page("https://a.test"));
      event("source", page("https://b.test"));
      event("source", { type: "code_execution", data: {} });
      event("chat:completion", { content: "多云 [1]", output });
      return json(null);
    }).mockResolvedValueOnce(saved({ content: "多云 [1]", output, done: true }));
    await complete(payload, new AbortController().signal, vi.fn(), (m) => seen.push(m));
    expect(seen[0].output).toHaveLength(1);
    expect(seen[1].sources.map((s: any) => s.metadata[0].source)).toEqual(["https://a.test"]);
    expect(seen[2].sources.map((s: any) => s.metadata[0].source)).toEqual(["https://a.test", "https://b.test"]);
    expect(seen).toHaveLength(5);
    expect(seen.at(-1).output).toEqual(output);
  });
  it("recovers the saved reply if the websocket is unavailable", async () => {
    fetchMock.mockResolvedValueOnce(json(null)).mockResolvedValueOnce(saved({ content: "Recovered reply", done: true }));
    const delta = vi.fn();
    await complete(payload, new AbortController().signal, delta);
    expect(delta).toHaveBeenCalledWith("Recovered reply");
  });
  it("surfaces provider errors delivered only over the event channel", async () => {
    fetchMock.mockImplementationOnce(async () => {
      event("chat:message:error", { error: { content: "Quota exceeded" } });
      return json(null);
    }).mockResolvedValueOnce(saved({ content: "", error: { content: "Quota exceeded" } }));
    await expect(complete(payload, new AbortController().signal, vi.fn())).rejects.toThrow("Quota exceeded");
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it("rejects empty saved replies and always releases the listener", async () => {
    fetchMock.mockResolvedValueOnce(json(null)).mockResolvedValueOnce(saved({ content: "" }));
    await expect(complete(payload, new AbortController().signal, vi.fn())).rejects.toThrow("empty response");
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it("closes the socket when the user stops generation", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(complete(payload, new AbortController().signal, vi.fn())).rejects.toThrow("Aborted");
    expect(transport.close).toHaveBeenCalledOnce();
  });
  it("keeps errors in the history so navigation cannot turn failures into blank replies", () => {
    const chat = chatPayload([{ id: "a", role: "assistant", content: "", error: { content: "Try again" } }], "claude");
    expect(chat.history?.messages.a.error).toEqual({ content: "Try again" });
  });
});
describe("guest and temporary SSE transport", () => {
  it("still streams direct replies without requiring a websocket or saved chat", async () => {
    fetchMock.mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } }));
    const delta = vi.fn();
    await complete({ stream: true }, new AbortController().signal, delta);
    expect(delta).toHaveBeenCalledWith("Hello");
    expect(transport.listen).not.toHaveBeenCalled();
  });
  it("passes the sources event that opens a direct stream", async () => {
    fetchMock.mockResolvedValueOnce(new Response('data: {"sources":[{"document":["d"],"metadata":[{"source":"https://a.test"}]}]}\n\ndata: {"choices":[{"delta":{"content":"Hi [1]"}}]}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
    const onMessage = vi.fn(), delta = vi.fn();
    await complete({ stream: true }, new AbortController().signal, delta, onMessage);
    expect(onMessage).toHaveBeenCalledWith({ sources: [{ document: ["d"], metadata: [{ source: "https://a.test" }] }] });
    expect(delta).toHaveBeenCalledWith("Hi [1]");
  });
  it("shows errors from the streaming provider", async () => {
    fetchMock.mockResolvedValueOnce(new Response('data: {"error":{"message":"Upstream unavailable"}}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
    await expect(complete({}, new AbortController().signal, vi.fn())).rejects.toThrow("Upstream unavailable");
  });
});
