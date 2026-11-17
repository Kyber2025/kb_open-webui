import { rawRequest, request } from './api';
import type { CreatedDesktopKey, DesktopKey, DesktopKeys } from './desktop-keys';

export interface GatewayState extends DesktopKeys {
  subscribed: boolean;
  canCreate: boolean;
  usageUrl: string;
}
const base = '/api/v1/kyber/gateway';
export const gatewayApi = {
  status: () => request<GatewayState>(base),
  create: (label: string) => request<{key: DesktopKey}>(`${base}/keys`, { method: 'POST', body: JSON.stringify({label}) }),
  download: (keyId: string) => request<CreatedDesktopKey>(`${base}/keys/${encodeURIComponent(keyId)}/download`, { method: 'POST', body: '{}' }),
  revoke: (keyId: string) => request<{ok: boolean}>(`${base}/keys/${encodeURIComponent(keyId)}/revoke`, { method: 'POST', body: '{}' }),
  delete: (keyId: string) => request<{ok: boolean}>(`${base}/keys/${encodeURIComponent(keyId)}/delete`, { method: 'POST', body: '{}' }),
};

export async function downloadGatewayResource(resource: GatewayResource) {
  const response = await rawRequest(`${base}/resources/${encodeURIComponent(resource.file)}`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = resource.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface GatewayResource {
  id: 'setup' | 'mac' | 'windows' | 'cli' | 'usage-windows' | 'usage-mac' | 'mcp-guide';
  title: string;
  detail: string;
  file: string;
  name: string;
  format: 'PDF' | 'ZIP' | 'EXE' | 'DMG';
  size: string;
  /** Small tag in the tile's top-right corner, e.g. "推荐". */
  badge?: string;
}
// One configuration package includes initialization, usage MCP and telemetry settings.
export const gatewayResources: readonly GatewayResource[] = [
  { id: 'setup', title: '网关一键配置', detail: 'Mac / Windows · 主对话 1 小时缓存 · v1', file: 'kividas-gateway-setup-v1.zip', name: 'Kividas网关一键配置-v1.zip', format: 'ZIP', size: '28 KB', badge: '推荐' },
  { id: 'usage-windows', title: '用量悬浮球 · Windows', detail: 'Windows 10 / 11 · v0.4.4', file: 'kividas-usage-windows-0.4.4.exe', name: 'Kividas-Usage-Setup-0.4.4.exe', format: 'EXE', size: '116 KB' },
  { id: 'usage-mac', title: '用量悬浮球 · macOS', detail: 'Apple Silicon / Intel · macOS 13+ · v0.4.4', file: 'kividas-usage-macos-0.4.4.dmg', name: 'Kividas-Usage-0.4.4.dmg', format: 'DMG', size: '0.96 MB' },
];
