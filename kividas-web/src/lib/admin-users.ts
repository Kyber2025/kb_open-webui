import { request } from "./api";
import type { Chat, Tier, User } from "./types";
export interface ManagedUser extends User {
  created_at?: number;
  last_active_at?: number;
  info?: { banned_at?: number; ban_reason?: string; role_before_ban?: string };
}
export interface UsageWindow {
  used: number;
  limit: number;
  resetAt?: string | number;
}
export interface UserPlan {
  tier?: Tier;
  expires_at?: number | null;
  kyber_linked?: boolean;
  usage?: {
    tp5h?: UsageWindow;
    tpw?: UsageWindow;
    tpwFable?: UsageWindow;
  } | null;
  rate_limits_synced?: boolean;
  token_billing_enabled?: boolean;
}
export interface AccessPreview {
  groups: Array<{ id: string; name: string }>;
  models: { items: Array<{ id: string; name: string }>; total: number };
  knowledge: { items: Array<{ id: string; name: string }>; total: number };
  tools: { items: Array<{ id: string; name: string }>; total: number };
}
export interface UserForm {
  name: string;
  email: string;
  role: string;
  password?: string;
  profile_image_url?: string;
}
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
const userPath = (id: string) => `/api/v1/users/${encodeURIComponent(id)}`;
const planPath = (id: string) =>
  `/api/v1/subscriptions/admin/users/${encodeURIComponent(id)}`;
export const usersApi = {
  list: (page: number, query: string, order: string, direction: string) =>
    request<{ users: ManagedUser[]; total: number }>(
      `/api/v1/users/?${new URLSearchParams({ page: String(page), query, order_by: order, direction })}`,
    ),
  overview: (ids: string[]) =>
    post<{ users: Record<string, UserPlan> }>(
      "/api/v1/subscriptions/admin/users/overview",
      { user_ids: ids },
    ),
  update: (id: string, data: Partial<UserForm>) =>
    post<ManagedUser>(`${userPath(id)}/update`, data),
  add: (data: UserForm) => post<ManagedUser>("/api/v1/auths/add", data),
  ban: (id: string, banned: boolean, reason?: string) =>
    post<ManagedUser>(`${userPath(id)}/ban`, {
      banned,
      reason: reason || null,
    }),
  remove: (id: string) => request<boolean>(userPath(id), { method: "DELETE" }),
  setPlan: (
    id: string,
    data: { tier_id: string; expires_at?: number; duration_days?: number },
  ) => post<UserPlan>(`${planPath(id)}/subscription`, data),
  revoke: (id: string) =>
    request<UserPlan>(`${planPath(id)}/subscription`, { method: "DELETE" }),
  reset: (id: string, windows: string[]) =>
    post<UserPlan>(`${planPath(id)}/usage/reset`, { windows }),
  preview: (id: string) => request<AccessPreview>(`${userPath(id)}/preview`),
  chats: (id: string, page: number, query: string) =>
    request<Chat[]>(
      `/api/v1/chats/list/user/${encodeURIComponent(id)}?${new URLSearchParams({ page: String(page), query, order_by: "updated_at", direction: "desc" })}`,
    ),
};
export function usagePercent(window: UsageWindow | undefined) {
  return window && window.limit > 0
    ? Math.max(
        0,
        Math.min(100, Math.round((window.used / window.limit) * 1000) / 10),
      )
    : null;
}
export function syncWarning(result: UserPlan) {
  return result.token_billing_enabled &&
    result.kyber_linked &&
    result.rate_limits_synced === false
    ? "Plan saved, but gateway limits were not synchronized. Retry saving to synchronize them."
    : null;
}
