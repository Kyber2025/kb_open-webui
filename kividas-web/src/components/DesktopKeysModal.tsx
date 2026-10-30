import { useEffect, useState } from 'react';
import { Copy, Download, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import type { ManagedUser } from '../lib/admin-users';
import { desktopKeysApi, desktopKeyStatus, desktopDevicePolicyText, downloadDesktopClientText, DESKTOP_INSTALLATION_HEADER, validDesktopConcurrency, type DesktopKeys, type DesktopKey } from '../lib/desktop-keys';
import { Modal, Loading, ErrorPanel, messageOf, useNotify } from './UI';
import { useKeyRefresh } from '../lib/use-key-refresh';

export function DesktopKeysModal({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const [data, setData] = useState<DesktopKeys | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState<{id: string; action: 'revoke' | 'delete'} | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({}), [limits, setLimits] = useState<Record<string, string>>({});
  const [exportKeyId, setExportKeyId] = useState<string | null>(null), [exportPassword, setExportPassword] = useState('');
  const notify = useNotify();
  async function load() { setError(''); try { setData(await desktopKeysApi.list(user.id)); } catch (e) { setError(messageOf(e)); } }
  useEffect(() => { setSecrets({}); setExportKeyId(null); setExportPassword(''); void load(); }, [user.id]);
  useKeyRefresh(load, busy || !!confirm || !!exportKeyId);
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
    let token: string | undefined;
    await action(async () => {
      const result = await desktopKeysApi.reveal(user.id, key.id);
      token = result.token;
    });
    if (!token) return;
    // Chromium can leave this promise pending while the document is not focused.
    // Waiting for OS clipboard access must not lock all key-management controls.
    try { await navigator.clipboard.writeText(token); notify('Key 已复制'); }
    catch { setError('自动复制失败，请点击“查看”，在文本框中选择并复制。'); }
  }
  async function copyInstallation(key: DesktopKey) {
    if (!key.installationId) return;
    try { await navigator.clipboard.writeText(key.installationId); notify('安装识别码已复制'); }
    catch { setError('自动复制失败，请在安装识别码文本框中选择并复制。'); }
  }
  async function download(key: DesktopKey) {
    await action(async () => {
      // Recheck authorization and revocation for every download. The optional
      // delivery password stays in memory and never enters an API request/storage.
      const created = await desktopKeysApi.reveal(user.id, key.id);
      downloadDesktopClientText(created, user.email, exportPassword);
      setExportKeyId(null); setExportPassword(''); notify('客户资料 TXT 已下载');
    });
  }
  async function revoke(key: DesktopKey) {
    await action(async () => {
      await desktopKeysApi.revoke(user.id, key.id); setConfirm(null);
      setExportKeyId(null); setExportPassword('');
      setSecrets(s => { const next = {...s}; delete next[key.id]; return next; });
      await load(); notify('此桌面 Key 已停用');
    });
  }
  async function remove(key: DesktopKey) {
    await action(async () => {
      await desktopKeysApi.delete(user.id, key.id); setConfirm(null);
      setExportKeyId(null); setExportPassword('');
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
        <p className="muted">{desktopDevicePolicyText(data.policy)}{active >= data.policy.maxActiveKeys && '更换电脑请先停用旧 Key，再生成新资料。'}</p>
        <div className="desktop-key-list">{data.keys.map(key => <article key={key.id}>
          <div className="row between"><strong>Key ···{key.suffix}</strong><div className="row"><span className="badge">{desktopKeyStatus(key)}</span><button className="icon-btn danger" title="删除 Key" aria-label={`删除 Key ···${key.suffix}`} disabled={busy} onClick={() => setConfirm({id: key.id, action: 'delete'})}><Trash2 size={16}/></button></div></div>
          <p className="muted">{key.label}</p>
          {key.expiresAt && !key.revokedAt && <div className="muted">订阅到期：{new Date(key.expiresAt).toLocaleDateString()}</div>}
          {!key.revokedAt && <>
            <input className="desktop-key-value" aria-label={`Key ···${key.suffix}`} readOnly value={secrets[key.id] ?? `••••••••••••••••${key.suffix}`} spellCheck={false} autoComplete="off" />
            <div className="row"><button className="btn" disabled={busy || !key.canReveal} onClick={() => void view(key)}>{secrets[key.id] ? <EyeOff size={16}/> : <Eye size={16}/>}{secrets[key.id] ? '隐藏' : '查看'}</button><button className="btn" disabled={busy || !key.canReveal} onClick={() => void copy(key)}><Copy size={16}/>复制</button><button className="btn danger" disabled={busy} onClick={() => setConfirm({id: key.id, action: 'revoke'})}>停用</button></div>
            <label className="desktop-installation-label">安装识别码<input className="desktop-key-value" aria-label={`安装识别码 ···${key.suffix}`} readOnly value={key.installationId ?? ''} placeholder="此旧 Key 尚未保存安装识别码" spellCheck={false} autoComplete="off" /></label>
            <div className="row"><button className="btn" disabled={busy || !key.installationId} onClick={() => void copyInstallation(key)}><Copy size={16}/>复制识别码</button><button className="btn" disabled={busy || !key.canReveal || !key.installationId} onClick={() => { setExportKeyId(key.id); setExportPassword(''); }}><Download size={16}/>下载客户资料 TXT</button></div>
            <p className="muted desktop-installation-help">客户填写的 Name 固定为 {DESKTOP_INSTALLATION_HEADER}，Value 填上方识别码。同一台电脑一直沿用。</p>
            {exportKeyId === key.id && <div className="desktop-key-export"><label>客户登录密码（可选）<input type="password" aria-label="客户登录密码（可选）" autoComplete="new-password" value={exportPassword} onChange={e => setExportPassword(e.target.value)} disabled={busy}/></label><p className="muted">填入客户现有密码，可一并写入 TXT。留空则提示使用已有密码；这里只用于本次下载，不修改账号密码。</p><div className="row"><button className="btn primary" disabled={busy} onClick={() => void download(key)}>下载 TXT</button><button className="btn" disabled={busy} onClick={() => {setExportKeyId(null); setExportPassword('');}}>取消</button></div></div>}
            <div className="desktop-key-policy"><label>并发数<input type="number" min="0" step="1" aria-label={`并发数 ···${key.suffix}`} value={limits[key.id] ?? String(key.concurrentLimit)} onChange={e => setLimits(s=>({...s,[key.id]: e.target.value}))} disabled={busy}/></label><button className="btn" disabled={busy || !validDesktopConcurrency(limits[key.id] ?? String(key.concurrentLimit))} onClick={() => void save(key)}>保存</button><span className="muted">0 = 不限制</span></div>
          </>}
          {confirm?.id === key.id && <div className="desktop-key-confirm"><p>{confirm.action === 'delete' ? '删除后此 Key 立即失效并从列表移除，无法恢复。确认删除？' : '停用此桌面 Key？Chat 网页仍可使用。'}</p><div className="row"><button className="btn danger" disabled={busy} onClick={() => void (confirm.action === 'delete' ? remove(key) : revoke(key))}>{confirm.action === 'delete' ? '确认删除' : '确认停用'}</button><button className="btn" disabled={busy} onClick={() => setConfirm(null)}>取消</button></div></div>}
        </article>)}</div>
      </>}
    </div>
  </Modal>;
}
