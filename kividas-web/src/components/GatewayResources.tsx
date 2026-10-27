import { Download, FileText, Package } from 'lucide-react';
import { gatewayResources } from '../lib/gateway';

export function GatewayResources() {
  return <div className="gateway-resources">
    {gatewayResources.map(resource => <a key={resource.id} className="gateway-resource"
      href={`/gateway/${resource.file}`} download={resource.name}>
      {resource.badge && <span className="gateway-resource-badge">{resource.badge}</span>}
      <span className="gateway-resource-icon">{resource.format === 'ZIP' ? <Package size={20} /> : <FileText size={20} />}</span>
      <span className="gateway-resource-copy"><strong>{resource.title}</strong><span>{resource.detail}</span><small>{resource.format} · {resource.size}</small></span>
      <Download size={17} aria-label="Download" />
    </a>)}
  </div>;
}
