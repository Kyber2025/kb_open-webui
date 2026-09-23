import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Ban,
  Eye,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, request } from "../lib/api";
import { activeMessages } from "../lib/domain";
import {
  usersApi,
  usagePercent,
  syncWarning,
  type AccessPreview,
  type ManagedUser,
  type UserForm,
  type UserPlan,
} from "../lib/admin-users";
import type { Chat, Message, Tier, User } from "../lib/types";
import {
  Confirm,
  Empty,
  ErrorPanel,
  Loading,
  Modal,
  messageOf,
  useNotify,
} from "../components/UI";
const date = (value?: number | null) =>
  value ? new Date(value * 1000).toLocaleDateString() : "—";
const stamp = (value?: number) =>
  value ? new Date(value * 1000).toLocaleString() : "—";
function Usage({ plan }: { plan?: UserPlan }) {
  if (!plan?.usage) return <span className="muted">—</span>;
  return (
    <div className="user-usage">
      {[
        { key: "5h", value: plan.usage.tp5h },
        { key: "7d", value: plan.usage.tpw },
        ...(plan.usage.tpwFable
          ? [{ key: "Fable", value: plan.usage.tpwFable }]
          : []),
      ].map(({ key, value }) => {
        const percent = usagePercent(value);
        return (
          <div
            key={key}
            title={
              value
                ? `${value.used.toLocaleString()} / ${value.limit > 0 ? value.limit.toLocaleString() : "Unlimited"} tokens`
                : "Unavailable"
            }
          >
            <span>{key}</span>
            <div className="usage-track">
              <i
                style={{
                  width: `${percent ?? 0}%`,
                  background:
                    percent !== null && percent >= 90
                      ? "var(--danger)"
                      : percent !== null && percent >= 70
                        ? "#d5a22e"
                        : "var(--green)",
                }}
              />
            </div>
            <span>{percent === null ? "∞" : `${percent}%`}</span>
          </div>
        );
      })}
    </div>
  );
}
export function Users({ sessionUser }: { sessionUser: User }) {
  const [users, setUsers] = useState<ManagedUser[]>([]),
    [plans, setPlans] = useState<Record<string, UserPlan>>({});
  const [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [query, setQuery] = useState("");
  const [order, setOrder] = useState("created_at"),
    [direction, setDirection] = useState("asc");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [planError, setPlanError] = useState("");
  const [editing, setEditing] = useState<ManagedUser | "new" | null>(null),
    [planUser, setPlanUser] = useState<ManagedUser | null>(null);
  const [previewUser, setPreviewUser] = useState<ManagedUser | null>(null),
    [chatUser, setChatUser] = useState<ManagedUser | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: () => Promise<void>;
  } | null>(null);
  const [banUser, setBanUser] = useState<ManagedUser | null>(null),
    [banReason, setBanReason] = useState(""),
    [busy, setBusy] = useState(false);
  const notify = useNotify(),
    revision = useRef(0);
  async function load() {
    const turn = ++revision.current;
    setLoading(true);
    setError("");
    setPlanError("");
    setPlans({});
    try {
      const result = await usersApi.list(page, query, order, direction);
      if (turn !== revision.current) return;
      setUsers(result.users);
      setTotal(result.total);
      setLoading(false);
      if (result.users.length) {
        try {
          const resultPlans = await usersApi.overview(
            result.users.map((u) => u.id),
          );
          if (turn === revision.current) setPlans(resultPlans.users);
        } catch (e) {
          if (turn === revision.current) setPlanError(messageOf(e));
        }
      }
    } catch (e) {
      if (turn === revision.current) setError(messageOf(e));
    } finally {
      if (turn === revision.current) setLoading(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 300 : 0);
    return () => {
      clearTimeout(timer);
      revision.current++;
    };
  }, [page, query, order, direction]);
  function sort(key: string) {
    if (order === key) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setOrder(key);
      setDirection("asc");
    }
    setPage(1);
  }
  async function ban(e: FormEvent) {
    e.preventDefault();
    if (!banUser) return;
    setBusy(true);
    try {
      await usersApi.ban(banUser.id, !banUser.info?.banned_at, banReason);
      setBanUser(null);
      notify("Account access updated.");
      await load();
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-content users-content">
      <div className="section-heading">
        <div>
          <h2>
            Users <span className="muted user-count">{total}</span>
          </h2>
          <p>Accounts, subscriptions, and usage across your workspace.</p>
        </div>
        <div className="row">
          <button
            className="icon-btn"
            aria-label="Refresh users"
            onClick={() => void load()}
          >
            <RefreshCw size={17} />
          </button>
          <button className="btn primary" onClick={() => setEditing("new")}>
            <Plus size={16} />
            Add user
          </button>
        </div>
      </div>
      <div className="user-search">
        <Search size={17} />
        <input
          aria-label="Search users"
          placeholder="Search users by name or email…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {planError && (
        <ErrorPanel
          error={`Could not load plans and usage: ${planError}`}
          retry={load}
        />
      )}
      {error ? (
        <ErrorPanel error={error} retry={load} />
      ) : loading ? (
        <Loading />
      ) : (
        <>
          <div className="user-table-scroll">
            <table className="users-table">
              <thead>
                <tr>
                  {[
                    { key: "role", name: "Role" },
                    { key: "name", name: "Name" },
                    { key: "email", name: "Email" },
                  ].map((h) => (
                    <th key={h.key}>
                      <button onClick={() => sort(h.key)}>
                        {h.name}
                        {order === h.key && (direction === "asc" ? " ↑" : " ↓")}
                      </button>
                    </th>
                  ))}
                  <th>Plan</th>
                  <th>Usage (5h / week)</th>
                  <th>
                    <button onClick={() => sort("last_active_at")}>
                      Last active
                    </button>
                  </th>
                  <th>
                    <button onClick={() => sort("created_at")}>
                      Created at{" "}
                      {order === "created_at" &&
                        (direction === "asc" ? "↑" : "↓")}
                    </button>
                  </th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <button
                        className={`role-badge ${u.role}`}
                        title="Edit user role"
                        onClick={() => setEditing(u)}
                      >
                        {u.info?.banned_at ? "Banned" : u.role}
                      </button>
                    </td>
                    <td>
                      <div className="user-name">
                        <span className="avatar">
                          {u.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span>{u.name}</span>
                      </div>
                    </td>
                    <td className="user-email">{u.email}</td>
                    <td>
                      <button
                        className="user-plan"
                        aria-label={`Manage plan for ${u.name}`}
                        onClick={() => setPlanUser(u)}
                      >
                        <span>{plans[u.id]?.tier?.name || "—"}</span>
                        {plans[u.id]?.expires_at && (
                          <small>{date(plans[u.id].expires_at)}</small>
                        )}
                      </button>
                    </td>
                    <td>
                      <Usage plan={plans[u.id]} />
                    </td>
                    <td title={stamp(u.last_active_at)}>
                      {stamp(u.last_active_at)}
                    </td>
                    <td>{date(u.created_at)}</td>
                    <td>
                      <div className="user-actions">
                        {u.role !== "admin" && (
                          <>
                            <button
                              className="icon-btn"
                              aria-label={`Chats for ${u.name}`}
                              title="Chats"
                              onClick={() => setChatUser(u)}
                            >
                              <MessageSquare size={16} />
                            </button>
                            <button
                              className="icon-btn"
                              aria-label={`Preview access for ${u.name}`}
                              title="Preview access"
                              onClick={() => setPreviewUser(u)}
                            >
                              <Eye size={16} />
                            </button>
                          </>
                        )}
                        <button
                          className="icon-btn"
                          aria-label={`Edit ${u.name}`}
                          title="Edit user"
                          onClick={() => setEditing(u)}
                        >
                          <Pencil size={16} />
                        </button>
                        {u.role !== "admin" && u.id !== sessionUser.id && (
                          <>
                            <button
                              className="icon-btn danger"
                              aria-label={`${u.info?.banned_at ? "Unban" : "Ban"} ${u.name}`}
                              title={
                                u.info?.banned_at ? "Unban user" : "Ban user"
                              }
                              onClick={() => {
                                setBanUser(u);
                                setBanReason("");
                              }}
                            >
                              <Ban size={16} />
                            </button>
                            <button
                              className="icon-btn"
                              aria-label={`Delete ${u.name}`}
                              title="Delete user"
                              onClick={() =>
                                setConfirm({
                                  title: "Delete user",
                                  description: `Permanently delete ${u.email} and their account data? This cannot be undone.`,
                                  action: async () => {
                                    await usersApi.remove(u.id);
                                    setConfirm(null);
                                    notify("User deleted.");
                                    await load();
                                  },
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!users.length && <Empty title="No matching users" />}
          <div className="user-pagination">
            <span>
              {total} users · Page {page}
            </span>
            <div className="row">
              <button
                className="btn"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <button
                className="btn"
                disabled={users.length === 0 || page * 30 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
      {editing && (
        <UserEditor
          user={editing}
          self={sessionUser.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {planUser && (
        <PlanEditor
          user={planUser}
          initial={plans[planUser.id]}
          onClose={() => setPlanUser(null)}
          onUpdated={(result) =>
            setPlans((p) => ({ ...p, [planUser.id]: result }))
          }
        />
      )}
      {previewUser && (
        <UserResources
          user={previewUser}
          onClose={() => setPreviewUser(null)}
        />
      )}
      {chatUser && (
        <UserChats user={chatUser} onClose={() => setChatUser(null)} />
      )}
      {confirm && (
        <Confirm
          title={confirm.title}
          description={confirm.description}
          onConfirm={confirm.action}
          onClose={() => setConfirm(null)}
        />
      )}
      {banUser && (
        <Modal
          title={banUser.info?.banned_at ? "Unban user" : "Ban user"}
          onClose={() => {
            if (!busy) setBanUser(null);
          }}
        >
          <form onSubmit={ban}>
            <p>
              {banUser.info?.banned_at
                ? `Restore access for ${banUser.email}?`
                : `Suspend ${banUser.email} across chat, API access and desktop apps?`}
            </p>
            {!banUser.info?.banned_at && (
              <label className="field">
                Reason (optional)
                <textarea
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                />
              </label>
            )}
            <div className="row end">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setBanUser(null)}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={busy}>
                {busy ? "Saving…" : "Confirm"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
function UserEditor({
  user,
  self,
  onClose,
  onSaved,
}: {
  user: ManagedUser | "new";
  self: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fresh = user === "new";
  const [form, setForm] = useState<UserForm>(
    fresh
      ? {
          name: "",
          email: "",
          role: "user",
          password: "",
          profile_image_url: "/user.png",
        }
      : {
          name: user.name,
          email: user.email,
          role: user.role,
          password: "",
          profile_image_url: user.profile_image_url,
        },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirmRole, setConfirmRole] = useState(false);
  const notify = useNotify();
  async function save() {
    setBusy(true);
    setError("");
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      fresh
        ? await usersApi.add(payload)
        : await usersApi.update(user.id, payload);
      notify(fresh ? "User created." : "User updated.");
      onSaved();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      setConfirmRole(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (form.role === "admin" && (fresh || user.role !== "admin"))
      setConfirmRole(true);
    else void save();
  }
  return (
    <Modal
      title={fresh ? "Add user" : `Edit ${user.name}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="user-editor">
        {error && <ErrorPanel error={error} />}
        <label className="field">
          Name
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="field">
          Email
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label className="field">
          Role
          <select
            disabled={!fresh && (user.id === self || !!user.info?.banned_at)}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="user">User</option>
            <option value="pending">Pending</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="field">
          {fresh ? "Password" : "New password (leave empty to keep current)"}
          <input
            autoComplete="new-password"
            type="password"
            required={fresh}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        <label className="field">
          Profile image URL
          <input
            value={form.profile_image_url || ""}
            onChange={(e) =>
              setForm({ ...form, profile_image_url: e.target.value })
            }
          />
        </label>
        {confirmRole ? (
          <div className="role-confirm" role="alert">
            <p>
              Admin can manage users, subscriptions, gift cards and guest
              access. Grant this role to {form.email}?
            </p>
            <button
              className="btn"
              type="button"
              onClick={() => setConfirmRole(false)}
            >
              Cancel
            </button>{" "}
            <button
              className="btn primary"
              type="button"
              disabled={busy}
              onClick={() => void save()}
            >
              Confirm admin access
            </button>
          </div>
        ) : (
          <div className="row end">
            <button
              type="button"
              className="btn"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? "Saving…" : "Save user"}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
function localDate(value: number) {
  const d = new Date(value * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function PlanEditor({
  user,
  initial,
  onClose,
  onUpdated,
}: {
  user: ManagedUser;
  initial?: UserPlan;
  onClose: () => void;
  onUpdated: (result: UserPlan) => void;
}) {
  const [plan, setPlan] = useState<UserPlan | undefined>(initial),
    [tiers, setTiers] = useState<Tier[]>([]),
    [tier, setTier] = useState(initial?.tier?.id || "free"),
    [expiry, setExpiry] = useState(
      initial?.expires_at ? localDate(initial.expires_at) : "",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: () => Promise<void>;
  } | null>(null);
  const notify = useNotify();
  useEffect(() => {
    void Promise.all([api.tiers(), usersApi.overview([user.id])])
      .then(([all, result]) => {
        setTiers(all);
        const p = result.users[user.id];
        setPlan(p);
        setTier(p?.tier?.id || "free");
        setExpiry(p?.expires_at ? localDate(p.expires_at) : "");
      })
      .catch((e) => setError(messageOf(e)));
  }, [user.id]);
  async function update(action: () => Promise<UserPlan>) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      setPlan(result);
      onUpdated(result);
      const warning = syncWarning(result);
      if (warning) setError(warning);
      else notify("User subscription and usage updated.");
      setTier(result.tier?.id || "free");
      setExpiry(result.expires_at ? localDate(result.expires_at) : "");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }
  return (
    <Modal
      title={`Subscription · ${user.name}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted">{user.email}</p>
      {error && <ErrorPanel error={error} />}
      <form
        className="user-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void update(() =>
            usersApi.setPlan(user.id, {
              tier_id: tier,
              ...(tier !== "free" && expiry
                ? { expires_at: Math.floor(new Date(expiry).getTime() / 1000) }
                : {}),
            }),
          );
        }}
      >
        <label className="field">
          Plan
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            {tiers
              .filter((t) => t.enabled)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        {tier !== "free" && (
          <label className="field">
            Expires at (optional)
            <input
              type="datetime-local"
              value={expiry}
              min={localDate(Math.floor(Date.now() / 1000))}
              onChange={(e) => setExpiry(e.target.value)}
            />
            <small className="muted">
              Leave empty to grant the plan’s standard duration from now.
            </small>
          </label>
        )}
        <div className="row between">
          <button
            type="button"
            className="btn"
            disabled={busy || !plan?.expires_at}
            onClick={() =>
              setConfirm({
                title: "Revoke subscription",
                description: `Return ${user.email} to the free plan immediately?`,
                action: () => update(() => usersApi.revoke(user.id)),
              })
            }
          >
            Revoke subscription
          </button>
          <button className="btn primary" disabled={busy || !tiers.length}>
            {busy ? "Saving…" : "Save subscription"}
          </button>
        </div>
      </form>
      <hr />
      <h3>Usage windows</h3>
      <Usage plan={plan} />
      {plan?.usage && (
        <div className="usage-details">
          {[
            { key: "5h", name: "5-hour", w: plan.usage.tp5h },
            { key: "week", name: "Weekly", w: plan.usage.tpw },
            ...(plan.usage.tpwFable
              ? [{ key: "fable", name: "Fable weekly", w: plan.usage.tpwFable }]
              : []),
          ].map(({ key, name, w }) => (
            <div key={key}>
              <span>
                {name}: {w?.used.toLocaleString() || 0} /{" "}
                {w?.limit ? w.limit.toLocaleString() : "Unlimited"}
                {w?.resetAt && (
                  <small>Resets {new Date(w.resetAt).toLocaleString()}</small>
                )}
              </span>
              <button
                className="btn"
                disabled={busy || !plan.kyber_linked}
                onClick={() =>
                  setConfirm({
                    title: `Reset ${name} usage`,
                    description: `Clear this usage window for ${user.email}?`,
                    action: () => update(() => usersApi.reset(user.id, [key])),
                  })
                }
              >
                Reset
              </button>
            </div>
          ))}
        </div>
      )}
      {!plan?.usage && (
        <p className="muted">
          Usage is unavailable or this user is not linked to a wallet.
        </p>
      )}
      {confirm && (
        <Confirm
          {...confirm}
          onConfirm={confirm.action}
          onClose={() => setConfirm(null)}
        />
      )}
    </Modal>
  );
}
function UserResources({
  user,
  onClose,
}: {
  user: ManagedUser;
  onClose: () => void;
}) {
  const [data, setData] = useState<AccessPreview | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    usersApi
      .preview(user.id)
      .then(setData)
      .catch((e) => setError(messageOf(e)));
  }, [user.id]);
  return (
    <Modal title={`Access · ${user.name}`} onClose={onClose}>
      {error ? (
        <ErrorPanel error={error} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <h3>Groups</h3>
          <p>{data.groups.map((g) => g.name).join(", ") || "No groups"}</p>
          {(["models", "knowledge", "tools"] as const).map((key) => (
            <section key={key}>
              <h3 className="capitalize">
                {key} · {data[key].items.length} / {data[key].total}
              </h3>
              {data[key].items.length ? (
                <ul>
                  {data[key].items.map((item) => (
                    <li key={item.id}>{item.name}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No accessible resources.</p>
              )}
            </section>
          ))}
        </>
      )}
    </Modal>
  );
}
function UserChats({
  user,
  onClose,
}: {
  user: ManagedUser;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Chat[]>([]),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [selected, setSelected] = useState<{
      title: string;
      messages: Message[];
    } | null>(null),
    [remove, setRemove] = useState<Chat | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(
      () => {
        usersApi
          .chats(user.id, page, query)
          .then((data) => {
            if (alive) {
              setItems((old) => (page === 1 ? data : [...old, ...data]));
              setDone(!data.length);
            }
          })
          .catch((e) => {
            if (alive) setError(messageOf(e));
          })
          .finally(() => {
            if (alive) setLoading(false);
          });
      },
      query ? 300 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [user.id, page, query]);
  async function open(c: Chat) {
    const turn = ++revision.current;
    setError("");
    try {
      const result = await api.chat(c.id);
      if (turn === revision.current && result.chat)
        setSelected({ title: c.title, messages: activeMessages(result.chat) });
    } catch (e) {
      setError(messageOf(e));
    }
  }
  return (
    <Modal title={`${user.name}’s chats`} wide onClose={onClose}>
      {error && <ErrorPanel error={error} />}
      <input
        aria-label="Search user chats"
        placeholder="Search conversations…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
        }}
      />
      {selected ? (
        <>
          <button className="btn" onClick={() => setSelected(null)}>
            Back to chats
          </button>
          <h3>{selected.title}</h3>
          <div className="admin-chat-transcript">
            {selected.messages.map((m, i) => (
              <article key={m.id || i}>
                <strong>{m.role}</strong>
                <p>{m.content}</p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="admin-chat-list">
            {items.map((c) => (
              <div key={c.id}>
                <button onClick={() => void open(c)}>{c.title}</button>
                <button
                  className="icon-btn"
                  aria-label={`Delete chat ${c.title}`}
                  onClick={() => setRemove(c)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          {loading ? (
            <Loading />
          ) : !items.length ? (
            <Empty title="No chats found" />
          ) : (
            !done && (
              <button className="btn" onClick={() => setPage((p) => p + 1)}>
                Load more
              </button>
            )
          )}
        </>
      )}
      {remove && (
        <Confirm
          title="Delete conversation"
          description={`Permanently delete “${remove.title}”?`}
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await request(`/api/v1/chats/${encodeURIComponent(remove.id)}`, {
              method: "DELETE",
            });
            setItems(items.filter((c) => c.id !== remove.id));
            setRemove(null);
          }}
        />
      )}
    </Modal>
  );
}
