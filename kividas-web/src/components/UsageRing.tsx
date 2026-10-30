import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { RotateCw } from "lucide-react";
import { api } from "../lib/api";
import { resetLabel, usageSummary, windowPercent, type UsageLimits, type UsageWindow } from "../lib/usage";
import "./usage-ring.css";

function UsageRow({ label, value, now }: { label: string; value?: UsageWindow | null; now: number }) {
  const percent = windowPercent(value);
  const unlimited = value?.limit === 0 && Number.isFinite(value.used) && value.used >= 0;
  const reset = value?.resetAt;
  const starts = value?.used === 0 && !reset && percent !== null;
  const text = percent === null ? unlimited ? "Unlimited" : "Unavailable" : `${percent}%`;
  const note = unlimited || starts ? "" : resetLabel(reset, now);
  return <div className="kv-ring-row" title={starts ? "Window starts with your next request" : undefined}>
    <div className="kv-ring-row-head"><span className="kv-ring-label">{label}</span>{note && <small>{note}</small>}<span className="kv-ring-value">{text}</span></div>
    {percent !== null && <div className="kv-ring-track" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, percent)} aria-valuetext={text}>
      <span style={{ width: `${Math.min(100, percent)}%` }} data-level={percent >= 90 ? "high" : percent >= 80 ? "medium" : "low"} />
    </div>}
  </div>;
}

// The parent keys this component by the signed-in user, so a different login can
// never retain the previous user's usage snapshot or an in-flight response.
export function UsageRing() {
  const [data, setData] = useState<UsageLimits | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [attempt, setAttempt] = useState(0);
  const [plan, setPlan] = useState("");
  const [placement, setPlacement] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 32);
      const above = rect.top - 24, below = window.innerHeight - rect.bottom - 24;
      const upwards = above >= below;
      setPlacement({ position: "fixed", width, left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)), right: "auto",
        top: upwards ? "auto" : rect.bottom + 10, bottom: upwards ? window.innerHeight - rect.top + 10 : "auto",
        maxHeight: Math.max(100, upwards ? above : below) });
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);

  useEffect(() => {
    let active = true, pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      if (active) setLoading(true);
      try {
        const next: UsageLimits = await api.usage();
        if (!next || typeof next.linked !== "boolean") throw new Error("Invalid usage response");
        if (active) { setData(next); setUpdated(Date.now()); setNow(Date.now()); setError(""); }
      } catch {
        if (active) setError("Couldn’t refresh usage. Try again.");
      } finally { pending = false; if (active) setLoading(false); }
    }
    function reload() { void load(); }
    reload();
    const timer = window.setInterval(() => { setNow(Date.now()); if (document.visibilityState !== "hidden") reload(); }, 60000);
    window.addEventListener("focus", reload);
    window.addEventListener("subscription-updated", reload);
    window.addEventListener("usage-updated", reload);
    return () => {
      active = false; clearInterval(timer);
      window.removeEventListener("focus", reload);
      window.removeEventListener("subscription-updated", reload);
      window.removeEventListener("usage-updated", reload);
    };
  }, [attempt]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    api.subscription().then(result => { if (active) setPlan(result?.tier?.name || ""); }).catch(() => {});
    popover.current?.focus();
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { active = false; document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);

  const summary = usageSummary(data);
  const warning = !!error || (updated !== null && now - updated > 2 * 60000);
  const label = loading && !data ? "Loading plan usage" : !data?.linked ? "Plan usage unavailable"
    : summary.percent === null ? "View plan usage" : `Plan usage: ${summary.percent}%${warning ? ", update needed" : ""}`;
  const fill = summary.percent === null ? 0 : Math.min(100, summary.percent);
  const subtitle = data?.enterprise ? data.enterprise.orgName || "Organization allowance" : plan;
  const checked = loading ? "Refreshing…" : updated ? `Checked ${new Date(updated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Not updated yet";
  return <div ref={root} className="kv-ring-anchor">
    <button ref={trigger} type="button" className="icon-btn kv-ring-trigger" aria-label={label} title={label}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { setOpen(value => !value); if (!open) setAttempt(value => value + 1); }}>
      <svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" className="kv-ring-base" />
        {summary.percent !== null && <circle cx="12" cy="12" r="8.5" className="kv-ring-progress" pathLength="100"
          strokeDasharray={`${fill} 100`} data-level={fill >= 90 ? "high" : fill >= 80 ? "medium" : "low"} />}
        {(warning || (!loading && (!data?.linked || summary.percent === null))) && <text x="12" y="15.5" textAnchor="middle">{warning ? "!" : "?"}</text>}
      </svg>
    </button>
    {open && <section ref={popover} tabIndex={-1} id={id} className="kv-ring-popover" style={placement} role="dialog" aria-label="Plan usage limits" aria-busy={loading}>
      <header><span>Plan usage limits{subtitle && ` · ${subtitle}`}</span>
        <button type="button" className="icon-btn kv-ring-refresh" data-loading={loading || undefined} disabled={loading} aria-label="Refresh usage"
          title={checked} onClick={() => setAttempt(value => value + 1)}><RotateCw size={13} /></button>
      </header>
      {error && <p className="kv-ring-note kv-ring-error" role="alert">{error}{data && " Showing the last available reading."}</p>}
      {!data ? <p className="kv-ring-note" role="status">{loading ? "Loading usage…" : "Usage is currently unavailable."}</p>
        : !data.linked ? <p className="kv-ring-note">Usage is not linked to this login. Sign in with the platform account assigned to you, or contact your administrator.</p>
        : data.enterprise ? <UsageRow label="Seat allowance" value={{ used: data.enterprise.used, limit: data.enterprise.quota, resetAt: data.enterprise.cycleEndsAt }} now={now} />
        : <>
          <UsageRow label="5-hour limit" value={data.tp5h} now={now} />
          <UsageRow label="Weekly · all models" value={data.tpw} now={now} />
          {data.tpwFable && <UsageRow label="Weekly · Fable" value={data.tpwFable} now={now} />}
        </>}
      {warning && !error && !loading && <p className="kv-ring-note" role="status">{checked}</p>}
    </section>}
  </div>;
}
