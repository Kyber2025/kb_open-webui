import type {
  Attachment,
  BlacklistEntry,
  Chat,
  ChatData,
  Config,
  Folder,
  GiftCard,
  GiftList,
  GuestConfig,
  Model,
  Tier,
  User,
} from "./types";
import { sseEvents } from "./domain";
const V1 = "/api/v1";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function token() {
  const stored = localStorage.getItem("token");
  if (stored) return stored;
  // Existing OAuth callbacks set a same-origin token cookie.
  if (typeof document !== "undefined") {
    const cookie = document.cookie
      .split("; ")
      .find((value) => value.startsWith("token="));
    if (cookie) {
      try {
        return decodeURIComponent(cookie.slice(6));
      } catch {
        return null;
      }
    }
  }
  return null;
}
function errorText(data: any): string {
  const value =
    data?.detail ?? data?.error?.message ?? data?.error ?? data?.message;
  return typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map((v) => v.msg).join("; ")
      : "Request failed. Please try again.";
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await rawRequest(path, options);
  return res.status === 204 ? (undefined as T) : res.json();
}
export async function rawRequest(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (token()) headers.set("Authorization", `Bearer ${token()}`);
  const deviceId = localStorage.getItem("guest-device-id");
  if (deviceId) headers.set("X-Guest-Device-Id", deviceId);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const res = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      localStorage.removeItem("token");
      window.dispatchEvent(new Event("session-expired"));
    }
    throw new ApiError(errorText(data), res.status);
  }
  return res;
}
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const del = (path: string) => request(path, { method: "DELETE" });
const sub = `${V1}/subscriptions`;
export const api = {
  config: () => request<Config>("/api/config"),
  me: () => request<User>(`${V1}/auths/`),
  login: (email: string, password: string) =>
    post<User & { token: string }>(`${V1}/auths/signin`, { email, password }),
  guest: () => {
    let id = localStorage.getItem("guest-device-id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("guest-device-id", id);
    }
    return post<User & { token: string }>(`${V1}/auths/guest`, {
      device_id: id,
    });
  },
  logout: () => post(`${V1}/auths/signout`),
  models: async () => (await request<{ data: Model[] }>("/api/models")).data,
  chats: (page = 1) =>
    request<Chat[]>(
      `${V1}/chats/?page=${page}&include_pinned=true&include_folders=true`,
    ),
  searchChats: (q: string) =>
    request<Chat[]>(`${V1}/chats/search?text=${encodeURIComponent(q)}&page=1`),
  chat: (id: string) => request<Chat>(`${V1}/chats/${encodeURIComponent(id)}`),
  saveChat: (data: ChatData, id?: string, folder?: string | null) =>
    id
      ? post<Chat>(`${V1}/chats/${encodeURIComponent(id)}`, { chat: data })
      : post<Chat>(`${V1}/chats/new`, {
          chat: data,
          folder_id: folder ?? null,
        }),
  deleteChat: (id: string) => del(`${V1}/chats/${encodeURIComponent(id)}`),
  folderChats: (id: string) =>
    request<Chat[]>(`${V1}/chats/folder/${encodeURIComponent(id)}`),
  folders: () => request<Folder[]>(`${V1}/folders/`),
  createFolder: (name: string, description = "") =>
    post<Folder>(`${V1}/folders/`, { name, data: { description } }),
  folder: (id: string) =>
    request<Folder>(`${V1}/folders/${encodeURIComponent(id)}`),
  updateFolder: (id: string, data: Partial<Folder>) =>
    post<Folder>(`${V1}/folders/${encodeURIComponent(id)}/update`, data),
  pinChat: (id: string) =>
    post<Chat>(`${V1}/chats/${encodeURIComponent(id)}/pin`),
  pinnedChats: () => request<Chat[]>(`${V1}/chats/pinned`),
  moveChat: (id: string, folder_id: string | null) =>
    post<Chat>(`${V1}/chats/${encodeURIComponent(id)}/folder`, { folder_id }),
  renameChat: (id: string, title: string) =>
    post<Chat>(`${V1}/chats/${encodeURIComponent(id)}`, { chat: { title } }),
  archiveChat: (id: string) =>
    post<Chat>(`${V1}/chats/${encodeURIComponent(id)}/archive`),
  archivedChats: () => request<Chat[]>(`${V1}/chats/all/archived`),
  tiers: () => request<Tier[]>(`${sub}/admin/tiers`),
  catalog: () => request<Model[]>(`${sub}/admin/models`),
  saveTier: (tier: Tier) => post<Tier>(`${sub}/admin/tiers`, tier),
  deleteTier: (id: string) =>
    del(`${sub}/admin/tiers/${encodeURIComponent(id)}`),
  seedTiers: () => post(`${sub}/admin/seed`),
  giftCards: (status = "all", search = "") =>
    request<GiftList>(
      `${sub}/admin/gift-cards?${new URLSearchParams({ status_filter: status, search })}`,
    ),
  generateCards: (data: {
    tier_id: string;
    count: number;
    duration_days: number | null;
    note: string | null;
  }) => post<GiftCard[]>(`${sub}/admin/gift-cards`, data),
  cardStatus: (code: string, enabled: boolean) =>
    post(`${sub}/admin/gift-cards/${encodeURIComponent(code)}/status`, {
      enabled,
    }),
  invalidateCard: (code: string) =>
    post(`${sub}/admin/gift-cards/${encodeURIComponent(code)}/invalidate`),
  deleteCard: (code: string) =>
    del(`${sub}/admin/gift-cards/${encodeURIComponent(code)}`),
  guestConfig: () => request<GuestConfig>(`${V1}/guest/config`),
  saveGuestConfig: (data: GuestConfig) =>
    post<GuestConfig>(`${V1}/guest/config`, data),
  blacklist: () => request<BlacklistEntry[]>(`${V1}/guest/blacklist`),
  blockIp: (ip: string, reason: string) =>
    post<BlacklistEntry>(`${V1}/guest/blacklist`, { ip, reason }),
  unblockIp: (ip: string) =>
    del(`${V1}/guest/blacklist/${encodeURIComponent(ip)}`),
  subscription: () => request<any>(`${sub}/me`),
  publicTiers: () => request<Tier[]>(`${sub}/tiers`),
  redeem: (code: string) => post(`${sub}/redeem`, { code }),
  usage: () => request<any>(`${V1}/kyber/usage/limits`),
  async upload(file: File): Promise<Attachment> {
    if (file.type.startsWith("image/")) {
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Unable to read image"));
        r.readAsDataURL(file);
      });
      return { id: crypto.randomUUID(), name: file.name, type: "image", url };
    }
    const body = new FormData();
    body.append("file", file);
    const data = await request<Record<string, any>>(
      `${V1}/files/?process=true`,
      { method: "POST", body },
    );
    const status = await rawRequest(
      `${V1}/files/${encodeURIComponent(data.id)}/process/status?stream=true`,
    );
    if (
      status.body &&
      status.headers.get("content-type")?.includes("text/event-stream")
    )
      for await (const event of sseEvents(status.body)) {
        if (event.error || event.status === "failed")
          throw new Error(String(event.error || "File processing failed"));
      }
    return { id: data.id, name: file.name, type: "file", file: data };
  },
};
export async function complete(
  payload: unknown,
  signal: AbortSignal,
  onDelta: (text: string) => void,
) {
  const res = await rawRequest("/api/chat/completions", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.headers.get("content-type")?.includes("text/event-stream")) {
    const data = await res.json();
    if (data.error) throw new Error(errorText(data));
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string")
      throw new Error("The server did not return a chat response.");
    onDelta(content);
    return;
  }
  if (!res.body) throw new Error("The response stream is empty.");
  for await (const event of sseEvents(res.body)) {
    if (event.error) throw new Error(errorText(event));
    const delta = event.choices?.[0]?.delta?.content;
    if (typeof delta === "string") onDelta(delta);
  }
}
