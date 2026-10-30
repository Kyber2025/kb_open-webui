import { describe, expect, it } from "vitest";
import { Marked } from "marked";
import {
  citationExtension,
  citationList,
  siteName,
  statusView,
} from "../src/lib/reply-status";
import type { MessageSource, MessageStatus } from "../src/lib/types";

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
