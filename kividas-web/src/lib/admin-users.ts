import { request } from "./api";
import type { Chat, Tier, User } from "./types";
import { windowPercent, type UsageWindow, type OfficialUsageMeta } from './usage';
export type { UsageWindow } from './usage';
export interface ManagedUser extends User {
  reseller?: { invite_id: string; name: string; enabled: boolean; created_at: number } | null;
  created_at?: number;
  last_active_at?: number;
  info?: { banned_at?: number; ban_reason?: string; role_before_ban?: string };
}
export interface UserPlan {
  tier?: Tier;
  expires_at?: number | null;
  kyber_linked?: boolean;
  usage?: {
    usageSource?: 'official_cache' | 'local_tokens';
    officialUsage?: OfficialUsageMeta | null;
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
  list: (
    page: number,
    query: string,
    order: string,
    direction: string,
    plan = "",
    limit = USERS_PAGE_SIZE,
    source = "",
    resellerInviteId = "",
  ) =>
    request<{ users: ManagedUser[]; total: number }>(
      `/api/v1/users/?${new URLSearchParams({ page: String(page), query, order_by: order, direction, limit: String(limit), ...(plan ? { plan } : {}), ...(source ? { source } : {}), ...(resellerInviteId ? { reseller_invite_id: resellerInviteId } : {}) })}`,
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
export const USERS_PAGE_SIZES = [10, 20, 50, 100];
export const USERS_PAGE_SIZE = 20;
/** Page buttons: first, last and the current page ±2, "…" for any gap. */
export function pageItems(page: number, pages: number): (number | "…")[] {
  const from = Math.max(2, page - 2),
    to = Math.min(pages - 1, page + 2),
    items: (number | "…")[] = [1];
  if (from > 2) items.push("…");
  for (let p = from; p <= to; p++) items.push(p);
  if (to < pages - 1) items.push("…");
  if (pages > 1) items.push(pages);
  return items;
}
export function usagePercent(window: UsageWindow | undefined) {
  const percent = windowPercent(window);
  return percent === null ? null : Math.min(100, percent);
}
export function syncWarning(result: UserPlan) {
  return result.token_billing_enabled &&
    result.kyber_linked &&
    result.rate_limits_synced === false
    ? "Plan saved, but gateway limits were not synchronized. Retry saving to synchronize them."
    : null;
}
