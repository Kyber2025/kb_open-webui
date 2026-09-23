import { request } from "./api";
export interface Skill {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  content?: string;
  meta: { tags?: string[] };
  is_active: boolean;
  write_access?: boolean;
  access_grants?: Array<Record<string, unknown>>;
  user?: { name: string };
  created_at?: number;
  updated_at?: number;
}
export interface SkillForm {
  id: string;
  name: string;
  description: string;
  content: string;
  meta: { tags: string[] };
  is_active: boolean;
  access_grants?: Array<Record<string, unknown>>;
}
export interface Capability {
  authenticated?: boolean;
  id: string;
  name: string;
  type?: string;
  is_active?: boolean;
  is_global?: boolean;
  meta?: { description?: string };
}
const base = "/api/v1/skills";
export const skillsApi = {
  all: () => request<Skill[]>(`${base}/`),
  list: (page = 1, query = "", view = "created") =>
    request<{ items: Skill[]; total: number }>(
      `${base}/list?${new URLSearchParams({ page: String(page), query, view_option: view })}`,
    ),
  get: (id: string) => request<Skill>(`${base}/id/${encodeURIComponent(id)}`),
  create: (form: SkillForm) =>
    request<Skill>(`${base}/create`, {
      method: "POST",
      body: JSON.stringify(form),
    }),
  update: (id: string, form: SkillForm) =>
    request<Skill>(`${base}/id/${encodeURIComponent(id)}/update`, {
      method: "POST",
      body: JSON.stringify(form),
    }),
  toggle: (id: string) =>
    request<Skill>(`${base}/id/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
    }),
  remove: (id: string) =>
    request<boolean>(`${base}/id/${encodeURIComponent(id)}/delete`, {
      method: "DELETE",
    }),
  permissions: () =>
    request<{ workspace?: { skills?: boolean } }>("/api/v1/users/permissions"),
  connectors: () => request<Capability[]>("/api/v1/tools/"),
  plugins: () => request<Capability[]>("/api/v1/functions/"),
};
export function skillForm(skill: Skill): SkillForm {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description || "",
    content: skill.content || "",
    meta: { tags: skill.meta?.tags || [] },
    is_active: skill.is_active,
    access_grants: skill.access_grants || [],
  };
}
export function selectedSkillIds(ids: string[], accessible: Skill[]) {
  const allowed = new Set(
    accessible.filter((s) => s.is_active).map((s) => s.id),
  );
  return [...new Set(ids)].filter((id) => allowed.has(id));
}
export const skillTemplates: SkillForm[] = [
  {
    id: "data",
    name: "Data",
    description:
      "Query, chart and explain your data — SQL, spreadsheets and dashboards in one place.",
    content:
      "Help analyze the data provided in this conversation. Clarify the question and available columns, check missing values and assumptions, and explain calculations. Propose SQL or spreadsheet formulas when useful. Distinguish observations from estimates. Never invent data or claim a calculation was executed unless a tool actually ran it.",
    meta: { tags: ["data", "analysis"] },
    is_active: true,
    access_grants: [],
  },
  {
    id: "learn",
    name: "Learn",
    description:
      "Build understanding with clear explanations, useful examples and thoughtful questions.",
    content:
      "Teach the topic at the learner's level. Start with a concrete example, explain the key idea in plain language, then offer a short practice question. Check understanding before introducing more advanced concepts. Admit uncertainty and correct misunderstandings patiently.",
    meta: { tags: ["learning"] },
    is_active: true,
    access_grants: [],
  },
  {
    id: "doc-coauthoring",
    name: "Document coauthoring",
    description:
      "Turn a rough brief into a clear, well-structured document together.",
    content:
      "Collaborate on documents. Identify the intended audience, purpose and constraints. Propose a concise outline, draft sections using only supplied facts, and revise for clarity and consistency. Mark facts that require verification; do not invent sources or quotations.",
    meta: { tags: ["writing"] },
    is_active: true,
    access_grants: [],
  },
  {
    id: "code-review",
    name: "Code review",
    description:
      "Review changes for correctness, edge cases and maintainability.",
    content:
      "Review the code provided. Prioritize reproducible bugs, security boundaries and regressions over stylistic preferences. Explain the trigger, impact and smallest useful fix for each finding. Identify missing context rather than assuming it. Suggest focused tests for important behavior.",
    meta: { tags: ["development"] },
    is_active: true,
    access_grants: [],
  },
  {
    id: "project-planning",
    name: "Project planning",
    description:
      "Break a goal into practical milestones, decisions and next steps.",
    content:
      "Help turn a goal into an actionable plan. Establish the desired outcome, constraints and dependencies. Break work into concrete milestones with a definition of done. Surface unresolved decisions and propose reasonable defaults. Avoid inventing deadlines, resources or commitments.",
    meta: { tags: ["planning"] },
    is_active: true,
    access_grants: [],
  },
  {
    id: "writing-editor",
    name: "Writing editor",
    description: "Make a draft clearer while keeping the author's voice.",
    content:
      "Edit the supplied draft for clarity, structure and precision while preserving meaning and voice. Remove repetition and unnecessary jargon. Do not add unverified claims. Return an improved draft and briefly explain substantive changes when useful.",
    meta: { tags: ["writing"] },
    is_active: true,
    access_grants: [],
  },
];
