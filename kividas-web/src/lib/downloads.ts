export interface Build {
  version?: string | null;
  url: string;
  sha256?: string | null;
}
export interface DesktopRelease {
  version?: string | null;
  url?: string | null;
  platforms?: Partial<Record<"mac" | "windows", Build>>;
}
export interface CliRelease {
  version?: string | null;
  claude_version?: string | null;
  platforms?: Partial<
    Record<"mac" | "windows" | "linux_x64" | "linux_arm64", Build>
  >;
}
// Last verified installers from the existing /code page (2026-09-23).
// Fresh backend metadata takes precedence separately for each platform.
export const desktopFallback = {
  mac: {
    version: "1.1.8",
    url: "https://dl.kividas.com/KividasCode_1.1.8_aarch64.dmg",
  },
  windows: {
    version: "1.1.8",
    url: "https://dl.kividas.com/KividasCode_1.1.8_x64-setup.exe",
  },
};
export const installCommands = {
  sh: "curl -fsSL https://dl.kividas.com/cli/install.sh | sh",
  ps1: "irm https://dl.kividas.com/cli/install.ps1 | iex",
};
export function safeDownload(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === "https://dl.kividas.com" &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
export function desktopBuilds(data: DesktopRelease | null) {
  const valid = (entry: Build | null | undefined) =>
    entry?.version && safeDownload(entry.url) ? entry : null;
  return {
    mac: valid(data?.platforms?.mac) ?? desktopFallback.mac,
    windows:
      valid(data?.platforms?.windows) ??
      valid(data?.url ? { version: data.version, url: data.url } : null) ??
      desktopFallback.windows,
  };
}
export const cliPlatforms = [
  { key: "mac", name: "macOS (.app)" },
  { key: "windows", name: "Windows (.exe)" },
  { key: "linux_x64", name: "Linux x64" },
  { key: "linux_arm64", name: "Linux arm64" },
] as const;
