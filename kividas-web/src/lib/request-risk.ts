import { request } from './api';

export type RiskRule = { id: string; name: string; enabled: boolean; action: 'block' | 'observe'; groups: string[][] };
export type RiskPolicy = { enabled: boolean; rules: RiskRule[] };
export type RiskPolicyState = RiskPolicy & { version: number; updatedAt: string };
export type RiskMatch = { id: string; name: string; action: string; terms: string[] };
export type RiskEvent = { id: string; userId?: string; userEmail?: string; action: string; endpoint?: string; model?: string;
  requestId?: string; actorId?: string; reason: string; details: { matches?: RiskMatch[]; before?: unknown; after?: unknown; version?: number }; createdAt: string };
export type RiskOverride = { userId: string; email: string; version: number; mode: 'block' | 'allow' | 'inherit'; reason: string; expiresAt: string | null; updatedBy: string; updatedAt: string };
export type RiskPage<T> = { items: T[]; total: number; page: number; pageSize: number };
export type OverrideInput = Pick<RiskOverride, 'email' | 'mode' | 'version' | 'reason' | 'expiresAt'>;
const base = '/api/v1/kyber/admin/risk';
const put = <T>(path: string, body: unknown) => request<T>(base + path, { method: 'PUT', body: JSON.stringify(body) });
export const riskApi = {
  policy: () => request<RiskPolicyState>(base + '/policy'),
  savePolicy: (version: number, config: RiskPolicy, reason: string) => put<{ ok: boolean; version: number }>('/policy', { version, config, reason }),
  events: (page: number, search: string, action: string) => request<RiskPage<RiskEvent>>(base + '/events?' + new URLSearchParams({ page: String(page), search, action })),
  overrides: (page: number, search: string) => request<RiskPage<RiskOverride>>(base + '/overrides?' + new URLSearchParams({ page: String(page), search })),
  saveOverride: (body: OverrideInput) => put<{ ok: boolean }>('/override', body),
  test: (config: RiskPolicy, text: string) => request<{ matches: RiskMatch[] }>(base + '/test', { method: 'POST', body: JSON.stringify({ config, text }) }),
};
export const riskActions: Record<string, string> = { blocked: '已拒绝', observed: '仅观察', allowed: '已放行', policy_updated: '规则变更', override_updated: '用户处理' };
export const overrideModes = { block: '禁用模型请求', allow: '风控放行', inherit: '恢复按规则检查' };
export const riskDate = (date?: string | null) => date ? new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Hong_Kong', hour12: false }) : '—';
