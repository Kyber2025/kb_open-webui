import { describe, expect, it } from "vitest";
import { isSuperAdmin } from "../src/lib/access";

describe("management access", () => {
  it("permits the existing backend's highest management role", () => {
    expect(isSuperAdmin({ role: "admin" })).toBe(true);
  });
  it.each(["user", "guest", "pending", "", "superadmin", "ADMIN"])(
    "denies unsupported or non-admin role %s",
    (role) => expect(isSuperAdmin({ role })).toBe(false),
  );
  it("denies missing and signed-out sessions", () => {
    expect(isSuperAdmin(null)).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });
});
