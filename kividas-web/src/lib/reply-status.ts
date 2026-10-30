import type { TokenizerAndRendererExtension } from "marked";
import type { MessageSource, MessageStatus, OutputItem } from "./types";

export interface SearchResult {
  url: string;
  title: string;
  host: string;
}
/** What the reply's status line shows, derived from the server's status events. */
export interface StatusView {
  label: string;
  /** The last event has not finished (only animated while the reply is generating). */
  running: boolean;
  error: boolean;
  queries: string[];
  results: SearchResult[];
}

const httpUrl = (value?: string) => {
  try {
    const url = new URL(value ?? "");
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
};
export const hostOf = (value?: string) =>
  httpUrl(value)?.hostname.replace(/^www\./, "") ?? "";

const SECOND_LEVEL = new Set(["com", "net", "org", "gov", "edu", "ac", "co"]);
/** "news.sina.com.cn" → "sina", "zh.wikipedia.org" → "wikipedia". */
export function siteName(host: string) {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length < 2) return host;
  const suffix =
    labels.length > 2 &&
    labels[labels.length - 1].length === 2 &&
    SECOND_LEVEL.has(labels[labels.length - 2])
      ? 2
      : 1;
  return labels[labels.length - suffix - 1] || host;
}

function searchResults(status?: MessageStatus): SearchResult[] {
  const items = status?.items?.length
    ? status.items
    : (status?.urls ?? []).map((link) => ({ link, title: "" }));
  const seen = new Set<string>();
  return items.flatMap((item) => {
    const url = httpUrl(item.link);
    if (!url || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ url: url.href, title: item.title?.trim() || url.hostname, host: url.hostname }];
  });
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function genericLabel(status: MessageStatus) {
  if (status.action === "knowledge_search") return "Searching knowledge";
  if (status.action === "queries_generated") return "Reading your files";
  if (status.action === "sources_retrieved")
    return status.count ? `Retrieved ${plural(status.count, "source")}` : "Read your files";
  return status.description
    ?.replace("{{count}}", String(status.count ?? status.urls?.length ?? ""))
    .trim();
}

/** Summarise the status events the way claude.ai's status row does. */
export function statusView(history?: MessageStatus[]): StatusView | null {
  const visible = (history ?? []).filter((s) => s && typeof s === "object" && !s.hidden);
  const last = visible.at(-1);
  if (!last) return null;
  const running = !last.done;
  const web = visible.filter((s) => s.action?.startsWith("web_search"));
  if (web.length) {
    const queries =
      [...web].reverse().find((s) => s.queries?.length)?.queries?.filter((q) => q.trim()) ?? [];
    const finished = [...web].reverse().find((s) => s.action === "web_search" && s.done);
    const results = searchResults(finished);
    const error = !!finished?.error;
    const label = error
      ? /no search results/i.test(finished?.description ?? "")
        ? "No results found"
        : "Web search failed"
      : !finished
        ? queries.length
          ? `Searching for ${queries[0]}`
          : "Searching the web"
        : running
          ? `Reading ${plural(results.length, "page")}`
          : "Searched the web";
    return { label, running, error, queries, results };
  }
  const shown = [...visible].reverse().find((s) => genericLabel(s));
  if (!shown) return null;
  return {
    label: genericLabel(shown)!,
    running,
    error: !!shown.error,
    queries: [],
    results: [],
  };
}

/** One tool call the model chose to make. */
export interface ToolStep {
  kind: "search" | "fetch" | "other";
  name: string;
  /** The search query or the fetched URL. */
  detail: string;
  done: boolean;
}
/** A reply in order: its text and the groups of tool calls between it. */
export type ReplyPart = { kind: "text"; text: string } | { kind: "tools"; steps: ToolStep[] };

const parseJson = (text?: string): unknown => {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return undefined;
  }
};
const joinText = (parts?: { text?: string }[]) =>
  (Array.isArray(parts) ? parts : []).map((p) => p?.text ?? "").join("");

function toolStep(call: OutputItem, done: boolean): ToolStep {
  const args = parseJson(call.arguments);
  const arg = (key: string) =>
    String((args && typeof args === "object" && (args as Record<string, unknown>)[key]) ?? "").trim();
  const base = { name: call.name ?? "", done: done || call.status === "completed" };
  if (base.name === "search_web") return { ...base, kind: "search", detail: arg("query") };
  if (base.name === "fetch_url") return { ...base, kind: "fetch", detail: arg("url") };
  return { ...base, kind: "other", detail: "" };
}

/**
 * The reply as the server's ordered output items, when the model called tools on its
 * own (native function calling). Null otherwise: such replies keep using content.
 */
