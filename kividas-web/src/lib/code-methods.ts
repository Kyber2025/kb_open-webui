// The three ways to code with a Kividas account, in the order /code shows
// them. The Claude Code Gateway comes first and is the default selection.
export type CodeMethodId = "gateway" | "desktop" | "cli";

export interface CodeMethod {
  id: CodeMethodId;
  /** Small label above the title, e.g. "官方客户端". */
  tagline: string;
  title: string;
  description: string;
  /** Platform or client line shown in the card footer. */
  platforms: string;
  badge?: string;
}

export const codeMethods: readonly CodeMethod[] = [
  {
    id: "gateway",
    tagline: "官方客户端",
    title: "Claude Code Gateway",
    description:
      "用 Kividas 订阅接入官方 Claude 桌面端和 Claude Code CLI，用量计入你的订阅。",
    platforms: "macOS · Windows · CLI",
    badge: "推荐",
  },
  {
    id: "desktop",
    tagline: "桌面客户端",
    title: "Kividas Code",
    description:
      "Kividas 的 AI 编程桌面客户端，下载安装后用 Kividas 账号登录即可使用。",
    platforms: "macOS · Windows",
  },
  {
    id: "cli",
    tagline: "终端命令行",
    title: "Kividas CLI",
    description:
      "一条命令安装，在任意终端用 Kividas 账号运行 Claude Code，无需 Node.js。",
    platforms: "macOS · Windows · Linux",
  },
];

export const defaultCodeMethod: CodeMethodId = codeMethods[0].id;

/** Resolve a `?method=` query value; anything unknown falls back to the Gateway. */
export function parseCodeMethod(value: unknown): CodeMethodId {
  return codeMethods.some((method) => method.id === value)
    ? (value as CodeMethodId)
    : defaultCodeMethod;
}
