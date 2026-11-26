import { describe, expect, it } from "vitest";
import {
  codeMethods,
  defaultCodeMethod,
  parseCodeMethod,
} from "../src/lib/code-methods";

describe("code page methods", () => {
  it("lists SSH first and makes it the default", () => {
    expect(codeMethods.map((method) => method.id)).toEqual([
      "ssh",
      "gateway",
    ]);
    expect(defaultCodeMethod).toBe("ssh");
  });
  it("falls back to SSH for a missing or unknown ?method value", () => {
    for (const value of [null, undefined, "", "admin", "DESKTOP", 1, {}])
      expect(parseCodeMethod(value)).toBe("ssh");
  });
  it("accepts each listed method", () => {
    for (const method of codeMethods)
      expect(parseCodeMethod(method.id)).toBe(method.id);
  });
});
