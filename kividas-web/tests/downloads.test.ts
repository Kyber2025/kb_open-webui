import { describe, expect, it } from "vitest";
import {
  desktopBuilds,
  desktopFallback,
  safeDownload,
} from "../src/lib/downloads";

describe("download release compatibility", () => {
  it("retains macOS when a release only updates Windows", () => {
    const windows = { version: "2.0", url: "https://dl.kividas.com/new.exe" };
    expect(desktopBuilds({ platforms: { windows } })).toEqual({
      windows,
      mac: desktopFallback.mac,
    });
  });
  it("handles the legacy Windows-only response", () => {
    const oldResponse = {
      version: "2.0",
      url: "https://dl.kividas.com/new.exe",
    };
    expect(desktopBuilds(oldResponse)).toEqual({
      windows: oldResponse,
      mac: desktopFallback.mac,
    });
  });
  it("preserves independent platform versions without duplicate Windows links", () => {
    const platforms = {
      mac: { version: "2.1", url: "https://dl.kividas.com/new.dmg" },
      windows: { version: "2.0", url: "https://dl.kividas.com/new.exe" },
    };
    expect(desktopBuilds({ ...platforms.windows, platforms })).toEqual(
      platforms,
    );
  });
  it("retains known installers on empty or invalid feed data", () => {
    expect(desktopBuilds(null)).toEqual(desktopFallback);
    expect(
      desktopBuilds({
        platforms: { mac: { version: "3", url: "javascript:alert(1)" } },
      }),
    ).toEqual(desktopFallback);
  });
  it("permits CLI binaries with no filename extension", () => {
    expect(
      safeDownload("https://dl.kividas.com/cli/0.1.11/linux-x64/kividas"),
    ).toBe(true);
  });
  it("rejects insecure links, lookalike hosts, credentials and non-URLs", () => {
    for (const url of [
      "http://dl.kividas.com/file",
      "https://dl.kividas.com.evil.test/file",
      "https://user@dl.kividas.com/file",
      "javascript:alert(1)",
      null,
      {},
    ]) {
      expect(safeDownload(url)).toBe(false);
    }
  });
});
