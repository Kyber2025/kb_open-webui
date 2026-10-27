import { request } from './api';
export interface DesktopKey {
  id: string; label: string; suffix: string; createdAt: string; expiresAt: string | null;
  concurrentLimit: number; canReveal: boolean; lastRevealedAt: string | null;
  installationId: string | null;
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
export const DESKTOP_INSTALLATION_HEADER = 'X-Kividas-Device-ID';
export function desktopClientText(created: CreatedDesktopKey, email: string, password = '') {
  if (!created.key.installationId) throw new Error('此旧 Key 尚未保存安装识别码，请先完成迁移或生成新 Key。');
  return `客户接入资料（${email}）

一、官方 Claude 桌面客户端网关配置
Credential kind：Static API key
Gateway base URL：${created.gatewayUrl}
Gateway auth scheme：bearer
Gateway API key：${created.token}

二、添加安装识别码（Mac、Windows 都需要）
在 Inference configuration → Custom inference headers 中新增一项：
名称（Name）：${DESKTOP_INSTALLATION_HEADER}
值（Value）：${created.key.installationId}
名称所有客户相同；值由平台自动生成，无需查询电脑序列号。
请完整复制并长期保留，同一台电脑的多个会话共用此值。
保存后完全退出 Claude，再重新打开。不要只关闭窗口。
Mac：Claude → Quit Claude（或按 ⌘Q）。
Windows：左上角 ≡ → File → Exit。
每个订阅账号仅限一台设备，只能保留一个有效 Key。此 Key 和安装识别码可重复下载，在同一台电脑沿用；更换设备请联系管理员先停用旧 Key，再生成新资料。

三、Kividas 网页登录资料与用量
登录网址：${created.usageUrl}
Kividas 登录邮箱：${email}
Kividas 登录密码：${password || '请使用已有登录密码；如未收到，请联系管理员。'}
有效期跟随订阅，当前到期：${created.key.expiresAt ? new Date(created.key.expiresAt).toLocaleString('zh-CN', {timeZone: 'Asia/Hong_Kong', hour12: false}) + '（北京时间／香港时间）' : '请联系管理员确认订阅'}
Key 并发数：${created.key.concurrentLimit === 0 ? '0（不额外限制 Key 并发）' : created.key.concurrentLimit}
登录后点击聊天输入框右下角、模型名称附近的用量圆圈，查看个人用量及重置时间。
桌面与 Chat 网页统一按这个平台用户统计；此 Key 不能登录 Chat 网页。

四、使用提示
安装、选择本机文件夹、恢复官方登录，请参照对应的 Mac 或 Windows PDF 教程。
完成配置并重启后，可关闭 VPN 测试；能否使用取决于当前网络能否访问网关及相关服务。
本文件含客户专属接入资料，请仅交付给对应客户，勿公开或共用。
`.replace(/\n/g, '\r\n');
}

export function downloadDesktopClientText(created: CreatedDesktopKey, email: string, password = '') {
  const text = desktopClientText(created, email, password);
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], {type: 'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `客户接入资料-${email.replace(/[^a-zA-Z0-9@._-]/g, '_')}-${created.key.suffix}.txt`;
  document.body.append(link); link.click(); link.remove();
  // Keep the object alive until the browser has started consuming the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function validDesktopConcurrency(value: string): boolean {
  return /^\d+$/.test(value) && Number.isInteger(Number(value)) && Number(value) <= 2147483647;
}
