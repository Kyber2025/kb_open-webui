/** In-memory backend for local UI verification. Never included in production builds. */
import type { Skill } from "../src/lib/skills";
import type { Task } from "../src/lib/automations";
import type { ManagedUser, UserPlan } from "../src/lib/admin-users";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  Chat,
  Folder,
  GiftCard,
  GuestConfig,
  Tier,
} from "../src/lib/types";
const models = [
  {
    id: "claude-fable-5-1",
    name: "Claude Fable 5.1",
    info: { meta: { description: "For your toughest challenges" } },
  },
  {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    info: {
      meta: { description: "For ambitious work and thoughtful answers" },
    },
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    info: { meta: { description: "Efficient for everyday tasks" } },
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    info: { meta: { description: "Reasoning, writing, and coding" } },
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    info: { meta: { description: "Fast answers for quick questions" } },
  },
];
const defaults: Tier[] = [
  {
    id: "free",
    name: "Free",
    description: "Get started with a small token quota.",
    price_usd: 0,
    duration_days: 36500,
    token_limit_5h: 200000,
    token_limit_week: 1000000,
    extra_usage_multiplier: 1,
    allowed_model_ids: ["claude-sonnet-5", "claude-haiku-4-5"],
    enabled: true,
    sort_order: 0,
  },
  {
    id: "pro",
    name: "Max 7x",
    description: "For everyday work and bigger ideas.",
    price_usd: 90,
    duration_days: 30,
    token_limit_5h: 7000000,
    token_limit_week: 35000000,
    extra_usage_multiplier: 1,
    allowed_model_ids: [],
    enabled: true,
    sort_order: 1,
  },
  {
    id: "max",
    name: "Max 10x",
    description: "More room for your most ambitious work.",
    price_usd: 130,
    duration_days: 30,
    token_limit_5h: 10000000,
    token_limit_week: 50000000,
    extra_usage_multiplier: 1,
    allowed_model_ids: [],
    enabled: true,
    sort_order: 2,
  },
];
const demoUser = {
  id: "demo-admin",
  name: "Alex",
  email: "preview@example.test",
  role: process.env.KIVIDAS_DEMO_ROLE === "user" ? "user" : "admin",
};
export function demoBackend(): Plugin {
  return {
    name: "kividas-local-demo",
    apply: "serve",
    configureServer(server) {
      let demoUsers: ManagedUser[] = [
        {
          ...demoUser,
          created_at: 1780000000,
          last_active_at: Math.floor(Date.now() / 1000),
        },
        {
          id: "demo-jamie",
          name: "Jamie",
          email: "jamie@example.test",
          role: "user",
          created_at: 1780000500,
          last_active_at: 1789000000,
        },
        {
          id: "demo-robin",
          name: "Robin",
          email: "robin@example.test",
          role: "pending",
          created_at: 1780001000,
          last_active_at: 1789000000,
        },
      ];
      const demoPlans: Record<string, UserPlan> = {};
      const snapshot = (id: string): UserPlan =>
        demoPlans[id] ?? {
          tier: defaults[id === "demo-jamie" ? 1 : 0],
          expires_at:
            id === "demo-jamie"
              ? Math.floor(Date.now() / 1000) + 86400 * 30
              : null,
          kyber_linked: true,
          usage: {
            tp5h: { used: 180000, limit: 7000000, resetAt: new Date(Date.now() + 14460000).toISOString() },
            tpw: { used: 2100000, limit: 35000000, resetAt: new Date(Date.now() + 4 * 86400000).toISOString() },
            tpwFable: { used: 700000, limit: 7000000, resetAt: new Date(Date.now() + 4 * 86400000).toISOString() },
          },
        };
      let tiers = structuredClone(defaults),
        cards: GiftCard[] = [
          {
            code: "DEMO-7X-2026-WELCOME",
            tier_id: "pro",
            duration_days: 30,
            enabled: true,
            created_at: 1780000000,
            note: "Sample welcome gift",
          },
          {
            code: "DEMO-10X-2026-SHARED",
            tier_id: "max",
            duration_days: 30,
            enabled: true,
            redeemed_by: "sample-user",
            redeemed_at: 1780000100,
            created_at: 1780000000,
          },
          {
            code: "DEMO-7X-2026-PAUSED",
            tier_id: "pro",
            duration_days: 7,
            enabled: false,
            created_at: 1780000000,
          },
        ],
        folders: Folder[] = [
          { id: "demo-project", name: "Ideas for the next chapter" },
        ],
        blacklist: { ip: string; reason: string; created_at: number }[] = [];
      let guest: GuestConfig = {
        ENABLE_GUEST_ACCESS: true,
        GUEST_DAILY_LIMIT: 5,
        GUEST_ALLOWED_MODEL_IDS: ["claude-sonnet-5", "claude-haiku-4-5"],
        GUEST_BLOCKED_MODEL_IDS: [],
      };
      let chats: Chat[] = [
        {
          id: "demo-welcome",
          title: "A fresh perspective",
          updated_at: 1780000000,
          chat: {
            title: "A fresh perspective",
            models: [models[0].id],
            messages: [
              {
                id: "demo-m1",
                role: "user",
                content: "What can we work on together?",
              },
              {
                id: "demo-m2",
                role: "assistant",
                content:
                  "We can turn a rough idea into something useful.\n\n- **Write** something clear and thoughtful\n- **Learn** a topic step by step\n- **Build** a piece of software\n\nThis conversation is sample data in the local preview.",
              },
            ],
          },
        },
        {
          id: "demo-code",
          title: "A small idea, brought to life",
          chat: {
            title: "A small idea, brought to life",
            models: [models[0].id],
            messages: [
              {
                id: "demo-c1",
                role: "user",
                content: "Show a simple greeting in JavaScript.",
              },
              {
                id: "demo-c2",
                role: "assistant",
                content:
                  "Here is a small starting point:\n\n```javascript\nfunction greet(name) {\n  return `Hello, ${name}!`;\n}\n```",
              },
            ],
          },
        },
      ];
      let skills: Skill[] = [
        {
          id: "demo-skill",
          user_id: demoUser.id,
          name: "Clear writing",
          description: "Keep drafts clear, direct and easy to read.",
          content:
            "Use plain language. Preserve supplied facts and the author’s voice.",
          meta: { tags: ["writing"] },
          is_active: true,
          access_grants: [],
        },
      ];
      let tasks: Task[] = [];
      let toolConnections: any[] = [];
      let preferences: any = { ui: { system: "" } };
      let memories: any[] = [];
      async function handle(
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void,
      ) {
        const url = new URL(req.url || "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        const path = url.pathname,
          method = req.method || "GET";
        let data: any = {};
        if (method === "POST") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          try {
            data = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                detail:
                  "File upload is available with the real backend; this local preview does not process documents.",
              }),
            );
            return;
          }
        }
        const json = (value: unknown, status = 200) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(value));
        };
        if (path === "/api/config")
          return json({
            name: "Kividas",
            demo: true,
            features: {
              enable_guest_access: true,
              enable_web_search: true,
              enable_memories: true,
              enable_automations: true,
            },
            default_models: "claude-opus-5-5",
          });
        if (path === "/api/v1/auths/guest" || path === "/api/v1/auths/signin")
          return json({ ...demoUser, token: "local-demo-only" });
        if (req.headers.authorization !== "Bearer local-demo-only")
          return json({ detail: "Sign in to the local demo." }, 401);
        if (
          demoUser.role !== "admin" &&
          (path.startsWith("/api/v1/subscriptions/admin/") ||
            path.startsWith("/api/v1/guest/") ||
            path.startsWith("/api/v1/configs/") ||
            (path.startsWith("/api/v1/users/") &&
              ![
                "/api/v1/users/permissions",
                "/api/v1/users/user/settings",
                "/api/v1/users/user/settings/update",
              ].includes(path)) ||
            path === "/api/v1/auths/add")
        )
          return json({ detail: "Administrator access required." }, 403);
        if (path === "/api/v1/users/permissions")
          return json({
            workspace: { skills: true },
            features: { automations: true, memories: true },
          });
        if (path === "/api/v1/users/user/settings") return json(preferences);
        if (path === "/api/v1/users/user/settings/update") {
          preferences = data;
          return json(preferences);
        }
        if (path === "/api/v1/auths/update/profile") {
          demoUser.name = data.name;
          return json(demoUser);
        }
        if (path === "/api/v1/configs/tool_servers/verify")
          return json({ status: true });
        if (path === "/api/v1/configs/oauth/clients/register")
          return json({
            status: true,
            oauth_client_info: "local-demo-placeholder",
          });
        if (path === "/api/v1/configs/tool_servers") {
          if (method === "POST") toolConnections = data.TOOL_SERVER_CONNECTIONS;
          return json({ TOOL_SERVER_CONNECTIONS: toolConnections });
        }
        if (path === "/api/v1/tools/")
          return json(
            toolConnections.map((c) => ({
              id: `server:mcp:${c.info.id}`,
              name: c.info.name,
              meta: { description: c.info.description },
              ...(c.auth_type === "oauth_2.1" ? { authenticated: false } : {}),
            })),
          );
        if (path === "/api/v1/functions/") return json([]);
        if (path === "/api/v1/memories/") return json(memories);
        if (path === "/api/v1/memories/add") {
          const m = { id: crypto.randomUUID(), content: data.content };
          memories.push(m);
          return json(m);
        }
        if (path.startsWith("/api/v1/memories/")) {
          const id = path.split("/")[4],
            m = memories.find((m) => m.id === id);
          if (!m) return json({ detail: "Memory not found" }, 404);
          if (method === "DELETE") {
            memories = memories.filter((m) => m.id !== id);
            return json(true);
          }
          Object.assign(m, data);
          return json(m);
        }
        if (path === "/api/v1/skills/") return json(skills);
        if (path === "/api/v1/skills/create") {
          if (skills.some((s) => s.id === data.id))
            return json({ detail: "Skill already exists" }, 400);
          const s = { ...data, user_id: demoUser.id, updated_at: Date.now() };
          skills.push(s);
          return json(s);
        }
        if (path.startsWith("/api/v1/skills/id/")) {
          const id = decodeURIComponent(path.split("/")[5]),
            s = skills.find((s) => s.id === id);
          if (!s) return json({ detail: "Skill not found" }, 404);
          if (method === "DELETE") {
            skills = skills.filter((s) => s.id !== id);
            return json(true);
          }
          if (path.endsWith("/toggle")) s.is_active = !s.is_active;
          else if (method === "POST")
            Object.assign(s, data, { updated_at: Date.now() });
          return json({ ...s, write_access: true });
        }
        if (path === "/api/v1/automations/list") {
          const q = url.searchParams.get("query") || "",
            status = url.searchParams.get("status");
          const found = tasks.filter(
            (t) =>
              t.name.toLowerCase().includes(q.toLowerCase()) &&
              (!status || (status === "active" ? t.is_active : !t.is_active)),
          );
          const page = +(url.searchParams.get("page") || 1);
          return json({
            items: found.slice((page - 1) * 30, page * 30),
            total: found.length,
          });
        }
        if (path === "/api/v1/automations/create") {
          const t = {
            ...data,
            id: crypto.randomUUID(),
            next_run_at: (Date.now() + 86400000) * 1e6,
          };
          tasks.unshift(t);
          return json(t);
        }
        if (path.startsWith("/api/v1/automations/")) {
          const id = path.split("/")[4],
            t = tasks.find((t) => t.id === id);
          if (!t) return json({ detail: "Task not found" }, 404);
          if (path.endsWith("/runs"))
            return json(t.last_run ? [t.last_run] : []);
          if (path.endsWith("/toggle")) t.is_active = !t.is_active;
          if (path.endsWith("/update")) Object.assign(t, data);
          if (path.endsWith("/delete")) {
            tasks = tasks.filter((t) => t.id !== id);
            return json(true);
          }
          if (path.endsWith("/run"))
            t.last_run = {
              id: crypto.randomUUID(),
              status: "success",
              created_at: Date.now() * 1e6,
              chat_id: "demo-welcome",
            };
          return json(t);
        }
        if (path === "/api/v1/auths/") return json(demoUser);
        if (path === "/api/v1/auths/signout") return json({ status: true });
        if (path === "/api/models") return json({ data: models });
        if (path === "/api/v1/kyber/usage/limits")
          return json({ linked: false });
        if (path === "/api/v1/subscriptions/me")
          return json({ tier: tiers[1], subscription: { tier_id: "pro" } });
        if (path === "/api/v1/subscriptions/redeem")
          return json({ success: true });
        if (path === "/api/v1/users/") {
          const q = (url.searchParams.get("query") || "").toLowerCase();
          const key = url.searchParams.get("order_by") || "created_at",
            sign = url.searchParams.get("direction") === "desc" ? -1 : 1;
          const found = demoUsers
            .filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q))
            .sort(
              (a, b) =>
                String((a as any)[key]).localeCompare(
                  String((b as any)[key]),
                  undefined,
                  { numeric: true },
                ) * sign,
            );
          const page = Number(url.searchParams.get("page") || 1);
          return json({
            users: found.slice((page - 1) * 30, page * 30),
            total: found.length,
          });
        }
        if (path === "/api/v1/auths/add") {
          const created = {
            id: crypto.randomUUID(),
            name: data.name,
            email: data.email,
            role: data.role,
            created_at: Math.floor(Date.now() / 1000),
          };
          demoUsers.push(created);
          return json(created);
        }
        if (path === "/api/v1/subscriptions/admin/users/overview")
          return json({
            users: Object.fromEntries(
              data.user_ids.map((id: string) => [id, snapshot(id)]),
            ),
          });
        const userAction =
          /^\/api\/v1\/users\/([^/]+)(?:\/(update|ban|preview))?$/.exec(path);
        if (userAction) {
          const id = decodeURIComponent(userAction[1]);
          const u = demoUsers.find((u) => u.id === id);
          if (!u) return json({ detail: "User not found" }, 404);
          if (userAction[2] === "preview")
            return json({
              groups: [],
              models: { items: models, total: models.length },
              knowledge: { items: [], total: 0 },
              tools: { items: [], total: 0 },
            });
          if (userAction[2] === "update") {
            const { password, ...fields } = data;
            Object.assign(u, fields);
            return json(u);
          }
          if (userAction[2] === "ban") {
            if (u.role === "admin")
              return json({ detail: "Admin accounts cannot be banned" }, 403);
            u.role = data.banned ? "pending" : "user";
            u.info = data.banned
              ? {
                  banned_at: Math.floor(Date.now() / 1000),
                  ban_reason: data.reason,
                }
              : {};
            return json(u);
          }
          if (method === "DELETE") {
            demoUsers = demoUsers.filter((u) => u.id !== id);
            return json(true);
          }
        }
        const planAction =
          /^\/api\/v1\/subscriptions\/admin\/users\/([^/]+)\/(subscription|usage\/reset)$/.exec(
            path,
          );
        if (planAction) {
          const id = decodeURIComponent(planAction[1]);
          const p = structuredClone(snapshot(id));
          if (planAction[2] === "subscription") {
            const tier = tiers.find(
              (t) => t.id === (method === "DELETE" ? "free" : data.tier_id),
            );
            p.tier = tier;
            p.expires_at =
              tier?.id === "free"
                ? null
                : data.expires_at ||
                  Math.floor(Date.now() / 1000) +
                    (tier?.duration_days || 30) * 86400;
            p.rate_limits_synced = true;
            p.token_billing_enabled = true;
          } else
            for (const w of data.windows || ["5h", "week"]) {
              if (w === "5h" && p.usage?.tp5h) p.usage.tp5h.used = 0;
              if (w === "week" && p.usage?.tpw) p.usage.tpw.used = 0;
              if ((w === "week" || w === "fable") && p.usage?.tpwFable)
                p.usage.tpwFable.used = 0;
            }
          demoPlans[id] = p;
          return json(p);
        }
        if (path.startsWith("/api/v1/chats/list/user/"))
          return json(
            Number(url.searchParams.get("page") || 1) > 1
              ? []
              : chats.filter((c) =>
                  c.title
                    .toLowerCase()
                    .includes(
                      (url.searchParams.get("query") || "").toLowerCase(),
                    ),
                ),
          );
        if (path === "/api/v1/subscriptions/admin/models") return json(models);
        if (path === "/api/v1/subscriptions/admin/seed") {
          tiers = structuredClone(defaults);
          return json(tiers);
        }
        if (path === "/api/v1/subscriptions/admin/tiers") {
          if (method === "POST") {
            tiers = [...tiers.filter((t) => t.id !== data.id), data];
            return json(data);
          }
          return json(tiers);
        }
        if (
          path.startsWith("/api/v1/subscriptions/admin/tiers/") &&
          method === "DELETE"
        ) {
          const id = decodeURIComponent(path.split("/").pop()!);
          if (id === "free")
            return json({ detail: "The free plan cannot be deleted." }, 400);
          tiers = tiers.filter((t) => t.id !== id);
          return json({ success: true });
        }
        if (path === "/api/v1/subscriptions/admin/gift-cards") {
          if (method === "POST") {
            const batch = crypto.randomUUID();
            const created: GiftCard[] = Array.from(
              { length: data.count },
              () => ({
                code: `DEMO-${crypto.randomUUID().slice(0, 18).toUpperCase()}`,
                tier_id: data.tier_id,
                duration_days:
                  data.duration_days ||
                  tiers.find((t) => t.id === data.tier_id)?.duration_days ||
                  30,
                enabled: true,
                note: data.note,
                batch_id: batch,
                created_at: Math.floor(Date.now() / 1000),
              }),
            );
            cards.unshift(...created);
            return json(created);
          }
          const status = url.searchParams.get("status_filter"),
            search = (url.searchParams.get("search") || "")
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "");
          return json({
            cards: cards.filter(
              (c) =>
                (!status ||
                  status === "all" ||
                  (status === "available" && c.enabled && !c.redeemed_by) ||
                  (status === "redeemed" && !!c.redeemed_by) ||
                  (status === "disabled" && !c.enabled)) &&
                c.code.replace(/[^A-Z0-9]/g, "").includes(search),
            ),
            counts: {
              total: cards.length,
              available: cards.filter((c) => c.enabled && !c.redeemed_by)
                .length,
              redeemed: cards.filter((c) => c.redeemed_by).length,
              disabled: cards.filter((c) => !c.enabled).length,
            },
          });
        }
        if (path.startsWith("/api/v1/subscriptions/admin/gift-cards/")) {
          const bits = path.split("/"),
            code = decodeURIComponent(bits[6]),
            c = cards.find((c) => c.code === code);
          if (!c) return json({ detail: "Gift card not found" }, 404);
          if (method === "DELETE") cards = cards.filter((c) => c.code !== code);
          else if (bits[7] === "status") c.enabled = data.enabled;
          else if (bits[7] === "invalidate") c.enabled = false;
          return json(c);
        }
        if (path === "/api/v1/guest/config") {
          if (method === "POST") guest = data;
          return json(guest);
        }
        if (path === "/api/v1/guest/blacklist") {
          if (method === "POST") {
            const entry = {
              ...data,
              created_at: Math.floor(Date.now() / 1000),
            };
            blacklist = [...blacklist.filter((x) => x.ip !== entry.ip), entry];
            return json(entry);
          }
          return json(blacklist);
        }
        if (
          path.startsWith("/api/v1/guest/blacklist/") &&
          method === "DELETE"
        ) {
          blacklist = blacklist.filter(
            (b) => b.ip !== decodeURIComponent(path.split("/").pop()!),
          );
          return json({ success: true });
        }
        if (path === "/api/v1/folders/") {
          if (method === "POST") {
            const f = {
              id: crypto.randomUUID(),
              name: data.name,
              data: data.data,
            };
            folders.push(f);
            return json(f);
          }
          return json(folders);
        }
        if (path.startsWith("/api/v1/folders/")) {
          const id = path.split("/")[4],
            f = folders.find((f) => f.id === id);
          if (!f) return json({ detail: "Project not found" }, 404);
          if (method === "POST") Object.assign(f, data);
          return json(f);
        }
        if (path === "/api/v1/chats/pinned")
          return json(chats.filter((c) => c.pinned && !c.archived));
        if (path === "/api/v1/chats/all") return json(chats);
        if (path === "/api/v1/chats/all/archived")
          return json(chats.filter((c) => c.archived));
        if (/^\/api\/v1\/chats\/[^/]+\/(pin|folder|archive)$/.test(path)) {
          const id = path.split("/")[4],
            c = chats.find((c) => c.id === id);
          if (!c) return json({ detail: "Chat not found" }, 404);
          if (path.endsWith("/pin")) c.pinned = !c.pinned;
          if (path.endsWith("/archive")) c.archived = !c.archived;
          if (path.endsWith("/folder")) c.folder_id = data.folder_id;
          return json(c);
        }
        if (path === "/api/v1/chats/search")
          return json(
            chats.filter((c) =>
              c.title
                .toLowerCase()
                .includes((url.searchParams.get("text") || "").toLowerCase()),
            ),
          );
        if (path === "/api/v1/chats/")
          return json(
            url.searchParams.get("page") === "1"
              ? chats
                  .filter((c) => !c.archived)
                  .map(({ chat, ...rest }) => rest)
              : [],
          );
        if (path.startsWith("/api/v1/chats/folder/"))
          return json(
            chats.filter(
              (c) => c.folder_id === decodeURIComponent(path.split("/").pop()!),
            ),
          );
        if (path === "/api/v1/chats/new") {
          const c = {
            id: crypto.randomUUID(),
            title: data.chat.title,
            chat: data.chat,
            folder_id: data.folder_id,
          };
          chats.unshift(c);
          return json(c);
        }
        if (path.startsWith("/api/v1/chats/")) {
          const id = path.split("/").pop(),
            c = chats.find((c) => c.id === id);
          if (!c) return json({ detail: "Conversation not found" }, 404);
          if (method === "POST") {
            c.chat = { ...c.chat, ...data.chat };
            c.title = data.chat.title || c.title;
          }
          if (method === "DELETE") {
            chats = chats.filter((chat) => chat.id !== id);
            return json(true);
          }
          return json(c);
        }
        if (path === "/api/v1/code/latest")
          return json({
            platforms: {
              mac: {
                version: "1.1.8",
                url: "https://dl.kividas.com/KividasCode_1.1.8_aarch64.dmg",
              },
              windows: {
                version: "1.1.8",
                url: "https://dl.kividas.com/KividasCode_1.1.8_x64-setup.exe",
              },
            },
          });
        if (path === "/api/v1/code/cli")
          return json({
            version: "0.1.11",
            claude_version: "2.1.280",
            platforms: {
              mac: {
                url: "https://dl.kividas.com/cli/0.1.11/darwin-universal/KividasCLI-0.1.11-macos.zip",
              },
              windows: {
                url: "https://dl.kividas.com/cli/0.1.11/windows-x64/kividas.exe",
              },
              linux_x64: {
                url: "https://dl.kividas.com/cli/0.1.11/linux-x64/kividas",
              },
              linux_arm64: {
                url: "https://dl.kividas.com/cli/0.1.11/linux-arm64/kividas",
              },
            },
          });
        if (path === "/api/chat/completions") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          });
          const words = (
            `Effort received: **${data.params?.reasoning_effort || "default"}**.\n\n` +
            `Skills received: **${(data.skill_ids || []).join(", ") || "none"}**.\n\n` +
            "This is a **local preview response**. Your new Kividas interface supports streaming, Markdown, model selection, and saved conversations.\n\nWhen connected to your existing backend, responses come from the model selected below."
          ).split(" ");
          let i = 0;
          const timer = setInterval(() => {
            if (i >= words.length) {
              clearInterval(timer);
              res.end("data: [DONE]\n\n");
              return;
            }
            res.write(
              `data: ${JSON.stringify({ choices: [{ delta: { content: words[i++] + (i < words.length ? " " : "") } }] })}\n\n`,
            );
          }, 35);
          res.on("close", () => clearInterval(timer));
          return;
        }
        return json({ detail: `No demo fixture for ${method} ${path}` }, 404);
      }
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next).catch(() => {
          res.statusCode = 500;
          res.end(JSON.stringify({ detail: "Local demo error" }));
        });
      });
    },
  };
}
