import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Globe } from "lucide-react";
import { statusView, type Citation, type SearchResult } from "../lib/reply-status";
import type { MessageStatus } from "../lib/types";
import "./reply-status.css";

/** claude.ai's three pulsing working dots. */
export function WorkingDots() {
  return (
    <span className="working-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Favicon({ host }: { host?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [host]);
  return host && !failed ? (
    <img
      className="favicon"
      src={`https://${host}/favicon.ico`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <Globe className="favicon" size={14} aria-hidden="true" />
  );
}

function Caret() {
  return (
    <svg className="reply-caret" viewBox="0 0 6 8" aria-hidden="true">
      <path d="M1 .8 5.2 4 1 7.2z" fill="currentColor" />
    </svg>
  );
}

function Results({ results }: { results: SearchResult[] }) {
  return (
    <div className="reply-results">
      <span>Results</span>
      {results.map((r) => (
        <a key={r.url} className="reply-result" href={r.url} target="_blank" rel="noopener noreferrer">
          <Favicon host={r.host} />
          <span className="reply-result-title">{r.title}</span>
          <span className="reply-result-host">{r.host}</span>
        </a>
      ))}
    </div>
  );
}

function Line({
  dots,
  label,
  elapsed,
  open,
  onToggle,
}: {
  dots: boolean;
  label?: string;
  elapsed: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const content: ReactNode = (
    <>
      {dots && <WorkingDots />}
      {label && <span className={`reply-status-label ${dots ? "shimmer" : ""}`}>{label}</span>}
      {dots && elapsed >= 5 && <span className="reply-status-elapsed">{elapsed}s</span>}
      {onToggle && <Caret />}
    </>
  );
  return onToggle ? (
    <button type="button" className="reply-status-line" aria-expanded={open} onClick={onToggle}>
      {content}
    </button>
  ) : (
    <div className="reply-status-line">{content}</div>
  );
}

/**
 * The status rows above a reply, after claude.ai: pulsing dots while waiting,
 * a shimmering label while the server searches, then a quiet
 * "Searched the web ▸" that expands into the queries and the pages found.
 */
export function ReplyStatus({
  history,
  live,
  waiting,
  startedAt,
}: {
  history?: MessageStatus[];
  /** This reply is still generating. */
  live: boolean;
  /** No text has arrived yet. */
  waiting: boolean;
  /** Unix seconds when the request was sent. */
  startedAt?: number;
}) {
  const view = statusView(history);
  const running = live && !!view?.running;
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  const elapsed = live && startedAt ? Math.max(0, Math.floor(now / 1000 - startedAt)) : 0;
  const expandable = !!view && (view.queries.length > 0 || view.results.length > 0);
  if (!view && !waiting) return null;
  return (
    <div className="reply-status">
      {view && (
        <Line
          dots={running}
          label={view.label}
          elapsed={elapsed}
          open={open}
          onToggle={expandable ? () => setOpen((v) => !v) : undefined}
        />
      )}
      {view && open && expandable && (
        <div className="reply-steps">
          <button
            type="button"
            className="reply-step"
            aria-expanded={results}
            disabled={!view.results.length}
            onClick={() => setResults((v) => !v)}
          >
            <span>{running && !view.results.length ? "Searching the web" : "Searched the web"}</span>
            {view.queries.length > 0 && <strong>{view.queries.join(" · ")}</strong>}
            {view.results.length > 0 && <Caret />}
          </button>
          {results && <Results results={view.results} />}
        </div>
      )}
      {waiting && !running && (
        <Line dots label={elapsed >= 5 ? "Thinking" : undefined} elapsed={elapsed} />
      )}
      {live && <span className="sr-only">{running ? view!.label : waiting ? "Kividas is thinking" : ""}</span>}
    </div>
  );
}

function CitationCard({
  cited,
  anchor,
  onEnter,
  onLeave,
}: {
  cited: Citation[];
  anchor: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const width = Math.min(300, window.innerWidth - 16);
  const left = Math.min(
    Math.max(8, anchor.left + anchor.width / 2 - width / 2),
    window.innerWidth - width - 8,
  );
  // Prefer above the pill like claude.ai; flip below near the top edge.
  const above = anchor.top > 160;
  return createPortal(
    <div
      className="citation-card"
      role="tooltip"
      style={{
        width,
        left,
        ...(above
          ? { bottom: window.innerHeight - anchor.top + 6 }
          : { top: anchor.bottom + 6 }),
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {cited.map((c) => {
        const body = (
          <>
            <strong>{c.title}</strong>
            <span>
              <Favicon host={c.host} />
              {c.host ?? c.site}
            </span>
          </>
        );
        return c.url ? (
          <a key={c.n} href={c.url} target="_blank" rel="noopener noreferrer">
            {body}
          </a>
        ) : (
          <div key={c.n}>{body}</div>
        );
      })}
    </div>,
    document.body,
  );
}

/** Hover and focus handling for the source pills inside rendered Markdown. */
export function useCitationCard(citations: Citation[]) {
  const [card, setCard] = useState<{ cited: Citation[]; anchor: DOMRect } | null>(null);
  const timer = useRef<number>();
  const keep = () => clearTimeout(timer.current);
  const hide = () => {
    keep();
    timer.current = window.setTimeout(() => setCard(null), 150);
  };
  const show = (target: EventTarget) => {
    const pill = (target as HTMLElement).closest?.<HTMLElement>(".citation");
    if (!pill) return;
    keep();
    const cited = (pill.dataset.cite ?? "")
      .split(",")
      .map((n) => citations[Number(n) - 1])
      .filter(Boolean);
    if (cited.length) setCard({ cited, anchor: pill.getBoundingClientRect() });
  };
  useEffect(() => {
    if (!card) return;
    const close = () => setCard(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [card]);
  useEffect(() => keep, []);
  const leave = (e: PointerEvent | FocusEvent) => {
    if ((e.target as HTMLElement).closest?.(".citation")) hide();
  };
  return {
    handlers: citations.length
      ? {
          onPointerOver: (e: PointerEvent) => show(e.target),
          onPointerOut: leave,
          onFocus: (e: FocusEvent) => show(e.target),
          onBlur: leave,
        }
      : {},
    card: card && (
      <CitationCard cited={card.cited} anchor={card.anchor} onEnter={keep} onLeave={hide} />
    ),
  };
}