export function replyParts(output?: OutputItem[]): ReplyPart[] | null {
  const items = (Array.isArray(output) ? output : []).filter((o) => o && typeof o === "object");
  if (!items.some((o) => o.type === "function_call")) return null;
  const answered = new Set(items.filter((o) => o.type === "function_call_output").map((o) => o.call_id));
  const parts: ReplyPart[] = [];
  for (const item of items) {
    const last = parts.at(-1);
    if (item.type === "message") {
      const text = joinText(item.content).trim();
      if (!text) continue;
      if (last?.kind === "text") last.text += `\n\n${text}`;
      else parts.push({ kind: "text", text });
    } else if (item.type === "function_call") {
      const step = toolStep(item, answered.has(item.call_id));
      if (last?.kind === "tools") last.steps.push(step);
      else parts.push({ kind: "tools", steps: [step] });
    }
  }
  return parts;
}

/** A running step's label: "Searching for …", "Reading …". */
function stepLabel(step: ToolStep) {
  if (step.kind === "search") return step.detail ? `Searching for ${step.detail}` : "Searching the web";
  if (step.kind === "fetch") return `Reading ${hostOf(step.detail) || "the page"}`;
  return `Using ${step.name || "a tool"}`;
}

/**
 * What the working row under a generating reply says: the running search or page
 * read, "" for plain dots while no text has arrived, or null while text streams.
 * Finished searches leave no record; the reply's source pills carry what they found.
 */
export function workingLabel(message: {
  content?: string;
  statusHistory?: MessageStatus[];
  output?: OutputItem[];
}): string | null {
  const parts = replyParts(message.output);
  if (parts) {
    const pending = parts.flatMap((p) => (p.kind === "tools" ? p.steps : [])).find((s) => !s.done);
    if (pending) return stepLabel(pending);
    return parts.at(-1)?.kind === "text" ? null : "";
  }
  const view = statusView(message.statusHistory);
  if (view?.running) return view.label;
  return replyText(message) ? null : "";
}

const TOOL_DETAILS = /<details type="(?:tool_calls|reasoning|code_interpreter)"[\s\S]*?<\/details>\s*/g;
/** The reply's own words, without tool calls, results or reasoning: what gets copied and sent back as history. */
export function replyText(message: { content?: string; output?: OutputItem[] }) {
  const parts = replyParts(message.output);
  return parts
    ? parts.flatMap((p) => (p.kind === "text" ? [p.text] : [])).join("\n\n")
    : (message.content ?? "").replace(TOOL_DETAILS, "").trim();
}

export interface Citation {
  /** 1-based number the reply uses, as in [1]. */
  n: number;
  title: string;
  site: string;
  url?: string;
  host?: string;
}
/** Number sources exactly as the server numbers <source id> for the model. */
export function citationList(sources?: MessageSource[]): Citation[] {
  const list: Citation[] = [];
  const seen = new Set<string>();
  for (const source of Array.isArray(sources) ? sources : []) {
    (source?.document ?? []).forEach((_, i) => {
      const meta = source.metadata?.[i] ?? {};
      const id = meta.source || source.source?.id || "N/A";
      if (seen.has(id)) return;
      seen.add(id);
      const host = hostOf(meta.source);
      const name = source.source?.name || id;
      // Search tool results name their page title; fetched pages repeat the URL.
      const title = [meta.title, meta.name].map((t) => t?.trim()).find((t) => t && t !== meta.source);
      list.push({
        n: list.length + 1,
        title: title || host || name,
        site: host ? siteName(host) : name,
        ...(host ? { url: httpUrl(meta.source)!.href, host } : {}),
      });
    });
  }
  return list;
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Marked extension turning [1] / [1][2] / [1, 2] into claude.ai-style source pills. */
export function citationExtension(citations: Citation[]): TokenizerAndRendererExtension {
  return {
    name: "citation",
    level: "inline",
    start: (src) => src.match(/\[\d/)?.index,
    tokenizer(src) {
      const match = /^(?:\[\d{1,3}(?:\s*,\s*\d{1,3})*\])+(?!\()/.exec(src);
      if (!match) return undefined;
      const cited = [...new Set(match[0].match(/\d+/g)!.map(Number))]
        .map((n) => citations[n - 1])
        .filter(Boolean);
      return cited.length ? { type: "citation", raw: match[0], cited } : undefined;
    },
    renderer(token) {
      const cited = token.cited as Citation[];
      const [first] = cited;
      const label =
        `<span class="citation-label">${escapeHtml(first.site)}</span>` +
        (cited.length > 1 ? `<span class="citation-more"> +${cited.length - 1}</span>` : "");
      const ids = cited.map((c) => c.n).join(",");
      return first.url
        ? `<a class="citation" href="${escapeHtml(first.url)}" target="_blank" rel="noopener noreferrer" data-cite="${ids}">${label}</a>`
        : `<span class="citation" data-cite="${ids}">${label}</span>`;
    },
  };
}
