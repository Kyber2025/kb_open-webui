import type { User } from "./types";

// The existing backend's get_admin_user recognizes exactly role === "admin".
// Roles come from /api/v1/auths/, never a client-editable role preference.
export function isSuperAdmin(
  user: Pick<User, "role"> | null | undefined,
): boolean {
  return user?.role === "admin";
}
