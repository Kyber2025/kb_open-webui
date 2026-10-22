import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { RotateCw, X } from "lucide-react";
import { api } from "../lib/api";
import { accountPercent, resetLabel, usageSummary, windowPercent, type AccountWindow, type UsageLimits, type UsageWindow } from "../lib/usage";
import "./usage-ring.css";

function UsageRow({ label, value, official, now }: { label: string; value?: UsageWindow | null; official?: AccountWindow | null; now: number }) {
  const percent = official !== undefined ? accountPercent(official) : windowPercent(value);
  const unlimited = official === undefined && value?.limit === 0 && Number.isFinite(value.used) && value.used >= 0;
  const reset = official !== undefined ? official?.resetsAt : value?.resetAt;
  const starts = official === undefined && value?.used === 0 && !reset && percent !== null;
  const text = percent === null ? unlimited ? "Unlimited" : "Unavailable" : `${percent}%`;
  return <div className="kv-ring-row">
    <div className="kv-ring-row-head"><span>{label}</span><span className="kv-ring-value">{text}</span></div>
    <div className="kv-ring-track" role={percent === null ? undefined : "progressbar"} aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent === null ? undefined : Math.min(100, percent)} aria-valuetext={text}>
      {percent !== null && <span style={{ width: `${Math.min(100, percent)}%` }} data-level={percent >= 90 ? "high" : percent >= 80 ? "medium" : "low"} />}
    </div>
    <small>{unlimited ? "No usage limit" : starts ? "Window starts with your next request" : resetLabel(reset, now)}</small>
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
  const close = useRef<HTMLButtonElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(350, window.innerWidth - 32);
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
    close.current?.focus();
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { active = false; document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);

  const summary = usageSummary(data, now);
  const warning = !!error || summary.accountStale || (updated !== null && now - updated > 2 * 60000);
  const label = loading && !data ? "Loading plan usage" : !data?.linked ? "Plan usage unavailable"
    : summary.percent === null ? "View plan usage" : `Plan usage: ${summary.percent}%${warning ? ", update needed" : ""}`;
  const fill = summary.percent === null ? 0 : Math.min(100, summary.percent);
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
    {open && <section id={id} className="kv-ring-popover" style={placement} role="dialog" aria-label="Plan usage limits" aria-busy={loading}>
      <header><div><strong>Plan usage limits</strong>{plan && <small>{plan}</small>}</div>
        <button type="button" ref={close} className="icon-btn" aria-label="Close usage" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={15} /></button>
      </header>
      {error && <p className="kv-ring-note kv-ring-error" role="alert">{error}{data && " Showing the last available reading."}</p>}
      {!data ? <p className="kv-ring-note" role="status">{loading ? "Loading usage…" : "Usage is currently unavailable."}</p>
        : !data.linked ? <p className="kv-ring-note">Usage is not linked to this login. Sign in with the platform account assigned to you, or contact your administrator.</p>
        : <>
          <h3>{data.enterprise ? data.enterprise.orgName || "Organization allowance" : "Your platform allowance"}</h3>
          {data.enterprise ? <UsageRow label="Seat allowance" value={{ used: data.enterprise.used, limit: data.enterprise.quota, resetAt: data.enterprise.cycleEndsAt }} now={now} /> : <>
            <UsageRow label="5-hour limit" value={data.tp5h} now={now} />
            <UsageRow label="Weekly · all models" value={data.tpw} now={now} />
            {data.tpwFable && <UsageRow label="Weekly · Fable" value={data.tpwFable} now={now} />}
          </>}
          {!data.enterprise && data.sharedAccount && <div className="kv-ring-account">
            <h3>Claude account usage</h3>
            <p className="kv-ring-note">{data.sharedAccount.seats > 1 ? "Account totals include everyone sharing this Claude account." : "Official usage for your assigned Claude account."}</p>
            {summary.accountStale && <p className="kv-ring-note kv-ring-error">Account reading is out of date. Waiting for the next update.</p>}
            <UsageRow label="Account · 5 hours" official={data.sharedAccount.fiveHour} now={now} />
            <UsageRow label="Account · weekly" official={data.sharedAccount.sevenDay} now={now} />
            {data.sharedAccount.observedAt && Number.isFinite(Date.parse(data.sharedAccount.observedAt)) && <small>Account updated {new Date(data.sharedAccount.observedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</small>}
          </div>}
        </>}
      <footer><small role="status">{loading ? "Refreshing…" : updated ? `Checked ${new Date(updated).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Not updated yet"}</small>
        <button type="button" className="icon-btn" disabled={loading} aria-label="Refresh usage" onClick={() => setAttempt(value => value + 1)}><RotateCw size={15} /></button>
      </footer>
    </section>}
  </div>;
}
