// SSH is the recommended default; Gateway remains available as the second tab.
export type CodeMethodId = "ssh" | "gateway";

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
    id: "ssh", tagline: "云端开发工作区", title: "SSH 工作区",
    description: "连接你的专属 VPS，在终端直接使用 Claude Code。支持 Git、文件传输与断线会话恢复。",
    platforms: "macOS · Linux · Windows", badge: "推荐",
  },
  {
    id: "gateway", tagline: "本地客户端接入", title: "Claude Code Gateway",
    description: "用 Kividas 订阅连接官方 Claude 桌面端和 Claude Code CLI，在自己的电脑上工作。",
    platforms: "macOS · Windows · CLI",
  },
];

export const defaultCodeMethod: CodeMethodId = codeMethods[0].id;

/** Resolve a `?method=` query value; anything unknown falls back to SSH. */
export function parseCodeMethod(value: unknown): CodeMethodId {
  return codeMethods.some((method) => method.id === value)
    ? (value as CodeMethodId)
    : defaultCodeMethod;
}
