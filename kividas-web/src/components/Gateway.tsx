import { useEffect, useRef, useState } from 'react';
import { Check, Download, KeyRound, Plus, RefreshCw, ShieldCheck, Ban, Trash2 } from 'lucide-react';
import type { User } from '../lib/types';
import { gatewayApi, type GatewayState } from '../lib/gateway';
import { downloadDesktopClientText, desktopDevicePolicyText, desktopKeyStatus, type DesktopKey } from '../lib/desktop-keys';
import { GatewayResources } from './GatewayResources';
import { useKeyRefresh } from '../lib/use-key-refresh';
import { Loading, messageOf, Modal } from './UI';

export function Gateway({ user, onClose, onSubscription }: { user: User; onClose: () => void; onSubscription: () => void }) {
  const [state, setState] = useState<GatewayState | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState('');
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [label, setLabel] = useState('');
  const [confirm, setConfirm] = useState<{ key: DesktopKey; action: 'revoke' | 'delete' } | null>(null);
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
  useKeyRefresh(() => load(true), loading || !!busy || !!confirm);
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
  async function manage() {
    if (working.current || !confirm) return;
    const { key, action } = confirm;
    working.current = true; setBusy(action + ':' + key.id); setError(''); setSuccess('');
    try {
      await gatewayApi[action](key.id);
      if (!mounted.current) return;
      setSuccess(action === 'delete' ? 'Key 已删除。有效订阅有可用名额时，可直接生成新资料。' : 'Key 已停用，名额已释放。可生成新资料并重新配置客户端。');
      window.dispatchEvent(new Event('gateway-updated'));
    } catch (e) { if (mounted.current) setError(messageOf(e)); }
    finally { await load(true); working.current = false; if (mounted.current) { setBusy(''); setConfirm(null); } }
  }
  return <Modal title="Gateway" onClose={onClose} wide>
    <div className="gateway-account">
      <p className="muted">使用你的 Kividas 订阅接入官方 Claude 桌面端和 Claude Code CLI。</p>
      <div className="gateway-owner"><ShieldCheck size={18} /><span>{user.email}</span><button className="icon-btn" aria-label="Refresh Gateway" disabled={loading || !!busy} onClick={() => void load()}><RefreshCw size={15} /></button></div>
      <section className="gateway-personal" aria-labelledby="gateway-personal-heading">
        <h3 id="gateway-personal-heading"><KeyRound size={18} />我的接入资料</h3>
        <p className="muted">你可以自行生成、停用和删除 Key，与管理员端同步。重复下载不会更换 Key；系统自动停用后，也可在这里生成新资料。</p>
        {error && <div className="gateway-notice error" role="alert">{error}</div>}
        {success && <div className="gateway-notice success" role="status"><Check size={16} />{success}</div>}
        {loading && !state ? <Loading text="正在读取接入资料…" /> : state && <>
          {!state.subscribed && <div className="gateway-empty"><p>{state.reason}</p><button className="btn primary" onClick={onSubscription}>查看订阅</button></div>}
            {state.subscribed && !state.eligible && <p className="gateway-notice">{state.reason}</p>}
            {state.eligible && <>
              <form className="gateway-create" onSubmit={event => { event.preventDefault(); void generate(); }}>
                <label>设备名称（可选）<input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} placeholder="例如：我的 Mac" disabled={!!busy || !state.canCreate} /></label>
                <button className="btn primary" disabled={loading || !!busy || !state.canCreate}><Plus size={16} />{busy === 'create' ? '正在生成…' : '生成接入资料'}</button>
              </form>
              <p className="muted">{desktopDevicePolicyText(state.policy)}{!state.canCreate && '名额已满；更换设备请先停用或删除旧 Key，再生成新资料。'}</p>
            </>}
            {state.keys.map(key => {
              const usable = state.eligible && !key.revokedAt && key.canReveal && key.installationId;
              return <article className="gateway-key" key={key.id}>
                <div className="gateway-key-info"><strong>{key.label}</strong><span>Key ···{key.suffix}</span><small>{key.revokedAt && key.revokeReason === 'device_conflicts' ? '已自动停用：检测到多设备复用' : desktopKeyStatus(key)}</small>{key.lastUsedAt && <small>最近使用：{new Date(key.lastUsedAt).toLocaleString()}</small>}
                  {!key.revokedAt && state.eligible && !key.canReveal && <small>此 Key 暂不可下载，可停用后重新生成。</small>}
                </div>
                <div className="gateway-key-actions">
                  {usable && <button className="btn" disabled={!!busy || !!confirm} onClick={() => void download(key)}><Download size={16} />{busy === key.id ? '正在下载…' : '下载客户资料 TXT'}</button>}
                  {!key.revokedAt && <button className="btn" disabled={!!busy || !!confirm} onClick={() => setConfirm({ key, action: 'revoke' })}><Ban size={16} />停用</button>}
                  <button className="btn danger" disabled={!!busy || !!confirm} onClick={() => setConfirm({ key, action: 'delete' })}><Trash2 size={16} />删除</button>
                </div>
                {confirm?.key.id === key.id && <div className="desktop-key-confirm gateway-key-confirm" role="alert">
                  <p>{confirm.action === 'delete' ? '删除后，此 Key 将失效并从列表移除，无法恢复。' : '停用后，客户端不能再使用此 Key；已下载的旧资料也会失效。'}如需继续使用，请生成新资料并重新配置。</p>
                  <div className="row"><button className="btn danger" disabled={!!busy} onClick={() => void manage()}>{busy ? '正在处理…' : confirm.action === 'delete' ? '确认删除' : '确认停用'}</button><button className="btn" disabled={!!busy} onClick={() => setConfirm(null)}>取消</button></div>
                </div>}
              </article>;
            })}
            {!state.keys.length && state.eligible && <p className="muted">暂无接入资料。{state.canCreate ? '点击上方“生成接入资料”即可创建。' : '请刷新页面后重试。'}</p>}
            <p className="gateway-private-note">已停用的 Key 保留在列表中，可自行删除；已停用、已删除的 Key 不占有效名额。TXT 包含你的专属 Key 和安装识别码，请勿共用。换电脑、怀疑泄露或 Key 被自动停用后，可在这里生成新资料，并重新配置客户端。</p>
        </>}
        {!state && error && <button className="btn" onClick={() => void load()}>重试</button>}
      </section>
      <section aria-labelledby="gateway-guides-heading"><h3 id="gateway-guides-heading">配置教程与工具</h3><GatewayResources /></section>
    </div>
  </Modal>;
}
