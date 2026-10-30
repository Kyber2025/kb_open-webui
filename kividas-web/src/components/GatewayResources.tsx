import { Download, FileText, Package } from 'lucide-react';
import { useState } from 'react';
import { downloadGatewayResource, gatewayResources, type GatewayResource } from '../lib/gateway';
import { messageOf, useNotify } from './UI';

export function GatewayResources() {
  const [busy, setBusy] = useState('');
  const notify = useNotify();
  async function download(resource: GatewayResource) {
    if (busy) return;
    setBusy(resource.id);
    try { await downloadGatewayResource(resource); }
    catch (error) { notify(messageOf(error), true); }
    finally { setBusy(''); }
  }
  return <div className="gateway-resources">
    {gatewayResources.map(resource => <button key={resource.id} className="gateway-resource" type="button"
      disabled={!!busy} onClick={() => void download(resource)}>
      {resource.badge && <span className="gateway-resource-badge">{resource.badge}</span>}
      <span className="gateway-resource-icon">{resource.format === 'ZIP' ? <Package size={20} /> : <FileText size={20} />}</span>
      <span className="gateway-resource-copy"><strong>{resource.title}</strong><span>{resource.detail}</span><small>{busy === resource.id ? '正在下载…' : resource.format}</small></span>
      <Download size={17} aria-label="Download" />
    </button>)}
  </div>;
}
