import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, request } from "../lib/api";
import {
  preferencesApi,
  downloadText,
  type Preferences,
  type Memory,
} from "../lib/preferences";
import type { User, Chat } from "../lib/types";
import { usagePercent, type UsageWindow } from "../lib/admin-users";
import {
  Confirm,
  Empty,
  ErrorPanel,
  Loading,
  Modal,
  messageOf,
  useNotify,
} from "./UI";
export function SettingsPanel({
  user,
  theme,
  setTheme,
  onUser,
  close,
  billing,
}: {
  user: User | null;
  theme: string;
  setTheme: (value: string) => void;
  onUser: (user: User) => void;
  close: () => void;
  billing: () => void;
}) {
  const [section, setSection] = useState("General"),
    [query, setQuery] = useState(""),
    [prefs, setPrefs] = useState<Preferences | null>(null),
    [name, setName] = useState(user?.name || ""),
    [system, setSystem] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [size, setSize] = useState(
      localStorage.getItem("kividas:text-size") || "medium",
    ),
    [width, setWidth] = useState(
      localStorage.getItem("kividas:transcript-width") || "narrow",
    );
  const notify = useNotify();
  useEffect(() => {
    if (user)
      preferencesApi
        .get()
        .then((p) => {
          setPrefs(p || {});
          setSystem(p?.ui?.system || "");
        })
        .catch((e) => setError(messageOf(e)));
  }, [user?.id]);
  function appearance(key: string, value: string) {
    localStorage.setItem(`kividas:${key}`, value);
    document.documentElement.setAttribute(`data-${key}`, value);
    key === "text-size" ? setSize(value) : setWidth(value);
  }
  async function saveProfile() {
    if (!user || !prefs) return;
    setBusy(true);
    setError("");
    try {
      const updated = await preferencesApi.profile(user, name.trim());
      onUser({ ...user, ...updated });
      setPrefs(
        await preferencesApi.save({ ...prefs, ui: { ...prefs.ui, system } }),
      );
      notify("Profile and instructions saved");
      window.dispatchEvent(new Event("preferences-updated"));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const tabs = [
    "General",
    "Account",
    "Privacy",
    "Billing",
    "Usage",
    "Capabilities",
    "Memory",
    "Kividas Code",
  ];
  return (
    <Modal title="Settings" wide onClose={close}>
      <div className="settings-layout">
        <nav aria-label="Settings">
          <input
            aria-label="Search settings"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {tabs
            .filter((t) => t.toLowerCase().includes(query.toLowerCase()))
            .map((t) => (
              <button
                key={t}
                className={section === t ? "selected" : ""}
                onClick={() => setSection(t)}
              >
                {t}
              </button>
            ))}
          <small>Customize</small>
          {["Skills", "Connectors", "Plugins"].map((t) => (
            <Link key={t} to={`/customize/${t.toLowerCase()}`} onClick={close}>
              {t}
            </Link>
          ))}
        </nav>
        <section className="settings-content">
          <h3>{section}</h3>
          {error && <ErrorPanel error={error} />}
          {section === "General" && (
            <>
              <div className="settings-row">
                <h3>Appearance</h3>
                <div className="segmented">
                  {["light", "dark"].map((t) => (
                    <button
                      key={t}
                      className={theme === t ? "selected" : ""}
                      onClick={() => setTheme(t)}
                    >
                      {t === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <h3>Transcript text size</h3>
                <div className="segmented">
                  {["small", "medium", "large"].map((t) => (
                    <button
                      key={t}
                      className={size === t ? "selected" : ""}
                      onClick={() => appearance("text-size", t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <h3>Transcript width</h3>
                <div className="segmented">
                  {["narrow", "medium", "wide"].map((t) => (
                    <button
                      key={t}
                      className={width === t ? "selected" : ""}
                      onClick={() => appearance("transcript-width", t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <h3>Keyboard shortcuts</h3>
                <p className="muted small">
                  ⌘ / Ctrl K · Search chats
                  <br />⌘ / Ctrl Shift O · New chat
                  <br />
                  Enter · Send message
                  <br />
                  Shift Enter · New line
                </p>
              </div>
            </>
          )}
          {section === "Account" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveProfile();
              }}
            >
              <label>
                Full name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Email
                <input readOnly value={user?.email || ""} />
              </label>
              <label>
                Instructions for Kividas
                <textarea
                  rows={6}
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  placeholder="e.g. Keep explanations brief and to the point"
                />
              </label>
              <p className="muted small">
                Applied to your new messages. Saved to your Kividas account.
              </p>
              <button className="btn primary" disabled={busy || !prefs}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </form>
          )}
          {section === "Privacy" && <Privacy />}
          {section === "Billing" && (
            <div className="settings-row">
              <p>Manage your Kividas subscription and redeem gift cards.</p>
              <button className="btn primary" onClick={billing}>
                View subscription
              </button>
            </div>
          )}
          {section === "Usage" && <Usage />}
          {section === "Memory" && <Memories />}
          {section === "Capabilities" && (
            <>
              <div className="settings-row">
                <h3>Skills and connectors</h3>
                <p className="muted">
                  Choose reusable instructions and available tools in your
                  chat’s + menu.
                </p>
                <Link className="btn" to="/customize/skills" onClick={close}>
                  Open Customize
                </Link>
              </div>
              <div className="settings-row">
                <h3>Artifacts</h3>
                <p className="muted">
                  Browse and download code generated in your conversations.
                </p>
                <Link className="btn" to="/artifacts" onClick={close}>
                  View artifacts
                </Link>
              </div>
              <p className="muted small">
                Available tools depend on your model and workspace permissions.
              </p>
            </>
          )}
          {section === "Kividas Code" && (
            <div className="settings-row">
              <p>Download the desktop application or install the CLI.</p>
              <Link className="btn primary" to="/code" onClick={close}>
                Get Kividas Code
              </Link>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
function Usage() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  function load() {
    api
      .usage()
      .then(setData)
      .catch((e) => setError(messageOf(e)));
  }
  useEffect(load, []);
  return error ? (
    <ErrorPanel error={error} retry={load} />
  ) : !data ? (
    <Loading />
  ) : !data.linked ? (
    <Empty title="Usage is not available for this account" />
  ) : (
    <>
      <h3>Plan usage limits</h3>
      {[
        ["tp5h", "Current session"],
        ["tpw", "Weekly limits"],
        ["tpwFable", "Fable"],
      ].map(([key, name]) => {
        const value = data[key] as UsageWindow | undefined;
        if (!value) return null;
        const percent = usagePercent(value);
        return (
          <div className="settings-row" key={key}>
            <div className="row between">
              <strong>{name}</strong>
              <span>{percent === null ? "Unlimited" : `${percent}% used`}</span>
            </div>
            <progress max={100} value={percent || 0} />
            <small className="muted">
              {value.used.toLocaleString()} /{" "}
              {value.limit > 0 ? value.limit.toLocaleString() : "Unlimited"}{" "}
              tokens
              {value.resetAt
                ? ` · Resets ${new Date(typeof value.resetAt === "number" && value.resetAt < 1e12 ? value.resetAt * 1000 : value.resetAt).toLocaleString()}`
                : ""}
            </small>
          </div>
        );
      })}
      <button className="btn" onClick={load}>
        Refresh usage
      </button>
    </>
  );
}
function Privacy() {
  const [items, setItems] = useState<Chat[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const notify = useNotify();
  return (
    <>
      <div className="settings-row">
        <h3>Export conversations</h3>
        <p className="muted small">
          Download your saved conversations as a JSON file.
        </p>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const chats = await request<Chat[]>("/api/v1/chats/all");
              downloadText(
                "kividas-conversations.json",
                JSON.stringify(chats, null, 2),
                "application/json",
              );
            } catch (e) {
              setError(messageOf(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Export data
        </button>
      </div>
      <div className="settings-row">
        <h3>Archived chats</h3>
        <button
          className="btn"
          onClick={() =>
            api
              .archivedChats()
              .then(setItems)
              .catch((e) => setError(messageOf(e)))
          }
        >
          Manage archived chats
        </button>
        {items?.map((c) => (
          <div className="archived-row" key={c.id}>
            <span>{c.title}</span>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.archiveChat(c.id);
                  setItems(await api.archivedChats());
                  window.dispatchEvent(new Event("chats-updated"));
                  notify("Conversation restored");
                } catch (e) {
                  setError(messageOf(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restore
            </button>
          </div>
        ))}
        {items?.length === 0 && <p className="muted">No archived chats.</p>}
      </div>
      {error && <ErrorPanel error={error} />}
    </>
  );
}
function Memories() {
  const [items, setItems] = useState<Memory[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [edit, setEdit] = useState<Partial<Memory> | null>(null),
    [removing, setRemoving] = useState<Memory | null>(null),
    [busy, setBusy] = useState(false);
  function load() {
    return preferencesApi
      .memories()
      .then(setItems)
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      {error ? (
        <ErrorPanel error={error} />
      ) : loading ? (
        <Loading />
      ) : (
        <>
          <p className="muted">
            Facts you choose to remember. Enable Memory in the chat tools menu
            to use them.
          </p>
          <button className="btn" onClick={() => setEdit({ content: "" })}>
            Add memory
          </button>
          {items.map((m) => (
            <div className="settings-row" key={m.id}>
              <p>{m.content}</p>
              <div className="row">
                <button className="btn" onClick={() => setEdit(m)}>
                  Edit
                </button>
                <button className="btn danger" onClick={() => setRemoving(m)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      {edit && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await preferencesApi.saveMemory(edit.content!, edit.id);
              setEdit(null);
              await load();
            } catch (e) {
              setError(messageOf(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Memory
            <textarea
              required
              rows={4}
              value={edit.content}
              onChange={(e) => setEdit({ ...edit, content: e.target.value })}
            />
          </label>
          <div className="row end">
            <button className="btn" type="button" onClick={() => setEdit(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              Save memory
            </button>
          </div>
        </form>
      )}
      {removing && (
        <Confirm
          title="Delete memory"
          description="Permanently remove this memory?"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await preferencesApi.deleteMemory(removing.id);
            await load();
          }}
        />
      )}
    </>
  );
}
