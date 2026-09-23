import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clock,
  Plus,
  Play,
  Pause,
  Pencil,
  History,
  Trash2,
  Search,
} from "lucide-react";
import {
  tasksApi,
  scheduleRule,
  scheduleLabel,
  type Task,
  type TaskForm,
  type TaskRun,
  type Frequency,
} from "../lib/automations";
import type { Model, User } from "../lib/types";
import {
  Confirm,
  Empty,
  ErrorPanel,
  Loading,
  Modal,
  messageOf,
  useNotify,
} from "../components/UI";
const templates = [
  [
    "Daily briefing",
    "Prepare a concise briefing based on information available to you. Identify any missing sources.",
  ],
  [
    "Weekly review",
    "Help review progress toward my goals. Use only available context and flag missing information.",
  ],
  [
    "Content ideas",
    "Suggest three content ideas about a topic I specify, with a title and short outline.",
  ],
];
export function Scheduled({ models, user }: { models: Model[]; user: User }) {
  const [items, setItems] = useState<Task[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [editing, setEditing] = useState<(TaskForm & { id?: string }) | null>(null),
    [removing, setRemoving] = useState<Task | null>(null),
    [history, setHistory] = useState<{ task: Task; runs: TaskRun[] } | null>(
      null,
    ),
    [busy, setBusy] = useState("");
  const notify = useNotify();
  async function load() {
    setLoading(true);
    try {
      const r = await tasksApi.list(page, query, status);
      setItems(r.items);
      setTotal(r.total);
      setError("");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        tasksApi
          .list(page, query, status)
          .then((r) => {
            if (alive) {
              setItems(r.items);
              setTotal(r.total);
              setError("");
            }
          })
          .catch((e) => {
            if (alive) setError(messageOf(e));
          })
          .finally(() => {
            if (alive) setLoading(false);
          }),
      200,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [page, query, status]);
  function create(name = "", prompt = "") {
    setEditing({
      name,
      data: {
        prompt,
        model_id: models[0]?.id || "",
        rrule: scheduleRule("daily", "09:00"),
      },
      is_active: true,
    });
  }
  async function act(task: Task, action: "toggle" | "run" | "runs") {
    setBusy(task.id);
    try {
      if (action === "runs")
        setHistory({ task, runs: await tasksApi.runs(task.id) });
      else {
        await tasksApi[action](task.id);
        notify(
          action === "run"
            ? "Task queued. Check run history for the result."
            : "Schedule updated",
        );
        await load();
      }
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="page library scheduled-page">
      <div className="section-heading">
        <div>
          <h1>Scheduled tasks</h1>
          <p>Run tasks on a schedule or whenever you need them.</p>
        </div>
        <button className="btn primary" onClick={() => create()}>
          <Plus size={16} />
          New task
        </button>
      </div>
      <div className="catalog-filters">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search scheduled tasks"
            placeholder="Search tasks"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          aria-label="Task status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All tasks</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
      </div>
      {error ? (
        <ErrorPanel error={error} retry={load} />
      ) : loading ? (
        <Loading />
      ) : items.length ? (
        <div className="task-list">
          {items.map((t) => (
            <article className="panel task-card" key={t.id}>
              <Clock size={20} />
              <div className="task-copy">
                <h3>{t.name}</h3>
                <p>{t.data.prompt}</p>
                <small>
                  {t.is_active ? scheduleLabel(t.data.rrule) : "Paused"}
                  {t.is_active && t.next_run_at
                    ? ` · Next: ${new Date(t.next_run_at / 1e6).toLocaleString()}`
                    : ""}
                </small>
                {t.last_run?.error && (
                  <p className="danger">Last run: {t.last_run.error}</p>
                )}
              </div>
              <div className="task-actions">
                <button
                  className="icon-btn"
                  aria-label={`Edit ${t.name}`}
                  onClick={() => setEditing(t)}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-btn"
                  disabled={busy === t.id}
                  aria-label={`${t.is_active ? "Pause" : "Resume"} ${t.name}`}
                  onClick={() => void act(t, "toggle")}
                >
                  {t.is_active ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                  className="icon-btn"
                  disabled={busy === t.id}
                  aria-label={`Run ${t.name} now`}
                  onClick={() => void act(t, "run")}
                >
                  <Play size={16} />
                </button>
                <button
                  className="icon-btn"
                  disabled={busy === t.id}
                  aria-label={`History for ${t.name}`}
                  onClick={() => void act(t, "runs")}
                >
                  <History size={16} />
                </button>
                <button
                  className="icon-btn danger"
                  aria-label={`Delete ${t.name}`}
                  onClick={() => setRemoving(t)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="No scheduled tasks yet">
          Create a recurring task to get started.
        </Empty>
      )}
      {total > 30 && (
        <div className="row end">
          <button
            className="btn"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            {page} / {Math.ceil(total / 30)}
          </span>
          <button
            className="btn"
            disabled={page * 30 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
      {!error && (
        <div className="schedule-templates">
          {templates.map(([name, prompt]) => (
            <button
              key={name}
              className="panel project-card"
              onClick={() => create(name, prompt)}
            >
              <Clock size={22} />
              <h3>{name}</h3>
              <p>{prompt}</p>
              <small>Set up a schedule</small>
            </button>
          ))}
        </div>
      )}
      {editing && (
        <TaskEditor
          initial={editing}
          models={models}
          timezone={user.timezone}
          close={() => setEditing(null)}
          saved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {removing && (
        <Confirm
          title="Delete scheduled task"
          description={`Delete “${removing.name}” and its run history?`}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await tasksApi.remove(removing.id);
            await load();
          }}
        />
      )}
      {history && (
        <Modal
          title={`Run history · ${history.task.name}`}
          wide
          onClose={() => setHistory(null)}
        >
          {history.runs.length ? (
            history.runs.map((r) => (
              <div className="settings-row" key={r.id}>
                <strong>{r.status}</strong>
                <small>{new Date(r.created_at / 1e6).toLocaleString()}</small>
                {r.error && <p className="danger">{r.error}</p>}
                {r.chat_id && (
                  <Link className="btn" to={`/c/${r.chat_id}`}>
                    Open result
                  </Link>
                )}
              </div>
            ))
          ) : (
            <Empty title="No runs yet" />
          )}
          <button
            className="btn"
            onClick={() => void act(history.task, "runs")}
          >
            Refresh
          </button>
        </Modal>
      )}
    </div>
  );
}
function TaskEditor({
  initial,
  models,
  timezone,
  close,
  saved,
}: {
  initial: TaskForm & { id?: string };
  models: Model[];
  timezone?: string;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [form, setForm] = useState(initial),
    [frequency, setFrequency] = useState<Frequency>("daily"),
    [time, setTime] = useState("09:00"),
    [day, setDay] = useState("MO"),
    [monthDay, setMonthDay] = useState(1),
    [changeSchedule, setChangeSchedule] = useState(!initial.id),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={initial.id ? "Edit scheduled task" : "Create scheduled task"}
      wide
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await tasksApi.save(
              {
                ...form,
                data: {
                  ...form.data,
                  rrule: changeSchedule
                    ? scheduleRule(frequency, time, day, monthDay)
                    : form.data.rrule,
                },
              },
              initial.id,
            );
            await saved();
          } catch (e) {
            setError(messageOf(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Name
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Instructions
          <textarea
            rows={4}
            required
            value={form.data.prompt}
            onChange={(e) =>
              setForm({
                ...form,
                data: { ...form.data, prompt: e.target.value },
              })
            }
          />
        </label>
        <label>
          Model
          <select
            required
            value={form.data.model_id}
            onChange={(e) =>
              setForm({
                ...form,
                data: { ...form.data, model_id: e.target.value },
              })
            }
          >
            {!models.some((m) => m.id === form.data.model_id) && (
              <option value={form.data.model_id}>
                {form.data.model_id || "Select a model"}
              </option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {initial.id && !changeSchedule ? (
          <div className="settings-row row between">
            <span>{scheduleLabel(form.data.rrule)}</span>
            <button
              className="btn"
              type="button"
              onClick={() => setChangeSchedule(true)}
            >
              Change schedule
            </button>
          </div>
        ) : (
          <div className="form-grid">
            <label>
              Frequency
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
              >
                {["hourly", "daily", "weekdays", "weekly", "monthly"].map(
                  (f) => (
                    <option key={f} value={f}>
                      {f[0].toUpperCase() + f.slice(1)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              {frequency === "hourly" ? "Minute of each hour" : "Time"}
              <input
                required
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            {frequency === "weekly" && (
              <label>
                Day
                <select value={day} onChange={(e) => setDay(e.target.value)}>
                  {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
            )}
            {frequency === "monthly" && (
              <label>
                Day of month
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={monthDay}
                  onChange={(e) => setMonthDay(+e.target.value)}
                />
              </label>
            )}
          </div>
        )}
        <p className="muted small">
          Time zone: {timezone || "server default"}. Runs use your selected
          model and account quota.
        </p>
        <label className="skill-active">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Active
        </label>
        {error && <ErrorPanel error={error} />}
        <div className="row end">
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || !form.data.model_id}
          >
            {busy ? "Saving…" : "Save task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
