import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Copy, Download, FileText, RefreshCw, Server, Terminal } from 'lucide-react';
import { rawRequest, request } from '../lib/api';

type Workspace = { instanceId: string; name: string; host: string; port: number; username: string; directory: string };
type State = { workspaces: Workspace[]; expiresAt?: string; reason?: string };
const base = '/api/v1/code/ssh-workspaces';
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function WorkspaceSetup() {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState('');
  const [platform, setPlatform] = useState<'unix' | 'windows'>(() => /Win/i.test(navigator.platform) ? 'windows' : 'unix');
  const [copied, setCopied] = useState(false), [downloaded, setDownloaded] = useState('');
  const workspace = state?.workspaces.find(w => w.instanceId === selected) ?? state?.workspaces[0];
  async function load() {
    setLoading(true); setError('');
    try { setState(await request<State>(base, { cache: 'no-store' })); }
    catch (e) { setState(null); setError(e instanceof Error ? e.message : '无法读取绑定，请重试。'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function download(kind: 'connection' | 'script' | 'guide') {
    if (busy || (kind !== 'guide' && !workspace)) return;
    setBusy(kind); setError('');
    try {
      if (kind === 'connection') {
        const file = await request<{ filename: string; content: string }>(`${base}/${encodeURIComponent(workspace!.instanceId)}/download`, { method: 'POST', body: '{}', cache: 'no-store' });
        save(new Blob([file.content], { type: 'text/plain;charset=utf-8' }), file.filename);
        setDownloaded(workspace!.instanceId);
      } else {
        const filename = kind === 'guide' ? 'kividas-ssh-guide.html' : `kividas-ssh-setup.${platform === 'unix' ? 'sh' : 'cmd'}`;
        const response = await rawRequest(`${base}/resources/${filename}`, { cache: 'no-store' });
        save(await response.blob(), filename);
      }
    } catch (e) { setError(e instanceof Error ? e.message : '下载失败，请重试。'); }
    finally { setBusy(''); }
  }
  const command = '/bin/bash ';
  async function copy() {
    try { await navigator.clipboard.writeText(command); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setError('无法自动复制，请选中下面的命令手动复制。'); }
  }
  return <>
    <div className="ssh-panel-heading">
      <div className="gateway-section-heading">
        <span className="gateway-resource-icon"><Terminal size={24} /></span>
        <div><span className="eyebrow">YOUR CLOUD WORKSPACE</span><h2>终端里的专属工作区</h2></div>
      </div>
      <button className="btn ssh-guide-button" disabled={!!busy} onClick={() => void download('guide')}><FileText size={16} />使用教程<Download size={15} /></button>
    </div>
    <p className="muted">下载个人连接资料，运行一次通用脚本。以后打开终端，输入 <code>claude</code> 就能开始工作。</p>
    <div className={`ssh-binding ${workspace ? 'is-bound' : ''}`} aria-live="polite">
      <Server size={21} />
      <div className="ssh-binding-copy">
        <strong>{loading ? '正在检查你的 SSH 绑定…' : workspace ? `${workspace.name} · 已绑定` : '尚无可用 SSH 工作区'}</strong>
        <span>{workspace ? `${workspace.host}:${workspace.port} · ${workspace.directory}` : state?.reason || '由管理员绑定 SSH 账号后，即可在这里下载个人资料和配置脚本。'}</span>
        {state?.expiresAt && workspace && <span>订阅有效期至 {new Date(state.expiresAt).toLocaleString()}</span>}
      </div>
      {state && state.workspaces.length > 1 && <select aria-label="选择 SSH 工作区" value={workspace?.instanceId} onChange={e => { setSelected(e.target.value); setDownloaded(''); }}>
        {state.workspaces.map(w => <option key={w.instanceId} value={w.instanceId}>{w.name}</option>)}
      </select>}
      <button className="icon-btn" aria-label="刷新绑定状态" disabled={loading || !!busy} onClick={() => void load()}><RefreshCw size={16} /></button>
    </div>
    <div className="ssh-setup-grid">
      <div className="ssh-step"><span className="ssh-step-number">01</span><h3>下载连接资料</h3>
        <p>个人 TXT 包含 SSH 地址、主机指纹和首次配置密码。仅当前绑定用户可下载。</p>
        <button className="btn primary" disabled={!workspace || loading || !!busy} onClick={() => void download('connection')}>
          {downloaded === workspace?.instanceId ? <Check size={16} /> : <Download size={16} />}{busy === 'connection' ? '正在下载…' : '下载个人连接 TXT'}
        </button>
      </div>
      <div className="ssh-step"><span className="ssh-step-number">02</span><h3>下载通用脚本</h3>
        <p>同一份脚本适用于所有实例。运行后导入 TXT，自动完成连接和免密配置。</p>
        <div className="ssh-platforms" role="group" aria-label="客户电脑系统">
          <button aria-pressed={platform === 'unix'} onClick={() => setPlatform('unix')}>Mac / Linux</button>
          <button aria-pressed={platform === 'windows'} onClick={() => setPlatform('windows')}>Windows</button>
        </div>
        <button className="btn" disabled={!workspace || loading || !!busy} onClick={() => void download('script')}><Download size={16} />{busy === 'script' ? '正在下载…' : platform === 'unix' ? '下载 .sh 脚本' : '下载 Windows 双击配置文件'}</button>
      </div>
    </div>
    <div className="ssh-run-step"><span className="ssh-step-number">03</span><div><h3>{platform === 'unix' ? '打开终端，拖入脚本' : '双击文件，选择连接资料'}</h3>
      <p className="muted">{platform === 'unix' ? '输入 /bin/bash，末尾留一个空格，再将下载的 kividas-ssh-setup.sh 拖入终端并回车。启动后按提示拖入个人 TXT，再按回车。' : '双击下载的 kividas-ssh-setup.cmd，在弹出的窗口选择个人连接 TXT，按步骤自动完成配置。无需输入 PowerShell 命令。'}</p>
      {platform === 'unix' && <div className="ssh-command"><code>{command}</code><button className="icon-btn" aria-label="复制配置命令（含末尾空格）" onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>}
      <p className="muted ssh-small">{platform === 'unix' ? '也可手动填写 .sh 和 TXT 的完整路径。' : '需要 Windows OpenSSH 客户端；配置窗口会显示每一步的结果。'}配置完成后重新打开终端，输入 claude。</p>
    </div></div>
    <div className="ssh-shortcuts">
      <div><code>claude</code><span>启动 / 恢复 Claude</span></div>
      <div><code>claude-ssh</code><span>终端与 Git 操作</span></div>
      <div><code>claude-sftp</code><span>上传 / 下载文件</span></div>
    </div>
    <p className="ssh-retention"><strong>文件与订阅</strong> · 代码保存在云端 /workspace/claude。订阅到期会自动解绑，旧密码和密钥失效，并清空工作区。请提前推送 Git 或下载备份；续费后需重新绑定并下载新 TXT。</p>
    <details className="ssh-help"><summary>Git、SFTP 和断线恢复 <ArrowUpRight size={15} /></summary><div>
      <p>运行 <code>claude-ssh</code>，在工作区中使用 <code>git clone</code>，进入仓库后运行 <code>claude</code>。私有仓库使用你自己的 Git 凭据。</p>
      <p>SSH 与终端 SFTP 可同时使用。网络断线后重新运行同一命令可恢复会话；实例重启或解绑会结束会话。</p>
      <p>配置会让本机的 <code>claude</code> 命令连接云端工作区。个人 TXT 含登录密码，请勿转发。</p>
    </div></details>
    {error && <p role="alert" className="ssh-error">{error}</p>}
  </>;
}
