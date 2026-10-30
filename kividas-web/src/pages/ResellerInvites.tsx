import { useEffect, useState } from "react";
import { api, type ResellerInvite } from "../lib/api";
import { ErrorPanel, Loading, messageOf, useNotify } from "../components/UI";

export function ResellerInvites() {
  const [items, setItems] = useState<ResellerInvite[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const notify = useNotify();
  const link = (token: string) => `${window.location.origin}/auth?invite=${encodeURIComponent(token)}`;
  async function load() { setItems(await api.resellerInvites()); }
  useEffect(() => { void load().catch(e => setError(messageOf(e))).finally(() => setLoading(false)); }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); await load(); } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  return <section className="admin-content">
    <div className="section-heading"><div><h2>代理邀请</h2><p>通过邀请注册的客户保留套餐、有效期、额度和兑换码，隐藏订阅价格与购买入口。普通用户保持原样。</p></div></div>
    <form className="panel" onSubmit={e => { e.preventDefault(); void run(async () => {
      await api.createResellerInvite(name.trim()); setName(""); notify("邀请链接已生成");
    }); }}>
      <label>代理名称<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="例如：代理 1" /></label>
      <button className="btn primary" disabled={busy || !name.trim()}>生成邀请链接</button>
    </form>
    {error && <ErrorPanel error={error} />}
    {loading ? <Loading /> : items.map(item => <article className="panel" key={item.id}>
      <div className="section-heading"><div><h3>{item.name}</h3><p>{item.enabled ? "使用中" : "已停用"} · 已注册 {item.customers} 位客户</p></div>
        <button className="btn" disabled={busy} onClick={() => void run(async () => { await api.resellerInviteStatus(item.id, !item.enabled); })}>{item.enabled ? "停用链接" : "启用链接"}</button>
      </div>
      <label>专属注册链接<input readOnly value={link(item.token)} onFocus={e => e.currentTarget.select()} /></label>
      <button className="btn" onClick={() => void navigator.clipboard.writeText(link(item.token)).then(() => notify("邀请链接已复制")).catch(e => setError(messageOf(e)))}>复制链接</button>
    </article>)}
    <p className="muted">停用仅阻止新注册，已注册客户仍由原服务商管理。邀请不会自动开通付费套餐。</p>
  </section>;
}
