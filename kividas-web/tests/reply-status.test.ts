import { describe, expect, it } from "vitest";
import { Marked } from "marked";
import {
  citationExtension,
  citationList,
  replyParts,
  replyText,
  siteName,
  statusView,
  workingLabel,
  type ToolStep,
} from "../src/lib/reply-status";
import type { MessageSource, MessageStatus, OutputItem } from "../src/lib/types";

const searching: MessageStatus = { action: "web_search", description: "Searching the web", done: false };
const queries: MessageStatus = { action: "web_search_queries_generated", queries: ["深圳天气预报", "Shenzhen weather"], done: false };
const searched: MessageStatus = {
  action: "web_search",
  description: "Searched {{count}} sites",
  urls: ["https://www.weather.com.cn/sz", "https://example.org/a"],
  items: [
    { link: "https://www.weather.com.cn/sz", title: "深圳天气预报", snippet: "…" },
    { link: "https://example.org/a", title: "", snippet: "" },
    { link: "javascript:alert(1)", title: "bad" },
  ],
  done: true,
};

describe("status line", () => {
  it("follows a live web search through to the finished summary", () => {
    expect(statusView([searching])).toMatchObject({ label: "Searching the web", running: true });
    expect(statusView([searching, queries])).toMatchObject({ label: "Searching for 深圳天气预报", running: true, queries: ["深圳天气预报", "Shenzhen weather"] });
    // Retrieval over the loaded pages runs after the search reports done.
    const reading = statusView([searching, queries, searched, { action: "queries_generated", queries: ["x"], done: false }]);
    expect(reading).toMatchObject({ label: "Reading 2 pages", running: true });
  });

  it("summarises the sequence production saves as Searched the web", () => {
    const view = statusView([searching, queries, searched, { action: "queries_generated", queries: ["x"], done: false }, { action: "sources_retrieved", count: 3, done: true }]);
    expect(view).toMatchObject({ label: "Searched the web", running: false, error: false });
    expect(view?.results).toEqual([
      { url: "https://www.weather.com.cn/sz", title: "深圳天气预报", host: "www.weather.com.cn" },
      { url: "https://example.org/a", title: "example.org", host: "example.org" },
    ]);
  });

  it("reports failures and skips hidden events", () => {
    expect(statusView([searching, { action: "web_search", description: "No search results found", done: true, error: true }])).toMatchObject({ label: "No results found", error: true, running: false });
    expect(statusView([searching, { action: "web_search", description: "An error occurred while searching the web", queries: ["q"], done: true, error: true }])).toMatchObject({ label: "Web search failed", queries: ["q"] });
    expect(statusView([{ action: "knowledge_search", query: "q", done: true, hidden: true }])).toBeNull();
    expect(statusView(undefined)).toBeNull();
  });

  it("labels other server steps from their action or description", () => {
    expect(statusView([{ action: "sources_retrieved", count: 1, done: true }])?.label).toBe("Retrieved 1 source");
    expect(statusView([{ description: "Creating image", done: false }])).toMatchObject({ label: "Creating image", running: true });
  });
});

