import { Marketplace } from "./Marketplace";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpDown,
  BookOpen,
  ChevronDown,
  FileText,
  Pencil,
  Plug,
  Plus,
  Puzzle,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { downloadText } from "../lib/preferences";
import type { User } from "../lib/types";
import {
  skillsApi,
  skillTemplates,
  skillForm,
  type Skill,
  type SkillForm,
  type Capability,
} from "../lib/skills";
import {
  Confirm,
  Empty,
  ErrorPanel,
  Loading,
  Modal,
  messageOf,
  useNotify,
} from "../components/UI";

export function Customize({ user }: { user: User }) {
  const { section = "skills" } = useParams();
  const [view, setView] = useState<"yours" | "discover">("discover"),
    [query, setQuery] = useState(""),
    [activeOnly, setActiveOnly] = useState(false),
    [sort, setSort] = useState(false),
    [addMenu, setAddMenu] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [canCreate, setCanCreate] = useState(user.role === "admin");
  const [editing, setEditing] = useState<{
      form: SkillForm;
      existing?: Skill;
    } | null>(null),
    [detail, setDetail] = useState<Skill | null>(null),
    [removing, setRemoving] = useState<Skill | null>(null),
    [pending, setPending] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const notify = useNotify(),
    navigate = useNavigate();
  async function load() {
    setLoading(true);
    setError("");
    try {
      setSkills(await skillsApi.all());
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    if (user.role !== "admin")
      skillsApi
        .permissions()
        .then((p) => setCanCreate(p.workspace?.skills === true))
        .catch(() => setCanCreate(false));
  }, [user.id]);
  useEffect(() => {
    setQuery("");
    setAddMenu(false);
  }, [section]);
  const mine = skills.filter((s) => s.user_id === user.id),
    shared = skills.filter((s) => s.user_id !== user.id);
  const matches = (s: { name: string; description?: string | null }) =>
    `${s.name} ${s.description || ""}`
      .toLowerCase()
      .includes(query.toLowerCase());
  const visible = (view === "yours" ? mine : shared)
    .filter(matches)
    .filter((s) => !activeOnly || s.is_active)
    .sort((a, b) =>
      sort
        ? a.name.localeCompare(b.name)
        : (b.updated_at || 0) - (a.updated_at || 0),
    );
  const templates = skillTemplates.filter(matches);
  const writable = (s: Skill) =>
    s.user_id === user.id || s.write_access === true;
  async function open(s: Skill) {
    setPending(s.id);
    try {
      setDetail(await skillsApi.get(s.id));
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      setPending("");
    }
  }
  async function edit(s: Skill) {
    setPending(s.id);
    try {
      const full = await skillsApi.get(s.id);
      setDetail(null);
      setEditing({ form: skillForm(full), existing: full });
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      setPending("");
    }
  }
  async function toggle(s: Skill) {
    setPending(s.id);
    try {
      const updated = await skillsApi.toggle(s.id);
      setSkills((all) =>
        all.map((x) => (x.id === s.id ? { ...x, ...updated } : x)),
      );
      setDetail((old) => (old?.id === s.id ? { ...old, ...updated } : old));
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      setPending("");
    }
  }
  function useSkill(s: Skill) {
    navigate(`/?new=${Date.now()}&skill=${encodeURIComponent(s.id)}`);
  }
  function templateForm(t: SkillForm) {
    return {
      ...t,
      id: `${t.id}-${crypto.randomUUID().slice(0, 8)}`,
      access_grants: [],
    };
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    setAddMenu(false);
    try {
      if (file.size > 1024 * 1024)
        throw new Error("Choose a Markdown file smaller than 1 MB.");
      const content = await file.text();
      const name = file.name.replace(/\.md$/i, "");
      setEditing({
        form: {
          id: `skill-${crypto.randomUUID().slice(0, 8)}`,
          name,
          description: "",
          content,
          meta: { tags: [] },
          is_active: true,
          access_grants: [],
        },
      });
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      if (input.current) input.current.value = "";
    }
  }
  const card = (s: Skill) => (
    <article className="skill-card" key={s.id}>
      <button
        className="skill-card-main"
        onClick={() => void open(s)}
        disabled={pending === s.id}
      >
        <span className="skill-card-icon">
          <FileText size={23} />
        </span>
        <span>
          <strong>{s.name}</strong>
          <span className="skill-description">
            {s.description || "Reusable instructions for your conversations."}
          </span>
          <small>
            {s.user_id === user.id
              ? "Created by you"
              : `by ${s.user?.name || "your workspace"}`}
            {!s.is_active && " · Disabled"}
          </small>
        </span>
      </button>
      <button
        className="skill-card-action"
        title={s.is_active ? "Use in chat" : "View skill"}
        aria-label={`${s.is_active ? "Use" : "View"} ${s.name}`}
        onClick={() => (s.is_active ? useSkill(s) : void open(s))}
      >
        {s.is_active ? <ArrowRight size={17} /> : <FileText size={17} />}
      </button>
    </article>
  );
  if (section === "connectors" || section === "plugins") return <Marketplace section={section} user={user}/>;
  return (
    <div className="page customize-page">
      <h1>Customize</h1>
      <div className="customize-toolbar">
        <nav className="customize-tabs" aria-label="Customize">
          <NavLink to="/customize/skills">Skills</NavLink>
          <NavLink to="/customize/connectors">Connectors</NavLink>
          <NavLink to="/customize/plugins">Plugins</NavLink>
        </nav>
        {section === "skills" && (
          <>
            <span className="toolbar-divider" />
            <div className="segmented skill-views">
              <button
                className={view === "yours" ? "selected" : ""}
                onClick={() => setView("yours")}
              >
                Yours <span>{mine.length}</span>
              </button>
              <button
                className={view === "discover" ? "selected" : ""}
                onClick={() => setView("discover")}
              >
                Discover
              </button>
            </div>
          </>
        )}
        <div className="customize-controls">
          <div className="skills-search">
            <Search size={16} />
            <input
              aria-label="Search skills and plugins"
              placeholder="Search skills and plugins"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {section === "skills" && (
            <>
              <button
                className={`icon-btn ${activeOnly ? "selected" : ""}`}
                aria-label="Show only enabled skills"
                aria-pressed={activeOnly}
                onClick={() => setActiveOnly((v) => !v)}
              >
                <SlidersHorizontal size={17} />
              </button>
              <button
                className="icon-btn"
                aria-label="Sort skills by name"
                aria-pressed={sort}
                onClick={() => setSort((v) => !v)}
              >
                <ArrowUpDown size={17} />
              </button>
              {canCreate && (
                <div className="popover-anchor">
                  <button
                    className="btn primary skill-add"
                    aria-expanded={addMenu}
                    onClick={() => setAddMenu((v) => !v)}
                  >
                    <Plus size={17} />
                    Add
                    <ChevronDown size={13} />
                  </button>
                  {addMenu && (
                    <>
                      <button
                        className="dismiss-layer"
                        aria-label="Close add menu"
                        onClick={() => setAddMenu(false)}
                      />
                      <div className="popover skill-add-menu">
                        <button
                          onClick={() => {
                            setAddMenu(false);
                            setEditing({
                              form: {
                                id: `skill-${crypto.randomUUID().slice(0, 8)}`,
                                name: "",
                                description: "",
                                content: "",
                                meta: { tags: [] },
                                is_active: true,
                                access_grants: [],
                              },
                            });
                          }}
                        >
                          <Pencil size={16} />
                          Create skill
                        </button>
                        <button onClick={() => input.current?.click()}>
                          <Upload size={16} />
                          Upload skill (.md)
                        </button>
                        <button
                          onClick={() =>
                            navigate(
                              "/?new=" +
                                Date.now() +
                                "&prompt=" +
                                encodeURIComponent(
                                  "Help me create a reusable skill. Ask about the workflow, then draft a SKILL.md file with a name, description and clear instructions.",
                                ),
                            )
                          }
                        >
                          <Pencil size={16} />
                          Create with Kividas
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept=".md,text/markdown,text/plain"
        hidden
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {section !== "skills" ? (
        <CapabilityCatalog
          section={section === "connectors" ? "connectors" : "plugins"}
          query={query}
        />
      ) : (
        <>
          {error && <ErrorPanel error={error} retry={load} />}
          {view === "discover" && !query && (
            <section className="skills-feature">
              <div>
                <small>From Kividas</small>
                <h2>Data</h2>
                <p>
                  Query, chart and explain your data — SQL, spreadsheets and
                  dashboards in one place.
                </p>
                <button
                  className="btn primary"
                  onClick={() =>
                    setEditing({ form: templateForm(skillTemplates[0]) })
                  }
                  disabled={!canCreate}
                >
                  Add
                </button>
              </div>
              <svg viewBox="0 0 160 140" fill="none" aria-hidden="true">
                <path
                  d="M18 23h102v86H18zM18 45h102M18 67h102M18 89h102M43 23v86M69 23v86M94 23v86"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinejoin="round"
                />
                <circle
                  cx="115"
                  cy="100"
                  r="30"
                  fill="#bbd1c7"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  d="m98 106 11-13 10 9 13-15m-13 0h13v13"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </section>
          )}
          {view === "discover" && (
            <>
              <div className="skill-section-heading">
                <h2>Explore skills</h2>
                <span className="muted small">Templates from Kividas</span>
              </div>
              <div className="skill-grid">
                {(sort
                  ? [...templates].sort((a, b) => a.name.localeCompare(b.name))
                  : templates
                ).map((t) => (
                  <article className="skill-card" key={t.id}>
                    <button
                      className="skill-card-main"
                      onClick={() => setEditing({ form: templateForm(t) })}
                    >
                      <span className="skill-card-icon">
                        <BookOpen size={23} />
                      </span>
                      <span>
                        <strong>{t.name}</strong>
                        <span className="skill-description">
                          {t.description}
                        </span>
                        <small>by Kividas</small>
                      </span>
                    </button>
                    <button
                      className="skill-card-action"
                      aria-label={`Add ${t.name}`}
                      disabled={!canCreate}
                      onClick={() => setEditing({ form: templateForm(t) })}
                    >
                      <Plus size={17} />
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
          <div className="skill-section-heading">
            <h2>{view === "yours" ? "Your skills" : "Shared with you"}</h2>
            {view === "yours" && (
              <span className="muted small">
                Choose a skill to use it in a chat.
              </span>
            )}
          </div>
          {loading ? (
            <Loading />
          ) : visible.length ? (
            <div className="skill-grid">{visible.map(card)}</div>
          ) : (
            <Empty
              title={
                query
                  ? "No matching skills"
                  : view === "yours"
                    ? "Make it yours"
                    : "No shared skills yet"
              }
            >
              {view === "yours"
                ? "Create a skill or add a template from Discover."
                : "Skills shared by your workspace will appear here."}
            </Empty>
          )}
          {!canCreate && (
            <p className="muted small">
              Your account can use shared skills. Creating skills requires
              workspace permission.
            </p>
          )}
        </>
      )}
      {editing && (
        <SkillEditor
          form={editing.form}
          existing={editing.existing}
          canSave={editing.existing ? writable(editing.existing) : canCreate}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setView("yours");
            await load();
          }}
        />
      )}
      {detail && (
        <Modal title={detail.name} wide onClose={() => setDetail(null)}>
          <p className="muted">{detail.description}</p>
          <pre className="skill-instructions">{detail.content}</pre>
          <div className="skill-detail-actions">
            <button
              className="btn"
              onClick={() =>
                downloadText(
                  `${detail.name.replace(/[^a-zA-Z0-9_-]/g, "-")}.md`,
                  detail.content || "",
                  "text/markdown",
                )
              }
            >
              Download SKILL.md
            </button>
            {writable(detail) && (
              <>
                <button
                  className="btn"
                  disabled={pending === detail.id}
                  onClick={() => void edit(detail)}
                >
                  <Pencil size={15} />
                  Edit
                </button>
                <button
                  className="btn"
                  disabled={pending === detail.id}
                  onClick={() => void toggle(detail)}
                >
                  {detail.is_active ? "Disable" : "Enable"}
                </button>
                <button
                  className="icon-btn danger"
                  aria-label="Delete skill"
                  onClick={() => setRemoving(detail)}
                >
                  <Trash2 size={17} />
                </button>
              </>
            )}
            <button
              className="btn primary"
              disabled={!detail.is_active}
              onClick={() => useSkill(detail)}
            >
              Use in chat
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {removing && (
        <Confirm
          title="Delete skill"
          description={`Permanently delete “${removing.name}”?`}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await skillsApi.remove(removing.id);
            setRemoving(null);
            setDetail(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
function SkillEditor({
  form: initial,
  existing,
  canSave,
  onClose,
  onSaved,
}: {
  form: SkillForm;
  existing?: Skill;
  canSave: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      existing
        ? await skillsApi.update(existing.id, form)
        : await skillsApi.create(form);
      await onSaved();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={existing ? "Edit skill" : "Add skill"}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="skill-editor" onSubmit={save}>
        {error && <ErrorPanel error={error} />}
        <label>
          Name
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Description
          <input
            required
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label>
          Instructions
          <textarea
            required
            rows={10}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </label>
        <label className="skill-active">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          Enabled
        </label>
        <div className="row between">
          <span className="muted small">
            {existing
              ? "Existing sharing permissions are preserved."
              : "Saved privately to your account."}
          </span>
          <button className="btn primary" disabled={busy || !canSave}>
            {busy ? "Saving…" : existing ? "Save changes" : "Add skill"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CapabilityCatalog({
  section,
  query,
}: {
  section: "connectors" | "plugins";
  query: string;
}) {
  const [items, setItems] = useState<Capability[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    skillsApi[section]()
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((e) => {
        if (active) setError(messageOf(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [section]);
  const shown = items.filter((i) =>
    `${i.name} ${i.meta?.description || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const Icon = section === "connectors" ? Plug : Puzzle;
  const navigate = useNavigate();
  return (
    <>
      <p className="muted capability-intro">
        {section === "connectors"
          ? "Tools and connections available in your Kividas workspace."
          : "Extensions installed on your Kividas server."}
      </p>
      {error ? (
        <ErrorPanel error={error} />
      ) : loading ? (
        <Loading />
      ) : shown.length ? (
        <div className="skill-grid">
          {shown.map((item) => (
            <article key={item.id} className="skill-card capability-card">
              <span className="skill-card-icon">
                <Icon size={23} />
              </span>
              <div>
                <strong>{item.name}</strong>
                <p>
                  {item.meta?.description ||
                    item.type ||
                    "Workspace integration"}
                </p>
                <small>
                  {item.is_active === false
                    ? "Disabled"
                    : item.is_global
                      ? "Enabled for all chats"
                      : "Available"}
                </small>
                {section === "connectors" && (
                  <button
                    className="btn"
                    onClick={() =>
                      navigate(
                        `/?new=${Date.now()}&tool=${encodeURIComponent(item.id)}`,
                      )
                    }
                  >
                    Use in chat
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty title={query ? "No matches" : `No ${section} installed`}>
          Your workspace’s configured {section} will appear here.
        </Empty>
      )}
      <p className="muted small">
        Connections and server extensions are configured by your workspace
        administrator.
      </p>
    </>
  );
}
