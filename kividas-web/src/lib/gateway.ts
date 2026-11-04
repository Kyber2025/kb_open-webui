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
  id: 'setup' | 'mac' | 'windows' | 'cli' | 'usage-windows' | 'usage-mac';
  title: string;
  detail: string;
  file: string;
  name: string;
  format: 'PDF' | 'ZIP' | 'EXE' | 'DMG';
  size: string;
  /** Small tag in the tile's top-right corner, e.g. "推荐". */
  badge?: string;
}
// Display order: the one-click setup tool first, then the per-client guides.
export const gatewayResources: readonly GatewayResource[] = [
  { id: 'setup', title: '一键配置', detail: 'Mac / Windows · 含 MCP · r4', file: 'kividas-gateway-setup-r4.zip', name: 'Kividas一键配置-r4.zip', format: 'ZIP', size: '22 KB', badge: '推荐' },
  { id: 'mac', title: 'Claude Desktop · macOS', detail: 'Mac 网关配置教程', file: 'claude-desktop-macos.pdf', name: 'Claude配置网关教程Mac版.pdf', format: 'PDF', size: '794 KB' },
  { id: 'windows', title: 'Claude Desktop · Windows', detail: 'Windows 网关配置教程', file: 'claude-desktop-windows.pdf', name: 'Claude配置网关教程Windows版.pdf', format: 'PDF', size: '1.04 MB' },
  { id: 'cli', title: 'Claude Code CLI', detail: 'Mac / Windows 网关配置教程', file: 'claude-code-cli.pdf', name: 'ClaudeCodeCLI网关配置教程Mac与Windows版.pdf', format: 'PDF', size: '332 KB' },
  { id: 'usage-windows', title: '用量悬浮球 · Windows', detail: 'Windows 10 / 11 · v0.4.1', file: 'kividas-usage-windows-0.4.1.exe', name: 'Kividas-Usage-Setup-0.4.1.exe', format: 'EXE', size: '114 KB' },
  { id: 'usage-mac', title: '用量悬浮球 · macOS', detail: 'Apple Silicon / Intel · macOS 13+', file: 'kividas-usage-macos-0.4.1.dmg', name: 'Kividas-Usage-0.4.1.dmg', format: 'DMG', size: '0.94 MB' },
];
