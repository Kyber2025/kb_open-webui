import { Download, FileText, Package } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { downloadGatewayResource, gatewayResources, usageMcpResources, type GatewayResource } from '../lib/gateway';
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
    <p className="muted">r6 一次完成接入初始化、用量 MCP 和关闭遥测。先保存任务并退出 Claude，选择桌面端、CLI 或两者，再导入原接入资料 TXT。工具先备份，仅重建接入配置，保留项目文件、CLAUDE.md、历史记录和其他 MCP；完成后重启客户端并新建会话。</p>
    {configurationNote}
    <section className="gateway-usage-downloads" aria-label="远程用量 MCP">
      <h3>直接问 Claude 查用量</h3>
      <p className="muted">与上方“网关一键配置”使用同一工具。用量 MCP 已默认加入配置流程，无需单独选择或安装悬浮球；新老用户均可导入原接入资料完成配置。</p>
      <div className="gateway-resources">{usageMcpResources.map(tile)}</div>
    </section>
    <section className="gateway-usage-downloads" aria-label="用量悬浮球下载">
      <h3>用量悬浮球</h3>
      <p className="muted">在桌面随时查看 5 小时和每周用量。已有 Claude Code CLI 或桌面网关配置会自动读取，支持后台自动更新，无需重新登录或选择接入资料。</p>
      <div className="gateway-resources">{gatewayResources.filter(r => r.id.startsWith('usage-')).map(tile)}</div>
    </section>
  </div>;
}