const call = (id: string, name: string, args: object, status = "completed"): OutputItem => ({
  type: "function_call", call_id: id, name, arguments: JSON.stringify(args), status,
});
const result = (id: string, text: string): OutputItem => ({
  type: "function_call_output", call_id: id, output: [{ type: "input_text", text }],
});
const say = (text: string): OutputItem => ({ type: "message", content: [{ type: "output_text", text }] });
const found = JSON.stringify([
  { title: "深圳天气预报", link: "https://www.weather.com.cn/sz", snippet: "多云" },
  { title: "", link: "https://example.org/a", snippet: "" },
  { title: "bad", link: "javascript:alert(1)" },
]);
describe("searches the model makes itself", () => {
  it("leaves replies without tool calls on the content path", () => {
    expect(replyParts(undefined)).toBeNull();
    expect(replyParts([say("Hi! How can I help you today?")])).toBeNull();
  });

  it("keeps text and back-to-back tool calls in order", () => {
    const parts = replyParts([
      say("Let me check."),
      call("a", "search_web", { query: "深圳天气" }), call("b", "fetch_url", { url: "https://wttr.in/Shenzhen?format=j1" }),
      result("a", found), result("b", "{}"), say(""),
      call("c", "fetch_url", { url: "https://www.weather.com.cn/sz" }, "in_progress"),
    ])!;
    expect(parts.map((p) => p.kind)).toEqual(["text", "tools"]);
    expect((parts[1] as { steps: ToolStep[] }).steps.map((s) => [s.kind, s.detail, s.done])).toEqual([
      ["search", "深圳天气", true], ["fetch", "https://wttr.in/Shenzhen?format=j1", true], ["fetch", "https://www.weather.com.cn/sz", false],
    ]);
  });

  it("shows only the step that is running and leaves no record once it is done", () => {
    expect(workingLabel({ output: [call("a", "search_web", { query: "深圳天气" }, "in_progress")] })).toBe("Searching for 深圳天气");
    expect(workingLabel({ output: [call("a", "fetch_url", { url: "https://www.bbc.co.uk/news" }, "in_progress")] })).toBe("Reading bbc.co.uk");
    expect(workingLabel({ output: [call("a", "notion_search", {}, "in_progress")] })).toBe("Using notion_search");
    // Searched, answer not started yet: dots alone.
    expect(workingLabel({ output: [call("a", "search_web", { query: "q" }), result("a", found), say("")] })).toBe("");
    // Answer streaming: no row and no "Searched the web".
    expect(workingLabel({ output: [call("a", "search_web", { query: "q" }), result("a", found), say("今天多云")] })).toBeNull();
  });

  it("treats the server's own search step the same way", () => {
    const done: MessageStatus = { action: "sources_retrieved", count: 3, done: true };
    expect(workingLabel({ statusHistory: [searching, queries] })).toBe("Searching for 深圳天气预报");
    expect(workingLabel({ statusHistory: [searching, queries, searched, done] })).toBe("");
    expect(workingLabel({ statusHistory: [searching, queries, searched, done], content: "Answer [1]" })).toBeNull();
    expect(workingLabel({ content: "" })).toBe("");
  });

  it("copies and resends only the reply's own words", () => {
    expect(replyText({ output: [call("a", "search_web", { query: "q" }), result("a", found), say("今天多云 [1]。"), say("出门带伞。")] })).toBe("今天多云 [1]。\n\n出门带伞。");
    expect(replyText({ content: '<details type="tool_calls" done="true" id="a" name="search_web" arguments="&quot;{}&quot;">\n<summary>Tool Executed</summary>\n&quot;[]&quot;\n</details>\n今天多云。' })).toBe("今天多云。");
    expect(replyText({ content: "Plain **answer**" })).toBe("Plain **answer**");
  });

  it("numbers the search tool's sources and names them by page title", () => {
    const found: MessageSource[] = [
      { source: { name: "search_web", id: "search_web" }, document: ["a", "b"], metadata: [
        { source: "https://www.weather.com.cn/sz", name: "深圳天气预报", url: "https://www.weather.com.cn/sz" },
        { source: "https://example.org/a", name: "", url: "https://example.org/a" },
      ] },
      { source: { name: "https://wttr.in/x", id: "https://wttr.in/x" }, document: ["c"], metadata: [{ source: "https://wttr.in/x", name: "https://wttr.in/x", url: "https://wttr.in/x" }] },
    ];
    expect(citationList(found)).toEqual([
      { n: 1, title: "深圳天气预报", site: "weather", url: "https://www.weather.com.cn/sz", host: "weather.com.cn" },
      { n: 2, title: "example.org", site: "example", url: "https://example.org/a", host: "example.org" },
      { n: 3, title: "wttr.in", site: "wttr", url: "https://wttr.in/x", host: "wttr.in" },
    ]);
  });
});

const sources: MessageSource[] = [
  {
    source: { name: "深圳天气预报, Shenzhen weather", type: "web_search" },
    document: ["a", "b", "c"],
    metadata: [
      { source: "https://www.weather.com.cn/sz", title: "深圳天气预报 - 中国天气网" },
      { source: "https://news.sina.com.cn/x" },
      { source: "https://www.weather.com.cn/sz", title: "duplicate chunk" },
    ],
  },
  { source: { id: "file-1", name: "report.pdf" }, document: ["d"], metadata: [{}] },
];

describe("citations", () => {
  it("numbers sources by first appearance like the server's <source id>", () => {
    expect(citationList(sources)).toEqual([
      { n: 1, title: "深圳天气预报 - 中国天气网", site: "weather", url: "https://www.weather.com.cn/sz", host: "weather.com.cn" },
      { n: 2, title: "news.sina.com.cn", site: "sina", url: "https://news.sina.com.cn/x", host: "news.sina.com.cn" },
      { n: 3, title: "report.pdf", site: "report.pdf" },
    ]);
    expect(citationList(undefined)).toEqual([]);
  });

  it("names sites the way the pills show them", () => {
    expect(["github.com", "zh.wikipedia.org", "bbc.co.uk", "www.foxnews.com", "localhost"].map(siteName)).toEqual(["github", "wikipedia", "bbc", "foxnews", "localhost"]);
  });

  it("renders [n] markers as pills and leaves code, links and unknown numbers alone", () => {
    const md = new Marked({ extensions: [citationExtension(citationList(sources))] });
    const html = md.parse("Hot today [1]. Also [1][2] and [2, 3]. Not [9], `[1]` or [1](https://a.test).", { async: false }) as string;
    expect(html).toContain('<a class="citation" href="https://www.weather.com.cn/sz" target="_blank" rel="noopener noreferrer" data-cite="1"><span class="citation-label">weather</span></a>');
    expect(html).toContain('data-cite="1,2"><span class="citation-label">weather</span><span class="citation-more"> +1</span></a>');
    expect(html).toContain('<a class="citation" href="https://news.sina.com.cn/x" target="_blank" rel="noopener noreferrer" data-cite="2,3">');
    expect(html).toContain("Not [9]");
    expect(html).toContain("<code>[1]</code>");
    expect(html).toContain('<a href="https://a.test">1</a>');
  });

  it("renders a file citation without a link and escapes names", () => {
    const md = new Marked({ extensions: [citationExtension([{ n: 1, title: "x", site: '<b>"q"</b>' }])] });
    expect(md.parse("See [1]", { async: false })).toContain('<span class="citation" data-cite="1"><span class="citation-label">&lt;b&gt;&quot;q&quot;&lt;/b&gt;</span></span>');
  });
});
