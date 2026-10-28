import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { Model, Tier, SubscriptionCheckout } from "../lib/types";
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
  const [resumeOrder, setResumeOrder] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<Tier | null>(null), [pendingOrder, setPendingOrder] = useState<SubscriptionCheckout | null>(null);
  const [state, setState] = useState<SubscriptionState | null>(null), [plans, setPlans] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [code, setCode] = useState("");
  const [error, setError] = useState(""), [success, setSuccess] = useState(""), [modelPlan, setModelPlan] = useState<Tier | null>(null);
  const active = useRef(true);
  async function load() {
    setLoading(true);
    try {
      const [current, available, pending] = await Promise.all([api.subscription(), api.plans(), api.checkout().catch((e) => { if (active.current) setError(messageOf(e)); return null; })]);
      if (active.current) { setState(current); setPendingOrder(pending); setPlans([...available].filter((p) => p.enabled && p.id !== "max").sort((a, b) => a.sort_order - b.sort_order)); }
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
      <div className="kvs-section-heading"><h2>Available plans</h2><span className="kvs-muted">USDT 支付 · 确认到账后自动开通</span></div>
      {pendingOrder && <div className="kvs-notice">有一笔待处理的 {pendingOrder.tier_name} 订单。<button className="kvs-button" onClick={() => { setResumeOrder(true); setCheckoutPlan(plans.find(p => p.id === pendingOrder.tier_id) || null); }}>继续付款 / 查看状态</button></div>}
      <div className="kvs-plans">{plans.map((plan) => <article key={plan.id} className={`kvs-plan ${plan.id === currentId ? "kvs-plan-current" : ""}`}>
        <div className="kvs-plan-heading"><h3>{plan.name}</h3>{plan.id === currentId && <span className="kvs-badge">Current plan</span>}</div>
        <div className="kvs-price"><span className="kvs-currency">US$</span><strong>{new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(plan.price_usd)}</strong><span className="kvs-period">{plan.price_usd === 0 ? "Free" : `/ ${plan.duration_days} days`}</span></div>
        <p className="kvs-plan-description">{plan.description || "Access to Kividas with the usage limits below."}</p>
        <dl className="kvs-limits"><div><dt>5-hour usage</dt><dd>{limit(plan.token_limit_5h)}</dd></div><div><dt>Weekly usage</dt><dd>{limit(plan.token_limit_week)}</dd></div></dl>
        <button type="button" className="kvs-models-button" aria-label={`${plan.name} models`} aria-haspopup="dialog" onClick={() => setModelPlan(plan)}>Models →</button>
        {plan.price_usd > 0 ? <div className="kvs-purchase"><p className="kvs-stock" data-available={(plan.remaining ?? 0) > 0}>{plan.remaining == null ? "可购买数量暂不可用" : `剩余可购买：${plan.remaining}`}</p>
          <button type="button" className="kvs-button kvs-redeem-button" disabled={loading || busy || !plan.can_purchase} onClick={() => { setResumeOrder(false); setCheckoutPlan(plan); }}>{!plan.can_purchase ? plan.remaining === 0 ? "已售罄" : "暂不可购买" : currentId === "pro" && plan.id === "ultra" ? "升级到 Max 20x" : plan.id === currentId ? "USDT 续订" : "USDT 购买"}</button></div>
          : <p className="kvs-included">Included with your Kividas account</p>}
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
    {checkoutPlan && <Checkout resume={resumeOrder} plan={checkoutPlan} upgrade={currentId === "pro" && checkoutPlan.id === "ultra"} initial={pendingOrder?.tier_id === checkoutPlan.id ? pendingOrder : null}
      onClose={() => { setCheckoutPlan(null); void refresh(); }} onPaid={async () => { setSuccess("付款成功，订阅已开通。"); await refresh(); }} />}
  </SubscriptionFrame>;
}

export function Checkout({ plan, initial, upgrade, resume = false, onClose, onPaid }: { resume?: boolean; plan: Tier; initial: SubscriptionCheckout | null; upgrade: boolean; onClose: () => void; onPaid: () => Promise<void> }) {
  const [chains, setChains] = useState<{ id: string; name: string }[]>([]), [chain, setChain] = useState("56");
  const unpaid = (value: SubscriptionCheckout | null) => !!value && !value.activated && ["CREATING", "PENDING", "EXPIRED", "FAILED", "CANCELLED"].includes(value.status);
  const [previousOrder, setPreviousOrder] = useState(unpaid(initial) ? initial : null);
  const [order, setOrder] = useState(resume || !unpaid(initial) ? initial : null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [ready, setReady] = useState(!!initial);
  const revision = useRef(0);
  const alive = useRef(true), notified = useRef(false), paid = useRef(onPaid);
  paid.current = onPaid;
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    if (!initial) void api.checkout(plan.id).then(value => {
      if (stopped) return;
      if (unpaid(value)) { setPreviousOrder(value); setOrder(resume ? value : null); }
      else setOrder(value);
      setReady(true);
    }).catch(e => { if (!stopped) setError(messageOf(e)); });
    api.paymentChains().then(c => { if (!stopped) { setChains(c); setChain(c.some(x => x.id === "56") ? "56" : c[0]?.id || ""); } }).catch(e => { if (!stopped) setError(messageOf(e)); });
    return () => { stopped = true; alive.current = false; revision.current++; };
  }, []);
  useEffect(() => {
    if (!order || ["EXPIRED", "FAILED", "CANCELLED", "PAID_REQUIRES_ADMIN"].includes(order.status)) return;
    let stopped = false; const requestRevision = revision.current; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.subscriptionOrder(order!.order_id);
        if (stopped || requestRevision !== revision.current) return;
        setOrder(previous => ({ ...next, qr_code_image: next.qr_code_image || previous?.qr_code_image })); setError("");
        if (next.activated) { if (!notified.current) { notified.current = true; await paid.current(); } return; }
        if (["EXPIRED", "FAILED", "PAID_REQUIRES_ADMIN"].includes(next.status)) return;
      } catch (e) { if (!stopped && requestRevision === revision.current) setError(messageOf(e)); }
      if (!stopped && requestRevision === revision.current) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [order?.order_id, order?.status]);
  async function create() {
    if (busy || !chain || !ready) return;
    const requestRevision = ++revision.current;
    setBusy(true); setError("");
    try { const value = await api.buySubscription(plan.id, chain); if (alive.current && requestRevision === revision.current) setOrder(value); }
    catch (e) { if (alive.current) setError(messageOf(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  return <SubscriptionFrame title="Kividas 订阅" onClose={onClose} models>
    <div className="kvs-checkout-summary"><h3>{plan.name}</h3><div className="kvs-price"><strong>{order?.amount || plan.price_usd}</strong><span className="kvs-currency">USDT</span><span className="kvs-period">{plan.duration_days} 天</span></div></div>
    {error && <p className="kvs-notice kvs-error" role="alert">{error}</p>}
    {!order ? <>{upgrade && <p className="kvs-upgrade-note">支付成功后将替换原 5x 订阅，按 20x 全价收费。原 5x 剩余时间不退款、不抵扣。20x 从升级成功起计 30 天，5 小时和每周用量同时重置。</p>}<label className="kvs-checkout-label">支付网络<select className="kvs-input" value={chain} onChange={e => setChain(e.target.value)} disabled={busy}>{chains.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <p className="kvs-muted">未付款不占名额，可关闭订单并选择其他套餐。请使用选定网络支付；确认到账后才分配名额，若届时已满，会提示联系管理员处理。</p>
      <button className="kvs-button kvs-redeem-button kvs-checkout-action" disabled={busy || !ready || !chains.length || !chain} onClick={() => void create()}>{!ready ? "正在核对已有订单…" : busy ? "正在生成收银台…" : "生成 USDT 付款订单"}</button>
      {previousOrder && <><p className="kvs-muted">如果已经转账，请查看已有订单，不要重复付款。</p><button className="kvs-button" disabled={busy} onClick={() => { revision.current++; setError(""); setOrder(previousOrder); }}>查看已有订单（{chains.find(c => c.id === previousOrder.chain_id)?.name || previousOrder.chain_id} · {previousOrder.amount} USDT）</button></>}</>
      : order.activated ? <div className="kvs-notice" role="status">付款成功，{order.tier_name} 已开通。<button className="kvs-button" onClick={onClose}>完成</button></div>
      : <div className="kvs-checkout"><p role="status">{order.status === "PAID_REQUIRES_ADMIN" ? "付款已到账，订阅尚未开通，请联系管理员处理。请提供下方订单号，无需再次付款。" : order.status === "PAID" ? "已确认到账，正在同步订阅，请勿重复付款。" : order.status === "EXPIRED_CHECKING" ? "付款窗口已结束，正在核对链上到账，请勿继续转账。" : ["EXPIRED", "FAILED"].includes(order.status) ? "订单已失效，请关闭后重新购买。" : "等待 USDT 到账确认…"}</p>
        {order.status === "PENDING" && <><p><strong>{chains.find(c => c.id === order.chain_id)?.name || order.chain_id}</strong></p>
          {order.qr_code_image && <img className="kvs-payment-qr" src={order.qr_code_image} alt="USDT 收款地址二维码" />}
          <label className="kvs-checkout-label">收款地址<input readOnly className="kvs-input" value={order.address || ""} onFocus={e => e.target.select()} /></label>
          <p>应付 <strong>{order.amount} USDT</strong></p><p className="kvs-muted">请在 {new Date(order.expires_at * 1000).toLocaleString()} 前完成付款。仅发送所选网络的 USDT，手续费另计。</p></>}
        {["PENDING", "EXPIRED", "FAILED", "CANCELLED"].includes(order.status) && <button className="kvs-button" onClick={() => { revision.current++; setPreviousOrder(order.status === "PENDING" ? order : null); setChain(order.chain_id); setOrder(null); setError(""); }}>重新选择支付网络</button>}
        {order.status === "PAID_REQUIRES_ADMIN" && <button className="kvs-button" disabled={busy} onClick={async () => { setBusy(true); try { const next = await api.subscriptionOrder(order.order_id); if (alive.current) { setOrder(next); if (next.activated && !notified.current) { notified.current = true; await paid.current(); } } } catch (e) { if (alive.current) setError(messageOf(e)); } finally { if (alive.current) setBusy(false); } }}>管理员处理后，重新检查</button>}
        <p className="kvs-code-note">订单：{order.order_id}</p><p className="kvs-muted">付款和订单记录会保留，可关闭窗口后在订阅页继续查看。</p>
      </div>}
  </SubscriptionFrame>;
}
