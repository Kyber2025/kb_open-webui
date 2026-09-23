import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { Model, Tier } from "../lib/types";
import { messageOf } from "./UI";
import "./subscription.css";

type SubscriptionState = { tier?: Tier | null; expires_at?: number | null; subscription?: { tier_id: string; expires_at?: number } | null };
const gift = new URL("./kividas-redeem-gift.png", import.meta.url).href;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
function limit(value: number | null) {
  return value === null ? "Plan default" : value === 0 ? "Unlimited" : `${compact.format(value)} tokens`;
}
function SubscriptionFrame({ title, children, onClose, models = false }: { title: string; children: ReactNode; onClose: () => void; models?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className={`kvs-dialog ${models ? "kvs-models-dialog" : ""}`} aria-labelledby={id}
    onCancel={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
    onClick={(e) => {
      if (e.target !== dialog.current) return;
      const bounds = e.currentTarget.getBoundingClientRect();
      if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose();
    }}>
    <header className="kvs-header"><div>{!models && <div className="kvs-eyebrow">KIVIDAS</div>}<h2 className="kvs-title" id={id}>{title}</h2></div>
      <button type="button" className="kvs-close" aria-label={models ? "Close models" : "Close subscription"} onClick={onClose}>×</button>
    </header>
    <div className="kvs-body">{children}</div>
  </dialog>;
}
function PlanModels({ plan, onClose }: { plan: Tier; onClose: () => void }) {
  const [models, setModels] = useState<Model[] | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(""); setModels(null);
    api.planModels(plan.id).then((data) => { if (active) setModels(data.models); }).catch((e) => { if (active) setError(messageOf(e)); });
    return () => { active = false; };
  }, [plan.id, attempt]);
  return <SubscriptionFrame title={`${plan.name} · Models`} models onClose={onClose}>
    {error ? <div role="alert"><p className="kvs-muted">{error}</p><button className="kvs-button" onClick={() => setAttempt(attempt + 1)}>Retry</button></div>
      : models === null ? <p className="kvs-muted">Loading models…</p>
      : models.length ? <ul className="kvs-model-list">{models.map((m) => <li key={m.id}>{m.name || m.id}</li>)}</ul>
      : <p className="kvs-muted">No models are currently available.</p>}
  </SubscriptionFrame>;
}
export function Subscription({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const [state, setState] = useState<SubscriptionState | null>(null), [plans, setPlans] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [code, setCode] = useState("");
  const [error, setError] = useState(""), [success, setSuccess] = useState(""), [modelPlan, setModelPlan] = useState<Tier | null>(null);
  const active = useRef(true);
  async function load() {
    setLoading(true);
    try {
      const [current, available] = await Promise.all([api.subscription(), api.plans()]);
      if (active.current) { setState(current); setPlans([...available].filter((p) => p.enabled).sort((a, b) => a.sort_order - b.sort_order)); }
    } finally { if (active.current) setLoading(false); }
  }
  useEffect(() => {
    active.current = true;
    void load().catch((e) => { if (active.current) setError(messageOf(e)); });
    return () => { active.current = false; };
  }, []);
  const currentId = state?.tier?.id || state?.subscription?.tier_id;
  const expires = state?.expires_at ?? state?.subscription?.expires_at;
  async function refresh() {
    setError("");
    try { await Promise.all([load(), onChanged()]); } catch (e) { if (active.current) setError(messageOf(e)); }
  }
  return <SubscriptionFrame title="Subscription" onClose={onClose}>
    {error && <div className="kvs-notice kvs-error" role="alert">{error}{!state && <button className="kvs-button" disabled={loading} onClick={() => void refresh()}>Retry</button>}</div>}
    {success && <div className="kvs-notice" role="status">{success}</div>}
    {!state ? !error && <p className="kvs-loading">Loading subscription…</p> : <>
      <section className="kvs-current">
        <div><div className="kvs-current-label"><div className="kvs-eyebrow">YOUR CURRENT PLAN</div><h2 className="kvs-current-name">{state.tier?.name || "No active plan"}</h2></div>
          <p className="kvs-muted">{expires ? `${expires * 1000 < Date.now() ? "Expired" : "Active until"} ${new Date(expires * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}` : "Included with your Kividas account"}</p>
        </div><button type="button" className="kvs-button" disabled={loading || busy} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh"}</button>
      </section>
      <div className="kvs-section-heading"><h2>Available plans</h2><span className="kvs-muted">Kividas subscriptions</span></div>
      <div className="kvs-plans">{plans.map((plan) => <article key={plan.id} className={`kvs-plan ${plan.id === currentId ? "kvs-plan-current" : ""}`}>
        <div className="kvs-plan-heading"><h3>{plan.name}</h3>{plan.id === currentId && <span className="kvs-badge">Current plan</span>}</div>
        <div className="kvs-price"><strong>${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(plan.price_usd)}</strong><span className="kvs-muted">/ {plan.price_usd === 0 ? "Free" : `${plan.duration_days} days`}</span></div>
        <p className="kvs-plan-description">{plan.description || "Access to Kividas with the usage limits below."}</p>
        <dl className="kvs-limits"><div><dt>5-hour usage</dt><dd>{limit(plan.token_limit_5h)}</dd></div><div><dt>Weekly usage</dt><dd>{limit(plan.token_limit_week)}</dd></div></dl>
        <button type="button" className="kvs-models-button" aria-label={`${plan.name} models`} aria-haspopup="dialog" onClick={() => setModelPlan(plan)}>Models →</button>
      </article>)}{!plans.length && <p className="kvs-muted">No plans are currently available.</p>}</div>
      <h2 className="kvs-redeem-heading">Redeem a code</h2>
      <section className="kvs-redeem"><img className="kvs-gift" src={gift} alt="" /><div className="kvs-redeem-area">
        <p className="kvs-muted">Have an activation code? Enter it below to activate your Kividas plan.</p>
        <form className="kvs-redeem-form" onSubmit={async (e) => {
          e.preventDefault(); if (busy || !code.trim()) return;
          setBusy(true); setError(""); setSuccess("");
          try {
            await api.redeem(code.trim());
            if (!active.current) return;
            setCode(""); setSuccess("Your plan has been activated successfully.");
            try { await Promise.all([load(), onChanged()]); }
            catch (e) { if (active.current) setError(`Code redeemed, but account refresh failed. Use Refresh to retry. ${messageOf(e)}`); }
          } catch (e) { if (active.current) setError(messageOf(e)); }
          finally { if (active.current) setBusy(false); }
        }}>
          <input className="kvs-input kvs-code" aria-label="Kividas activation code" placeholder="ENTER YOUR CODE" autoComplete="off" spellCheck={false} maxLength={100} required disabled={busy} value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="kvs-button kvs-redeem-button" disabled={loading || busy || !code.trim()}>{busy ? "Activating…" : "Redeem"}</button>
        </form><div className="kvs-code-note">Your code determines the plan and activation period.</div>
      </div></section>
    </>}
    {modelPlan && <PlanModels plan={modelPlan} onClose={() => setModelPlan(null)} />}
  </SubscriptionFrame>;
}
