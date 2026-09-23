import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { usagePercent, type UserPlan, type UsageWindow } from "../lib/admin-users";

export function usageResetLabel(value: UsageWindow["resetAt"], short: boolean, now = Date.now()) {
  if (!value) return "Starts with next message";
  const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return "Reset time unavailable";
  const minutes = Math.ceil((date.getTime() - now) / 60000);
  if (minutes <= 0) return "Resetting soon";
  if (short) {
    const hours = Math.floor(minutes / 60);
    return `Resets in ${hours ? `${hours} hr ` : ""}${minutes % 60} min`;
  }
  return `Resets ${date.toLocaleDateString("en-US", { weekday: "short" })} ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function AdminUsage({ plan, busy, onReset }: {
  plan?: UserPlan;
  busy: boolean;
  onReset: (windows: string[], title: string, description: string) => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const usage = plan?.usage;
  return (
    <section className="admin-usage" aria-label="Usage windows">
      <div className="admin-usage-heading">
        <h3>Usage</h3>
        {usage && <button type="button" className="btn admin-usage-reset-both" disabled={busy || !plan?.kyber_linked}
          onClick={() => onReset(["5h", "week"], "Reset both usage windows", "Reset the 5-hour and weekly limits? This also resets the weekly Fable limit. Subscription, wallet balance, and usage history stay unchanged.")}>
          <RotateCcw size={13} /> Reset both
        </button>}
      </div>
      {usage ? <div className="admin-usage-windows">
        {[
          { key: "5h", label: "5-hour limit", window: usage.tp5h },
          { key: "week", label: "Weekly · all models", window: usage.tpw },
          ...(usage.tpwFable ? [{ key: "fable", label: "Weekly · Fable", window: usage.tpwFable }] : []),
        ].map(({ key, label, window }) => {
          const percent = usagePercent(window);
          const reset = !window ? "Usage unavailable"
            : !window.resetAt && window.used > 0 ? "Reset time unavailable"
            : window.limit <= 0 ? "No reset scheduled"
            : usageResetLabel(window.resetAt, key === "5h", now);
          return <div className="admin-usage-window" key={key}>
            <div className="admin-usage-summary">
              <span className="admin-usage-label">{label}</span>
              <span className="admin-usage-reset-time">{reset}</span>
              <span className="admin-usage-percent">{!window ? "—" : percent === null ? "∞" : `${percent}%`}</span>
            </div>
            <div className="admin-usage-track" role={window && percent !== null ? "progressbar" : undefined}
              aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}
              aria-valuetext={window && percent !== null ? `${percent}% used` : undefined}>
              <span style={{ width: `${percent ?? 0}%`, background: percent !== null && percent >= 90 ? "var(--danger)" : percent !== null && percent >= 70 ? "#c48a25" : undefined }} />
            </div>
            <div className="admin-usage-detail">
              <span>{window ? `${window.used.toLocaleString()} / ${window.limit > 0 ? window.limit.toLocaleString() : "Unlimited"} tokens` : "—"}</span>
              <button type="button" className="admin-usage-reset" aria-label={`Reset ${label}`} disabled={busy || !plan?.kyber_linked || !window}
                onClick={() => onReset([key], `Reset ${label}`, key === "week" ? "Reset weekly usage for all models? This also resets the weekly Fable limit." : `Reset the ${label.toLowerCase()} usage window?`)}>
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          </div>;
        })}
      </div> : <p className="muted">Usage is unavailable or this user is not linked to a wallet.</p>}
    </section>
  );
}
