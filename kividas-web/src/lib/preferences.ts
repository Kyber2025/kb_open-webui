import { request } from "./api";
import type { User } from "./types";
export type Preferences = {
  ui?: { system?: string; memory?: boolean; [key: string]: unknown };
  [key: string]: unknown;
};
export interface Memory {
  id: string;
  content: string;
  updated_at?: number;
}
export const preferencesApi = {
  get: () => request<Preferences | null>("/api/v1/users/user/settings"),
  save: (body: Preferences) =>
    request<Preferences>("/api/v1/users/user/settings/update", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  profile: (user: User, name: string) =>
    request<Partial<User>>("/api/v1/auths/update/profile", {
      method: "POST",
      body: JSON.stringify({
        name,
        profile_image_url: user.profile_image_url || "/user.png",
      }),
    }),
  memories: () => request<Memory[]>("/api/v1/memories/"),
  saveMemory: (content: string, id?: string) =>
    request<Memory>(
      id
        ? `/api/v1/memories/${encodeURIComponent(id)}/update`
        : "/api/v1/memories/add",
      { method: "POST", body: JSON.stringify({ content }) },
    ),
  deleteMemory: (id: string) =>
    request(`/api/v1/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
export function downloadText(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
