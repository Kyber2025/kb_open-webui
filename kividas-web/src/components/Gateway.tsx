import { useEffect, useRef, useState } from 'react';
import { Check, Download, KeyRound, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import type { User } from '../lib/types';
import { gatewayApi, type GatewayState } from '../lib/gateway';
import { downloadDesktopClientText, type DesktopKey } from '../lib/desktop-keys';
import { GatewayResources } from './GatewayResources';
import { useKeyRefresh } from '../lib/use-key-refresh';
import { Loading, messageOf, Modal } from './UI';

export function Gateway({ user, onClose, onSubscription }: { user: User; onClose: () => void; onSubscription: () => void }) {
  const [state, setState] = useState<GatewayState | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState('');
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [label, setLabel] = useState('');
  const mounted = useRef(true);
  const working = useRef(false), sequence = useRef(0);
  async function load(quiet = false) {
    const request = ++sequence.current;
    if (!quiet) setLoading(true);
    try { const data = await gatewayApi.status(); if (mounted.current && request === sequence.current) { setState(data); if (!quiet) setError(''); } }
    catch (e) { if (mounted.current && !quiet) setError(messageOf(e)); }
    finally { if (mounted.current && !quiet) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  useKeyRefresh(() => load(true), loading || !!busy);
  async function generate() {
    if (working.current || !state?.canCreate) return;
    working.current = true; setBusy('create'); setError(''); setSuccess('');
    try {
      await gatewayApi.create(label.trim() || 'Claude Desktop');
      if (!mounted.current) return;
      setLabel(''); setSuccess('接入资料已生成，管理员也可查看。请下载下方客户资料 TXT 完成配置。');
      window.dispatchEvent(new Event('gateway-updated'));
    } catch (e) { if (mounted.current) setError(messageOf(e)); }
    finally { await load(true); working.current = false; if (mounted.current) setBusy(''); }
  }
  async function download(key: DesktopKey) {
    if (working.current) return;
    working.current = true;
    setBusy(key.id); setError(''); setSuccess('');
    try {
      const result = await gatewayApi.download(key.id);
      if (!mounted.current) return;
      downloadDesktopClientText(result, user.email);
      setSuccess('资料已下载。可重复下载，Key 和安装识别码保持不变。');
      await load(true);
      window.dispatchEvent(new Event('gateway-updated'));
    } catch (e) { if (mounted.current) { setError(messageOf(e)); await load(true); } }
    finally { working.current = false; if (mounted.current) setBusy(''); }
  }
  return <Modal title="Gateway" onClose={onClose} wide>
    <div className="gateway-account">
      <p className="muted">使用你的 Kividas 订阅接入官方 Claude 桌面端和 Claude Code CLI。</p>
      <div className="gateway-owner"><ShieldCheck size={18} /><span>{user.email}</span><button className="icon-btn" aria-label="Refresh Gateway" disabled={loading || !!busy} onClick={() => void load()}><RefreshCw size={15} /></button></div>
      <section className="gateway-personal" aria-labelledby="gateway-personal-heading">
        <h3 id="gateway-personal-heading"><KeyRound size={18} />我的接入资料</h3>
        <p className="muted">你可以自行生成接入资料，也可以使用管理员为你生成的资料。两边同步，下载不会更换 Key，也不会让以前的资料失效。</p>
        {error && <div className="gateway-notice error" role="alert">{error}</div>}
        {success && <div className="gateway-notice success" role="status"><Check size={16} />{success}</div>}
        {loading && !state ? <Loading text="正在读取接入资料…" /> : state && <>
          {!state.subscribed ? <div className="gateway-empty"><p>{state.reason}</p><button className="btn primary" onClick={onSubscription}>查看订阅</button></div> : <>
            {!state.eligible && <p className="gateway-notice">{state.reason}</p>}
            {state.eligible && <>
              <form className="gateway-create" onSubmit={event => { event.preventDefault(); void generate(); }}>
                <label>设备名称（可选）<input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} placeholder="例如：我的 Mac" disabled={!!busy || !state.canCreate} /></label>
                <button className="btn primary" disabled={loading || !!busy || !state.canCreate}><Plus size={16} />{busy === 'create' ? '正在生成…' : '生成接入资料'}</button>
              </form>
              <p className="muted">每个订阅账号仅限一台设备，最多保留 {state.policy.maxActiveKeys} 个有效 Key。{!state.canCreate && '已有有效 Key，可重复下载；更换设备请联系管理员先停用旧 Key。'}</p>
            </>}
            {state.keys.filter(key => state.eligible && !key.revokedAt && key.canReveal && key.installationId).map(key => {
              return <article className="gateway-key" key={key.id}>
                <div><strong>{key.label}</strong><span>Key ···{key.suffix}</span><small>{key.boundAt ? '已绑定安装标识' : '等待首次配置'}</small>{key.lastUsedAt && <small>最近使用：{new Date(key.lastUsedAt).toLocaleString()}</small>}</div>
                <button className="btn" disabled={!!busy} onClick={() => void download(key)}><Download size={16} />{busy === key.id ? '正在下载…' : '下载客户资料 TXT'}</button>
              </article>;
            })}
            {!state.keys.length && state.eligible && <p className="muted">暂无可用资料。{state.canCreate ? '点击上方“生成接入资料”即可创建。' : '请联系管理员处理。'}</p>}
            <p className="gateway-private-note">这里只显示可用资料；已停用或删除的资料不会显示。停用、删除由管理员处理，系统检测到滥用也会自动停用。TXT 包含你的专属 Key 和安装识别码，请勿共用；换电脑或怀疑泄露时请联系管理员。</p>
          </>}
        </>}
        {!state && error && <button className="btn" onClick={() => void load()}>重试</button>}
      </section>
      <section aria-labelledby="gateway-guides-heading"><h3 id="gateway-guides-heading">配置教程与工具</h3><GatewayResources /></section>
    </div>
  </Modal>;
}
