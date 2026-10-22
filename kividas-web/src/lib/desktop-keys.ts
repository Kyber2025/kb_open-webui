import { request } from './api';
export interface DesktopKey {
  id: string; label: string; suffix: string; createdAt: string; expiresAt: string;
  revokedAt: string | null; revokeReason: string | null; boundAt: string | null; lastUsedAt: string | null;
}
export interface DesktopKeys {
  eligible: boolean; reason: string | null;
  policy: { maxActiveKeys: number; requestsPerMinute: number; concurrentPerKey: number; concurrentPerUser: number; networksPerHour: number };
  keys: DesktopKey[];
}
export interface CreatedDesktopKey { key: DesktopKey; token: string; gatewayUrl: string; usageUrl: string }
const path = (id: string) => `/api/v1/kyber/admin/users/${encodeURIComponent(id)}/desktop-keys`;
export const desktopKeysApi = {
  list: (id: string) => request<DesktopKeys>(path(id)),
  create: (id: string, label: string, days: number) => request<CreatedDesktopKey>(path(id), { method: 'POST', body: JSON.stringify({ label, days }) }),
  revoke: (id: string, keyId: string) => request<{ok: boolean}>(`${path(id)}/${encodeURIComponent(keyId)}/revoke`, { method: 'POST' }),
};
export function desktopKeyStatus(key: DesktopKey, now = Date.now()) {
  return key.revokedAt ? '已停用' : new Date(key.expiresAt).getTime() <= now ? '已到期' : key.boundAt ? '已绑定电脑' : '等待首次使用';
}
export function desktopClientText(created: CreatedDesktopKey, email: string) {
  return `Claude 桌面接入资料（请妥善保管，不要转发）\n\n电脑名称：${created.key.label}\n网关地址：${created.gatewayUrl}\n认证方式：API key / Bearer token\n桌面专用 Key：${created.token}\n有效期至：${new Date(created.key.expiresAt).toLocaleString()}\n\n用量查询：${created.usageUrl}\nKividas 登录邮箱：${email}\nKividas 登录密码：请使用单独交付的密码（此文件不包含密码）\n\nKey 仅限一台电脑。请在有效期内使用；更换电脑或遗失 Key，请联系管理员。\n桌面与 Chat 合并统计到此平台用户。此 Key 不能登录 Chat 网页。\n`;
}
