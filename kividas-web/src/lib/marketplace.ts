import { request } from "./api";
import { skillsApi, type Skill, type SkillForm } from "./skills";
export interface DirectoryConnector {
  id: string;
  name: string;
  author: string;
  description: string;
  category: string;
  color: string;
  mark: string;
  url?: string;
  docs: string;
}
export const connectorDirectory: DirectoryConnector[] = [
  {
    id: "google-drive",
    name: "Google Drive",
    author: "Google",
    description: "Find documents and work with your files.",
    category: "productivity",
    color: "#288b58",
    mark: "G",
    docs: "https://developers.google.com/drive",
  },
  {
    id: "gmail",
    name: "Gmail",
    author: "Google",
    description: "Find messages and prepare replies from your inbox.",
    category: "communication",
    color: "#d64939",
    mark: "M",
    docs: "https://developers.google.com/gmail",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    author: "Google",
    description: "Work with events, meetings and your schedule.",
    category: "productivity",
    color: "#4285f4",
    mark: "31",
    docs: "https://developers.google.com/calendar",
  },
  {
    id: "canva",
    name: "Canva",
    author: "Canva",
    description: "Create, edit and export visual designs.",
    category: "design",
    color: "#00aeb8",
    mark: "C",
    url: "https://mcp.canva.com/mcp",
    docs: "https://www.canva.dev/docs/apps/mcp/",
  },
  {
    id: "notion",
    name: "Notion",
    author: "Notion",
    description: "Search and update your workspace pages.",
    category: "productivity",
    color: "#222",
    mark: "N",
    url: "https://mcp.notion.com/mcp",
    docs: "https://www.notion.com/help/notion-mcp",
  },
  {
    id: "figma",
    name: "Figma",
    author: "Figma",
    description: "Bring design context into your conversations.",
    category: "design",
    color: "#8b5cf6",
    mark: "F",
    url: "https://mcp.figma.com/mcp",
    docs: "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/",
  },
  {
    id: "slack",
    name: "Slack",
    author: "Slack",
    description: "Search conversations and collaborate with your team.",
    category: "communication",
    color: "#611f69",
    mark: "S",
    url: "https://mcp.slack.com/mcp",
    docs: "https://github.com/anthropics/knowledge-work-plugins/blob/main/productivity/.mcp.json",
  },
  {
    id: "linear",
    name: "Linear",
    author: "Linear",
    description: "Work with issues, projects and team plans.",
    category: "code",
    color: "#5e6ad2",
    mark: "L",
    url: "https://mcp.linear.app/mcp",
    docs: "https://linear.app/docs/mcp",
  },
  {
    id: "atlassian",
    name: "Atlassian",
    author: "Atlassian",
    description: "Bring Jira and Confluence into your workflow.",
    category: "code",
    color: "#1868db",
    mark: "A",
    url: "https://mcp.atlassian.com/v1/mcp",
    docs: "https://github.com/anthropics/knowledge-work-plugins/blob/main/productivity/.mcp.json",
  },
  {
    id: "asana",
    name: "Asana",
    author: "Asana",
    description: "Organize tasks and project work.",
    category: "productivity",
    color: "#ee6c7d",
    mark: "A",
    url: "https://mcp.asana.com/v2/mcp",
    docs: "https://github.com/anthropics/knowledge-work-plugins/blob/main/productivity/.mcp.json",
  },
  {
    id: "amplitude",
    name: "Amplitude",
    author: "Amplitude",
    description: "Explore product analytics and usage data.",
    category: "data",
    color: "#2463de",
    mark: "A",
    url: "https://mcp.amplitude.com/mcp",
    docs: "https://github.com/anthropics/knowledge-work-plugins/blob/main/data/.mcp.json",
  },
  {
    id: "hex",
    name: "Hex",
    author: "Hex",
    description: "Work with analyses and data projects.",
    category: "data",
    color: "#7555a3",
    mark: "H",
    url: "https://app.hex.tech/mcp",
    docs: "https://github.com/anthropics/knowledge-work-plugins/blob/main/data/.mcp.json",
  },
];
export interface PluginEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: string;
  skillCount: number;
  source: string;
  revision: string;
  connectors: { name: string; url: string }[];
  hasScripts: boolean;
}
export interface PluginBundle extends PluginEntry {
  skills: { id: string; name: string; description: string; content: string }[];
}
export async function loadPlugins(): Promise<PluginEntry[]> {
  const r = await fetch("/catalog/plugins/index.json");
  if (!r.ok) throw new Error("Unable to load the plugin directory.");
  return r.json();
}
export async function loadPlugin(id: string): Promise<PluginBundle> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid plugin ID.");
  const r = await fetch(`/catalog/plugins/${id}.json`);
  if (!r.ok) throw new Error("Unable to load this plugin.");
  return r.json();
}
export const pluginTag = (id: string) => `kividas-plugin:${id}`;
export const componentTag = (id: string) => `kividas-plugin-skill:${id}`;
export function ownedPluginSkills(skills: Skill[], userId: string, id: string) {
  return skills.filter(
    (s) => s.user_id === userId && s.meta?.tags?.includes(pluginTag(id)),
  );
}
export function pluginSkillForm(
  bundle: PluginBundle,
  skill: PluginBundle["skills"][number],
): SkillForm {
  return {
    id: `plugin-${bundle.id}-${crypto.randomUUID()}`,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    meta: {
      tags: [
        pluginTag(bundle.id),
        componentTag(skill.id),
        `kividas-plugin-version:${bundle.version}`,
        `kividas-plugin-name:${bundle.name}`,
        `kividas-plugin-description:${bundle.description}`,
      ],
    },
    is_active: true,
    access_grants: [],
  };
}
export async function installPlugin(
  bundle: PluginBundle,
  selected: string[],
  userId: string,
  onProgress: (n: number, total: number) => void,
) {
  const existing = ownedPluginSkills(await skillsApi.all(), userId, bundle.id);
  let count = 0;
  for (const skill of bundle.skills.filter((s) => selected.includes(s.id))) {
    if (!existing.some((s) => s.meta?.tags?.includes(componentTag(skill.id)))) {
      await skillsApi.create(pluginSkillForm(bundle, skill));
    }
    onProgress(++count, selected.length);
  }
}
export interface ToolConnection {
  url: string;
  path: string;
  type: string;
  auth_type: string;
  key: string | null;
  config: {
    enable: boolean;
    access_grants: Record<string, string>[];
    [key: string]: unknown;
  };
  info: {
    id: string;
    name: string;
    description?: string;
    oauth_client_info?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
export function connectorURL(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.hash)
    throw new Error(
      "Use an HTTPS server URL without embedded credentials or a fragment.",
    );
  return u.href;
}
const post = <T>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", body: JSON.stringify(body) });
export const connectorsApi = {
  config: () =>
    request<{ TOOL_SERVER_CONNECTIONS: ToolConnection[] }>(
      "/api/v1/configs/tool_servers",
    ),
  verify: (connection: ToolConnection) =>
    post("/api/v1/configs/tool_servers/verify", connection),
  register: (connection: ToolConnection) =>
    post<{ oauth_client_info: unknown }>(
      "/api/v1/configs/oauth/clients/register?type=mcp",
      { url: connection.url, client_id: connection.info.id },
    ),
  async add(connection: ToolConnection) {
    const latest = await connectorsApi.config();
    if (
      latest.TOOL_SERVER_CONNECTIONS.some(
        (c) => c.info?.id === connection.info.id || c.url === connection.url,
      )
    )
      throw new Error(
        "This server is already configured. Refresh Yours to find it.",
      );
    return post("/api/v1/configs/tool_servers", {
      TOOL_SERVER_CONNECTIONS: [...latest.TOOL_SERVER_CONNECTIONS, connection],
    });
  },
};
export function newConnection(
  name: string,
  url: string,
  userId: string,
  auth: string,
  key: string,
): ToolConnection {
  return {
    type: "mcp",
    url: connectorURL(url),
    path: "",
    auth_type: auth,
    key: auth === "bearer" ? key : null,
    config: {
      enable: true,
      access_grants: [
        { principal_type: "user", principal_id: userId, permission: "read" },
      ],
    },
    info: {
      id: `kividas-${crypto.randomUUID()}`,
      name,
      description: `${name} MCP connector`,
    },
  };
}
export function authorizationPath(id: string) {
  if (!id.startsWith("server:mcp:"))
    throw new Error("This connection does not use MCP account authorization.");
  return `/oauth/clients/${encodeURIComponent("mcp:" + id.slice("server:mcp:".length))}/authorize`;
}
