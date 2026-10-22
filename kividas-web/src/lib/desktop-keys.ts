import { request } from './api';
export interface DesktopKey {
  id: string; label: string; suffix: string; createdAt: string; expiresAt: string | null;
  concurrentLimit: number; canReveal: boolean; lastRevealedAt: string | null;
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
  create: (id: string, concurrentLimit = 0) => request<CreatedDesktopKey>(path(id), { method: 'POST', body: JSON.stringify({ concurrentLimit }) }),
  reveal: (id: string, keyId: string) => request<CreatedDesktopKey>(`${path(id)}/${encodeURIComponent(keyId)}/reveal`, { method: 'POST' }),
  policy: (id: string, keyId: string, concurrentLimit: number) => request<{ok: boolean}>(`${path(id)}/${encodeURIComponent(keyId)}/policy`, { method: 'POST', body: JSON.stringify({concurrentLimit}) }),
  revoke: (id: string, keyId: string) => request<{ok: boolean}>(`${path(id)}/${encodeURIComponent(keyId)}/revoke`, { method: 'POST' }),
  delete: (id: string, keyId: string) => request<{ok: boolean}>(`${path(id)}/${encodeURIComponent(keyId)}/delete`, { method: 'POST' }),
};
export function desktopKeyStatus(key: DesktopKey, now = Date.now()) {
  return key.revokedAt ? '已停用' : (!key.expiresAt || new Date(key.expiresAt).getTime() <= now) ? '订阅已到期' : key.boundAt ? '已绑定电脑' : '等待首次使用';
}
export function desktopClientText(created: CreatedDesktopKey, email: string) {
  return `Claude 桌面接入资料（请妥善保管，不要转发）\n\n电脑名称：${created.key.label}\n网关地址：${created.gatewayUrl}\n认证方式：API key / Bearer token\n桌面专用 Key：${created.token}\n有效期至：${created.key.expiresAt ? new Date(created.key.expiresAt).toLocaleString() : "随订阅更新"}\n同时模型请求数：${created.key.concurrentLimit === 0 ? "不限制" : created.key.concurrentLimit}\n\n用量查询：${created.usageUrl}\nKividas 登录邮箱：${email}\nKividas 登录密码：请使用单独交付的密码（此文件不包含密码）\n\nKey 仅限一台电脑。请在有效期内使用；更换电脑或遗失 Key，请联系管理员。\n桌面与 Chat 合并统计到此平台用户。此 Key 不能登录 Chat 网页。\n`;
}

export function validDesktopConcurrency(value: string): boolean {
  return /^\d+$/.test(value) && Number.isInteger(Number(value)) && Number(value) <= 2147483647;
}
