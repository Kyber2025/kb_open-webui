import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Globe } from "lucide-react";
import type { Citation } from "../lib/reply-status";
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

/**
 * The working row under a reply that is still generating, after claude.ai:
 * pulsing dots, with a shimmering label while a search or page read runs.
 * It goes away once text streams; finished searches leave no record.
 */
export function WorkingStatus({
  label,
  startedAt,
}: {
  /** The running step, or empty for dots alone ("Thinking" after 5s). */
  label: string;
  /** Unix seconds when the request was sent. */
  startedAt?: number;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = startedAt ? Math.max(0, Math.floor(now / 1000 - startedAt)) : 0;
  const text = label || (elapsed >= 5 ? "Thinking" : "");
  return (
    <div className="reply-status">
      <div className="reply-status-line">
        <WorkingDots />
        {text && <span className="reply-status-label shimmer">{text}</span>}
        {elapsed >= 5 && <span className="reply-status-elapsed">{elapsed}s</span>}
      </div>
      <span className="sr-only">{label || "Kividas is thinking"}</span>
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
