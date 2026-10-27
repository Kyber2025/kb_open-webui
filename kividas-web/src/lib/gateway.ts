import { request } from './api';
import type { CreatedDesktopKey, DesktopKeys } from './desktop-keys';

export interface GatewayState extends DesktopKeys {
  subscribed: boolean;
}
const base = '/api/v1/kyber/gateway';
export const gatewayApi = {
  status: () => request<GatewayState>(base),
  download: (keyId: string) => request<CreatedDesktopKey>(`${base}/keys/${encodeURIComponent(keyId)}/download`, { method: 'POST', body: '{}' }),
};

export const gatewayResources = [
  { id: 'mac', title: 'Claude Desktop · macOS', detail: 'Mac 网关配置教程', file: 'claude-desktop-macos.pdf', name: 'Claude配置网关教程Mac版.pdf', format: 'PDF', size: '794 KB' },
  { id: 'windows', title: 'Claude Desktop · Windows', detail: 'Windows 网关配置教程', file: 'claude-desktop-windows.pdf', name: 'Claude配置网关教程Windows版.pdf', format: 'PDF', size: '1.04 MB' },
  { id: 'cli', title: 'Claude Code CLI', detail: 'Mac / Windows 网关配置教程', file: 'claude-code-cli.pdf', name: 'ClaudeCodeCLI网关配置教程Mac与Windows版.pdf', format: 'PDF', size: '332 KB' },
  { id: 'setup', title: 'Kividas 一键配置', detail: 'Mac / Windows · r3', file: 'kividas-gateway-setup-r3.zip', name: 'Kividas一键配置-r3.zip', format: 'ZIP', size: '20 KB' },
] as const;
