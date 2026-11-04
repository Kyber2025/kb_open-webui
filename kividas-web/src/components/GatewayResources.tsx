import { Download, FileText, Package } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { downloadGatewayResource, gatewayResources, type GatewayResource } from '../lib/gateway';
import { messageOf, useNotify } from './UI';

export function GatewayResources({ configurationNote }: { configurationNote?: ReactNode }) {
  const [busy, setBusy] = useState('');
  const notify = useNotify();
  async function download(resource: GatewayResource) {
    if (busy) return;
    setBusy(resource.id);
    try { await downloadGatewayResource(resource); }
    catch (error) { notify(messageOf(error), true); }
    finally { setBusy(''); }
  }
  function tile(resource: GatewayResource) { return <button key={resource.id} className="gateway-resource" type="button"
      disabled={!!busy} onClick={() => void download(resource)}>
      {resource.badge && <span className="gateway-resource-badge">{resource.badge}</span>}
      <span className="gateway-resource-icon">{resource.format !== 'PDF' ? <Package size={20} /> : <FileText size={20} />}</span>
      <span className="gateway-resource-copy"><strong>{resource.title}</strong><span>{resource.detail}</span><small>{busy === resource.id ? '正在下载…' : resource.format + (resource.id.startsWith('usage-') ? ' · ' + resource.size : '')}</small></span>
      <Download size={17} aria-label="Download" />
    </button>; }
  return <div>
    <div className="gateway-resources">{gatewayResources.filter(r => !r.id.startsWith('usage-')).map(tile)}</div>
    {configurationNote}
    <section className="gateway-usage-downloads" aria-label="远程用量 MCP">
      <h3>直接问 Claude 查用量</h3>
      <p className="muted">一键配置 r4 已包含用量 MCP。新用户随网关一起配置；老用户选择“只补用量 MCP”，优先读取已有身份，无需安装悬浮球。</p>
      <a href="https://ai.kividas.com/api/mcp/usage/guide" target="_blank" rel="noopener noreferrer">查看 Windows / Mac 三步教程 ↗</a>
    </section>
    <section className="gateway-usage-downloads" aria-label="用量悬浮球下载">
      <h3>用量悬浮球</h3>
      <p className="muted">在桌面随时查看 5 小时和每周用量。已有 Claude Code CLI 或桌面网关配置会自动读取，支持后台自动更新，无需重新登录或选择接入资料。</p>
      <div className="gateway-resources">{gatewayResources.filter(r => r.id.startsWith('usage-')).map(tile)}</div>
    </section>
  </div>;
}
