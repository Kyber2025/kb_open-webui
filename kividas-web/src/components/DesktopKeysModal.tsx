import { useEffect, useState } from 'react';
import { Copy, Download, KeyRound, RefreshCw } from 'lucide-react';
import type { ManagedUser } from '../lib/admin-users';
import { desktopKeysApi, desktopKeyStatus, desktopClientText, type DesktopKeys, type DesktopKey, type CreatedDesktopKey } from '../lib/desktop-keys';
import { Modal, Loading, ErrorPanel, messageOf, useNotify } from './UI';
const time = (value: string | null) => value ? new Date(value).toLocaleString() : '尚未使用';
export function DesktopKeysModal({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const [data, setData] = useState<DesktopKeys | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [label, setLabel] = useState(''), [days, setDays] = useState(30);
  const [created, setCreated] = useState<CreatedDesktopKey | null>(null), [confirm, setConfirm] = useState<DesktopKey | null>(null);
  const notify = useNotify();
  async function load() { setError(''); try { setData(await desktopKeysApi.list(user.id)); } catch (e) { setError(messageOf(e)); } }
  useEffect(() => { void load(); }, [user.id]);
  const active = data?.keys.filter(k => !k.revokedAt && new Date(k.expiresAt).getTime() > Date.now()).length ?? 0;
  async function generate(e: React.FormEvent) {
    e.preventDefault(); if (busy || created) return;
    setBusy(true); setError('');
    try { setCreated(await desktopKeysApi.create(user.id, label.trim(), days)); await load(); }
    catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  async function revoke() {
    if (!confirm || busy) return; setBusy(true); setError('');
    try { await desktopKeysApi.revoke(user.id, confirm.id); setConfirm(null); await load(); notify('桌面 Key 已停用'); }
    catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  async function copy() {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.token); notify('桌面 Key 已复制'); }
    catch { setError('复制失败，请在 Key 文本框中手动选择并复制。'); }
  }
  function download() {
    if (!created) return;
    const url = URL.createObjectURL(new Blob([desktopClientText(created, user.email)], {type: 'text/plain;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'Claude桌面接入资料.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Modal title="桌面专用 Key" wide onClose={() => { if (!busy) onClose(); }}>
    <div className="desktop-keys">
      <p className="muted">{user.name} · {user.email}</p>
      <p>官方 Claude 桌面独立接入。桌面与 Chat 用量合并到此用户，现有网页密钥和对外 API 不变。</p>
      {error && <ErrorPanel error={error} retry={() => void load()} />}
      {!data && !error && <Loading />}
      {created ? <section className="desktop-key-created">
        <h3><KeyRound size={18} /> 已生成，请立即保存</h3>
        <p>完整 Key 只在这里显示一次。关闭后无法再次查看；遗失时停用并重新生成。</p>
        <label>桌面专用 Key<textarea readOnly rows={2} value={created.token} spellCheck={false} autoComplete="off" aria-label="新生成的桌面 Key" /></label>
        <p className="muted">有效期至 {time(created.key.expiresAt)} · 首次正式会话绑定电脑</p>
        <div className="row"><button className="btn primary" onClick={() => void copy()}><Copy size={16}/>复制 Key</button>
          <button className="btn" onClick={download}><Download size={16}/>下载客户接入 TXT</button></div>
        <p className="muted">TXT 包含本次 Key 和客户登录邮箱，不含登录密码。请单独、安全地交给对应客户。</p>
        <button className="btn" onClick={() => setCreated(null)}>我已保存，隐藏 Key</button>
      </section> : data && <form className="desktop-key-form" onSubmit={e => void generate(e)}>
        <h3>为这位用户生成</h3>
        {!data.eligible && <p className="error-panel">{data.reason}</p>}
        <div className="desktop-key-fields"><label>电脑名称<input placeholder="例如：客户的 Windows 笔记本" value={label} onChange={e => setLabel(e.target.value)} maxLength={80} required disabled={busy || !data.eligible}/></label>
          <label>有效期<select value={days} onChange={e => setDays(Number(e.target.value))} disabled={busy || !data.eligible}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option></select></label></div>
        <p className="muted">不超过用户订阅到期日。每位用户最多 {data.policy.maxActiveKeys} 个有效 Key，每台电脑使用独立 Key。</p>
        <button className="btn primary" disabled={busy || !data.eligible || !label.trim() || active >= data.policy.maxActiveKeys}><KeyRound size={16}/>{busy ? '处理中…' : '生成桌面 Key'}</button>
        {active >= data.policy.maxActiveKeys && <p className="muted">有效 Key 已达上限，请先停用旧 Key。</p>}
      </form>}
      {data && <>
        <div className="row between"><h3>已发放的 Key</h3><button className="icon-btn" title="刷新桌面 Key" aria-label="刷新桌面 Key" disabled={busy} onClick={() => void load()}><RefreshCw size={16}/></button></div>
        {!data.keys.length && <p className="muted">尚未发放桌面 Key。</p>}
        <div className="desktop-key-list">{data.keys.map(key => <article key={key.id}>
          <div className="row between"><strong>{key.label}</strong><span className="badge">{desktopKeyStatus(key)}</span></div>
          <div className="muted">尾号 ···{key.suffix} · 到期 {time(key.expiresAt)}</div>
          <div className="muted">最后使用：{time(key.lastUsedAt)}</div>
          {key.revokeReason === 'device_conflicts' && <p>检测到多台电脑复用，已自动停用。</p>}
          {!key.revokedAt && new Date(key.expiresAt).getTime() > Date.now() && <button className="btn danger" disabled={busy} onClick={() => setConfirm(key)}>停用此 Key</button>}
          {confirm?.id === key.id && <div className="desktop-key-confirm"><p>停用“{key.label}”后，这台电脑的新请求会被拒绝。Chat 网页和其他 Key 可继续使用。</p><div className="row"><button className="btn danger" disabled={busy} onClick={() => void revoke()}>确认停用</button><button className="btn" disabled={busy} onClick={() => setConfirm(null)}>取消</button></div></div>}
        </article>)}</div>
        <details><summary>防共享规则与使用说明</summary><p>一 Key 一电脑。10 分钟内出现 3 次设备不匹配会自动停用该 Key；更换电脑请重新生成。</p>
          <p>每个 Key 最多 {data.policy.concurrentPerKey} 个并行模型请求、每分钟 {data.policy.requestsPerMinute} 个模型请求；同一用户桌面总并行上限 {data.policy.concurrentPerUser}。运行中的请求结束后再切换网络，一小时最多 {data.policy.networksPerHour} 个出口地址。</p>
          <p>这些规则能限制共享和批量转发，无法完全识别伪装成同一电脑、同一网络的中转。异常时可在此单独停用。</p>
          <p>用量：客户登录 chat.kividas.com，点击输入框右下方的用量圈。此处显示平台统计的个人用量。</p></details>
      </>}
    </div>
  </Modal>;
}
