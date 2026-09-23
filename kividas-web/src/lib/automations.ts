import { request } from "./api";
export interface TaskForm {
  name: string;
  data: {
    prompt: string;
    model_id: string;
    rrule: string;
    terminal?: { server_id: string; cwd?: string } | null;
  };
  meta?: Record<string, unknown> | null;
  is_active: boolean;
}
export interface Task extends TaskForm {
  id: string;
  next_run_at?: number | null;
  last_run?: TaskRun | null;
}
export interface TaskRun {
  id: string;
  chat_id?: string;
  status: string;
  error?: string;
  created_at: number;
}
const root = "/api/v1/automations";
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
export const tasksApi = {
  list: (page = 1, query = "", status = "") =>
    request<{ items: Task[]; total: number }>(
      `${root}/list?${new URLSearchParams({ page: String(page), query, status })}`,
    ),
  save: (form: TaskForm, id?: string) =>
    post<Task>(
      id ? `${root}/${encodeURIComponent(id)}/update` : `${root}/create`,
      form,
    ),
  toggle: (id: string) =>
    post<Task>(`${root}/${encodeURIComponent(id)}/toggle`),
  run: (id: string) => post<Task>(`${root}/${encodeURIComponent(id)}/run`),
  remove: (id: string) =>
    request(`${root}/${encodeURIComponent(id)}/delete`, { method: "DELETE" }),
  runs: (id: string) =>
    request<TaskRun[]>(`${root}/${encodeURIComponent(id)}/runs`),
};
export type Frequency = "hourly" | "daily" | "weekdays" | "weekly" | "monthly";
export function scheduleRule(
  frequency: Frequency,
  time: string,
  day = "MO",
  monthDay = 1,
) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || +match[1] > 23 || +match[2] > 59)
    throw new Error("Choose a valid time.");
  if (!["MO", "TU", "WE", "TH", "FR", "SA", "SU"].includes(day))
    throw new Error("Choose a weekday.");
  if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 28)
    throw new Error("Choose a date from 1 to 28.");
  const parts = [
    `FREQ=${frequency === "weekdays" ? "WEEKLY" : frequency.toUpperCase()}`,
  ];
  if (frequency === "weekdays") parts.push("BYDAY=MO,TU,WE,TH,FR");
  if (frequency === "weekly") parts.push(`BYDAY=${day}`);
  if (frequency === "monthly") parts.push(`BYMONTHDAY=${monthDay}`);
  if (frequency !== "hourly") parts.push(`BYHOUR=${+match[1]}`);
  parts.push(`BYMINUTE=${+match[2]}`, "BYSECOND=0");
  return "RRULE:" + parts.join(";");
}
export function scheduleLabel(rule: string) {
  const values = Object.fromEntries(
    rule
      .replace(/^RRULE:/, "")
      .split(";")
      .map((p) => p.split("=")),
  );
  const time = `${(values.BYHOUR || "0").padStart(2, "0")}:${(values.BYMINUTE || "0").padStart(2, "0")}`;
  if (values.FREQ === "HOURLY")
    return `Hourly at :${(values.BYMINUTE || "0").padStart(2, "0")}`;
  if (values.FREQ === "DAILY") return `Daily at ${time}`;
  if (values.FREQ === "WEEKLY")
    return `${values.BYDAY === "MO,TU,WE,TH,FR" ? "Weekdays" : values.BYDAY || "Weekly"} at ${time}`;
  if (values.FREQ === "MONTHLY")
    return `Monthly on day ${values.BYMONTHDAY || "1"} at ${time}`;
  return "Custom schedule";
}
