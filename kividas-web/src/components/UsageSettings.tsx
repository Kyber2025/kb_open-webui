import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { api } from "../lib/api";
import { usagePercent, type UsageWindow } from "../lib/admin-users";
import { usageResetLabel } from "./AdminUsage";
import "./usage-settings.css";

type Usage = {
  linked: boolean;
  tp5h?: UsageWindow;
  tpw?: UsageWindow;
  tpwFable?: UsageWindow;
  enterprise?: { orgName?: string; used: number; quota: number; cycleEndsAt: number };
};
function UsageRow({ value, label, short, loading, now }: {
  value?: UsageWindow; label: string; short?: boolean; loading: boolean; now: number;
}) {
  const valid = value && Number.isFinite(value.used) && Number.isFinite(value.limit) && value.used >= 0 && value.limit >= 0;
  const percent = valid ? usagePercent(value) : null;
  const reset = !valid ? "Reset time unavailable" : value.limit === 0 ? "No usage limit"
    : !value.resetAt && value.used > 0 ? "Reset time unavailable" : usageResetLabel(value.resetAt, !!short, now);
  return <div className="kvu-row">
    <div className="kvu-row-label"><div>{label}</div><div className="kvu-muted kvu-reset">{loading && !valid ? "Loading usage…" : reset}</div></div>
    <div className={`kvu-track${percent === null ? " kvu-track-empty" : ""}`} role={percent !== null ? "progressbar" : undefined}
      aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
      {percent !== null && <div className={`kvu-fill${percent >= 70 ? " kvu-amber" : ""}`} style={{ width: `${percent}%` }} />}
    </div>
    <div className="kvu-percent kvu-muted">{loading && !valid ? "Loading…" : !valid ? "Unavailable" : percent === null ? "Unlimited" : `${percent}% used`}</div>
  </div>;
}
export function UsageSettings({ billing }: { billing: () => void }) {
  const [data, setData] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [refresh, setRefresh] = useState(0);
  const [plan, setPlan] = useState("Kividas");
  useEffect(() => {
    let active = true, pending = false;
    async function load() {
      if (pending) return;
      pending = true; setLoading(true); setError("");
      try {
        const next: Usage = await api.usage();
        if (!next?.linked || (!next.tp5h && !next.tpw && !next.enterprise)) throw new Error("unavailable");
        if (active) { setData(next); setUpdated(Date.now()); setNow(Date.now()); }
      } catch {
        if (active) setError("Couldn’t load usage. Please refresh to try again.");
      } finally { pending = false; if (active) setLoading(false); }
    }
    async function loadPlan() {
      try { const sub = await api.subscription(); if (active) setPlan(sub?.tier?.name ? `Kividas · ${sub.tier.name}` : "Kividas"); } catch { /* Quota reads do not depend on the plan label. */ }
    }
    function reload() { void load(); void loadPlan(); }
    reload();
    const timer = setInterval(() => { setNow(Date.now()); void load(); }, 60000);
    window.addEventListener("focus", reload);
    window.addEventListener("subscription-updated", reload);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", reload); window.removeEventListener("subscription-updated", reload); };
  }, [refresh]);
  const age = updated === null ? null : Math.max(0, Math.floor((now - updated) / 60000));
  return <div className="kvu-settings" aria-busy={loading}>
    <div className="kvu-heading"><h2>Plan usage limits</h2><span className="kvu-muted">{plan}</span></div>
    {error && <div className="kvu-error" role="alert">{error}{data && " Showing the last available reading."}</div>}
    <UsageRow label="Current session" value={data?.tp5h} short loading={loading} now={now} />
    <h2 className="kvu-weekly-title">Weekly limits</h2>
    <UsageRow label="All models" value={data?.tpw} loading={loading} now={now} />
    {data?.tpwFable && <UsageRow label="Fable" value={data.tpwFable} loading={loading} now={now} />}
    {data?.enterprise && <section className="kvu-seat"><h2>Organization limits · {data.enterprise.orgName}</h2>
      <UsageRow label="Seat allowance" value={{ used: data.enterprise.used, limit: data.enterprise.quota, resetAt: data.enterprise.cycleEndsAt }} loading={loading} now={now} />
    </section>}
    <div className="kvu-updated kvu-muted"><span role="status">{age === null ? "Usage not updated yet" : `Last updated: ${age === 0 ? "just now" : `${age} min ago`}`}</span>
      <button type="button" className="kvu-refresh" disabled={loading} aria-label="Refresh usage" title="Refresh usage" onClick={() => setRefresh(n => n + 1)}><RotateCw size={16} /></button>
    </div>
    <button type="button" className="kvu-subscription-link" onClick={billing}>View subscription and redeem a code</button>
  </div>;
}
