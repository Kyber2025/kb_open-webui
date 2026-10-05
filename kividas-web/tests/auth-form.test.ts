import { describe, expect, it } from "vitest";
import { codeDigits, isEmail, verifyProblem } from "../src/lib/auth-form";

describe("sign-up and reset form checks", () => {
  it("keeps only the six digits of a pasted code", () => {
    expect(codeDigits(" 12 34-56 ")).toBe("123456");
    expect(codeDigits("1234567")).toBe("123456");
    expect(codeDigits("abc")).toBe("");
  });
  it("accepts a plain address and rejects partial ones", () => {
    expect(isEmail(" user@example.com ")).toBe(true);
    expect(isEmail("user@example")).toBe(false);
    expect(isEmail("user example.com")).toBe(false);
  });
  it("reports the first problem before anything is sent", () => {
    const ok = { code: "123456", password: "password1", confirm: "password1" };
    expect(verifyProblem(ok)).toBeNull();
    expect(verifyProblem({ ...ok, code: "12345" })).toMatch(/6-digit code/);
    expect(
      verifyProblem({ ...ok, password: "short", confirm: "short" }),
    ).toMatch(/at least 8 characters/);
    expect(verifyProblem({ ...ok, confirm: "password2" })).toBe(
      "Passwords do not match.",
    );
  });
});
