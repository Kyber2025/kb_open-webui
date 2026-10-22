import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import type { ManagedUser } from '../lib/admin-users';
import { desktopKeysApi, desktopKeyStatus, validDesktopConcurrency, type DesktopKeys, type DesktopKey } from '../lib/desktop-keys';
import { Modal, Loading, ErrorPanel, messageOf, useNotify } from './UI';

export function DesktopKeysModal({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const [data, setData] = useState<DesktopKeys | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState<{id: string; action: 'revoke' | 'delete'} | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({}), [limits, setLimits] = useState<Record<string, string>>({});
  const notify = useNotify();
  async function load() { setError(''); try { setData(await desktopKeysApi.list(user.id)); } catch (e) { setError(messageOf(e)); } }
  useEffect(() => { void load(); }, [user.id]);
  async function action(run: () => Promise<void>) {
    if (busy) return; setBusy(true); setError('');
    try { await run(); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  async function generate() {
    await action(async () => {
      const created = await desktopKeysApi.create(user.id);
      setSecrets(s => ({...s, [created.key.id]: created.token}));
      await load();
    });
  }
  async function view(key: DesktopKey) {
    if (secrets[key.id]) { setSecrets(s => { const next = {...s}; delete next[key.id]; return next; }); return; }
    await action(async () => { const result = await desktopKeysApi.reveal(user.id, key.id); setSecrets(s => ({...s,[key.id]:result.token})); });
  }
  async function copy(key: DesktopKey) {
    await action(async () => {
      const result = await desktopKeysApi.reveal(user.id, key.id);
      try { await navigator.clipboard.writeText(result.token); notify('Key 已复制'); }
      catch { setSecrets(s => ({...s,[key.id]:result.token})); throw new Error('自动复制失败，请在文本框中选择并复制。'); }
    });
  }
  async function revoke(key: DesktopKey) {
    await action(async () => {
      await desktopKeysApi.revoke(user.id, key.id); setConfirm(null);
      setSecrets(s => { const next = {...s}; delete next[key.id]; return next; });
      await load(); notify('此桌面 Key 已停用');
    });
  }
  async function remove(key: DesktopKey) {
    await action(async () => {
      await desktopKeysApi.delete(user.id, key.id); setConfirm(null);
      setSecrets(s => { const next = {...s}; delete next[key.id]; return next; });
      setLimits(s => { const next = {...s}; delete next[key.id]; return next; });
      await load(); notify('此桌面 Key 已删除');
    });
  }
  async function save(key: DesktopKey) {
    const value = limits[key.id] ?? String(key.concurrentLimit);
    if (!validDesktopConcurrency(value)) return;
    await action(async () => { await desktopKeysApi.policy(user.id, key.id, Number(value)); await load(); notify('并发数已保存'); });
  }
  const active = data?.keys.filter(k => !k.revokedAt).length ?? 0;
  return <Modal title="桌面专用 Key" onClose={() => { if (!busy) onClose(); }}>
    <div className="desktop-keys desktop-keys-simple">
      <p className="muted">{user.name} · {user.email}</p>
      <p className="muted">有效期跟随用户订阅；桌面与 Chat 合并统计用量。</p>
      {error && <ErrorPanel error={error} retry={() => void load()} />}
      {!data && !error && <Loading />}
      {data && <>
        <button className="btn primary" disabled={busy || !data.eligible || active >= data.policy.maxActiveKeys} onClick={() => void generate()}><Plus size={16}/>生成 Key</button>
        {!data.eligible && <p className="muted">{data.reason}</p>}
        {active >= data.policy.maxActiveKeys && <p className="muted">已有 {active} 个有效 Key，更换电脑请先停用旧 Key。</p>}
        <div className="desktop-key-list">{data.keys.map(key => <article key={key.id}>
          <div className="row between"><strong>Key ···{key.suffix}</strong><div className="row"><span className="badge">{desktopKeyStatus(key)}</span><button className="icon-btn danger" title="删除 Key" aria-label={`删除 Key ···${key.suffix}`} disabled={busy} onClick={() => setConfirm({id: key.id, action: 'delete'})}><Trash2 size={16}/></button></div></div>
          {key.expiresAt && !key.revokedAt && <div className="muted">订阅到期：{new Date(key.expiresAt).toLocaleDateString()}</div>}
          {!key.revokedAt && <>
            <input className="desktop-key-value" aria-label={`Key ···${key.suffix}`} readOnly value={secrets[key.id] ?? `••••••••••••••••${key.suffix}`} spellCheck={false} autoComplete="off" />
            <div className="row"><button className="btn" disabled={busy || !key.canReveal} onClick={() => void view(key)}>{secrets[key.id] ? <EyeOff size={16}/> : <Eye size={16}/>}{secrets[key.id] ? '隐藏' : '查看'}</button><button className="btn" disabled={busy || !key.canReveal} onClick={() => void copy(key)}><Copy size={16}/>复制</button><button className="btn danger" disabled={busy} onClick={() => setConfirm({id: key.id, action: 'revoke'})}>停用</button></div>
            <div className="desktop-key-policy"><label>并发数<input type="number" min="0" step="1" aria-label={`并发数 ···${key.suffix}`} value={limits[key.id] ?? String(key.concurrentLimit)} onChange={e => setLimits(s=>({...s,[key.id]: e.target.value}))} disabled={busy}/></label><button className="btn" disabled={busy || !validDesktopConcurrency(limits[key.id] ?? String(key.concurrentLimit))} onClick={() => void save(key)}>保存</button><span className="muted">0 = 不限制</span></div>
          </>}
          {confirm?.id === key.id && <div className="desktop-key-confirm"><p>{confirm.action === 'delete' ? '删除后此 Key 立即失效并从列表移除，无法恢复。确认删除？' : '停用此桌面 Key？Chat 网页仍可使用。'}</p><div className="row"><button className="btn danger" disabled={busy} onClick={() => void (confirm.action === 'delete' ? remove(key) : revoke(key))}>{confirm.action === 'delete' ? '确认删除' : '确认停用'}</button><button className="btn" disabled={busy} onClick={() => setConfirm(null)}>取消</button></div></div>}
        </article>)}</div>
      </>}
    </div>
  </Modal>;
}
