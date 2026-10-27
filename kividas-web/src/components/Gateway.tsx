import { useEffect, useRef, useState } from 'react';
import { Check, Download, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import type { User } from '../lib/types';
import { gatewayApi, type GatewayState } from '../lib/gateway';
import { downloadDesktopClientText, type DesktopKey } from '../lib/desktop-keys';
import { GatewayResources } from './GatewayResources';
import { Loading, messageOf, Modal } from './UI';

export function Gateway({ user, onClose, onSubscription }: { user: User; onClose: () => void; onSubscription: () => void }) {
  const [state, setState] = useState<GatewayState | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState('');
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const mounted = useRef(true);
  async function load() {
    setLoading(true);
    try { const data = await gatewayApi.status(); if (mounted.current) { setState(data); setError(''); } }
    catch (e) { if (mounted.current) setError(messageOf(e)); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  async function download(key: DesktopKey) {
    if (busy) return;
    setBusy(key.id); setError(''); setSuccess('');
    try {
      const result = await gatewayApi.download(key.id);
      if (!mounted.current) return;
      downloadDesktopClientText(result, user.email);
      setSuccess('资料已下载。可重复下载，Key 和安装识别码保持不变。');
      await load();
      window.dispatchEvent(new Event('gateway-updated'));
    } catch (e) { if (mounted.current) setError(messageOf(e)); }
    finally { if (mounted.current) setBusy(''); }
  }
  return <Modal title="Gateway" onClose={onClose} wide>
    <div className="gateway-account">
      <p className="muted">使用你的 Kividas 订阅接入官方 Claude 桌面端和 Claude Code CLI。</p>
      <div className="gateway-owner"><ShieldCheck size={18} /><span>{user.email}</span><button className="icon-btn" aria-label="Refresh Gateway" disabled={loading || !!busy} onClick={() => void load()}><RefreshCw size={15} /></button></div>
      <section className="gateway-personal" aria-labelledby="gateway-personal-heading">
        <h3 id="gateway-personal-heading"><KeyRound size={18} />我的接入资料</h3>
        <p className="muted">管理员为你发放接入资料后，可随时重复下载。下载不会更换 Key，也不会让以前的资料失效。</p>
        {error && <div className="gateway-notice error" role="alert">{error}</div>}
        {success && <div className="gateway-notice success" role="status"><Check size={16} />{success}</div>}
        {loading && !state ? <Loading text="正在读取接入资料…" /> : state && <>
          {!state.subscribed ? <div className="gateway-empty"><p>{state.reason}</p><button className="btn primary" onClick={onSubscription}>查看订阅</button></div> : <>
            {!state.eligible && <p className="gateway-notice">{state.reason}</p>}
            {state.keys.map(key => {
              const available = state.eligible && !key.revokedAt && key.canReveal && !!key.installationId;
              return <article className="gateway-key" key={key.id}>
                <div><strong>{key.label}</strong><span>Key ···{key.suffix}</span><small>{key.revokedAt ? key.revokeReason === 'device_conflicts' ? '设备标识冲突，已自动停用' : '已停用，请联系管理员' : !key.canReveal || !key.installationId ? '旧资料需要管理员协助更新' : key.boundAt ? '已绑定安装标识' : '等待首次配置'}</small>{key.lastUsedAt && <small>最近使用：{new Date(key.lastUsedAt).toLocaleString()}</small>}</div>
                <button className="btn" disabled={!available || !!busy} onClick={() => void download(key)}><Download size={16} />{busy === key.id ? '正在下载…' : '下载客户资料 TXT'}</button>
              </article>;
            })}
            {!state.keys.length && state.eligible && <p className="muted">暂无可下载资料，请联系管理员开通。</p>}
            <p className="gateway-private-note">TXT 包含你的专属 Key 和安装识别码，请妥善保存。换电脑或怀疑资料泄露时，请联系管理员停用旧资料并重新发放；添加设备请联系管理员另行开通。</p>
          </>}
        </>}
        {!state && error && <button className="btn" onClick={() => void load()}>重试</button>}
      </section>
      <section aria-labelledby="gateway-guides-heading"><h3 id="gateway-guides-heading">配置教程与工具</h3><GatewayResources /></section>
    </div>
  </Modal>;
}
