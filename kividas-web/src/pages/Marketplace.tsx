import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  Plug,
  Puzzle,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import type { User } from "../lib/types";
import { skillsApi, type Skill, type Capability } from "../lib/skills";
import {
  connectorDirectory,
  loadPlugins,
  loadPlugin,
  ownedPluginSkills,
  installPlugin,
  componentTag,
  pluginTag,
  connectorsApi,
  newConnection,
  authorizationPath,
  type DirectoryConnector,
  type PluginEntry,
  type PluginBundle,
} from "../lib/marketplace";
import {
  Confirm,
  Empty,
  ErrorPanel,
  Loading,
  Modal,
  messageOf,
  useNotify,
} from "../components/UI";
const collections = [
  {
    name: "Kividas for design",
    description: "Bring your ideas, designs and creative tools together.",
    category: "design",
    color: "design",
  },
  {
    name: "Kividas for work",
    description: "Find context, organize projects and keep your day moving.",
    category: "productivity",
    color: "work",
  },
  {
    name: "Kividas for data",
    description: "Explore data, ask better questions and explain your results.",
    category: "data",
    color: "data",
  },
];
export function Marketplace({
  section,
  user,
}: {
  section: "connectors" | "plugins";
  user: User;
}) {
  const navigate = useNavigate(),
    notify = useNotify();
  const [view, setView] = useState<"yours" | "discover">("discover"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [filter, setFilter] = useState(false),
    [sort, setSort] = useState(false),
    [add, setAdd] = useState(false),
    [slide, setSlide] = useState(0),
    [all, setAll] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [tools, setTools] = useState<Capability[]>([]),
    [skills, setSkills] = useState<Skill[]>([]),
    [catalog, setCatalog] = useState<PluginEntry[]>([]),
    [extensions, setExtensions] = useState<Capability[]>([]),
    [canInstall, setCanInstall] = useState(user.role === "admin"),
    [plugin, setPlugin] = useState<PluginBundle | null>(null),
    [connector, setConnector] = useState<DirectoryConnector | null>(null),
    [addingConnector, setAddingConnector] = useState<
      DirectoryConnector | null | false
    >(false),
    [detailError, setDetailError] = useState(""),
    [opening, setOpening] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      if (section === "connectors") setTools(await skillsApi.connectors());
      else {
        const [p, s] = await Promise.all([loadPlugins(), skillsApi.all()]);
        const customIds = [
          ...new Set(
            s
              .filter((x) => x.user_id === user.id)
              .flatMap((x) =>
                (x.meta?.tags || [])
                  .filter((t) => t.startsWith("kividas-plugin:"))
                  .map((t) => t.slice("kividas-plugin:".length)),
              ),
          ),
        ].filter((id) => !p.some((x) => x.id === id));
        const custom = customIds.map((id) => {
          const own = ownedPluginSkills(s, user.id, id),
            tags = own[0].meta?.tags || [];
          return {
            id,
            name:
              tags
                .find((t) => t.startsWith("kividas-plugin-name:"))
                ?.slice("kividas-plugin-name:".length) || "Imported plugin",
            description:
              tags
                .find((t) => t.startsWith("kividas-plugin-description:"))
                ?.slice("kividas-plugin-description:".length) ||
              "Imported instructions",
            author: "You",
            version: "1.0",
            category: "productivity",
            skillCount: own.length,
            source: "",
            revision: "local",
            connectors: [],
            hasScripts: false,
          };
        });
        setCatalog([...p, ...custom]);
        setSkills(s);
        skillsApi
          .plugins()
          .then(setExtensions)
          .catch(() => setExtensions([]));
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setView("discover");
    setQuery("");
    setCategory("");
    setAll(false);
    setAdd(false);
    setPlugin(null);
    setConnector(null);
    void refresh();
  }, [section, user.id]);
  useEffect(() => {
    if (user.role !== "admin")
      skillsApi
        .permissions()
        .then((p) => setCanInstall(p.workspace?.skills === true))
        .catch(() => setCanInstall(false));
  }, [user.id, user.role]);
  const installed = catalog.filter(
    (p) => ownedPluginSkills(skills, user.id, p.id).length > 0,
  );
  const count = section === "plugins" ? installed.length : tools.length;
  const filterText = (name: string, description: string) =>
    `${name} ${description}`.toLowerCase().includes(query.toLowerCase());
  const plugins = (view === "yours" ? installed : catalog)
    .filter(
      (p) =>
        (!category || p.category === category) &&
        filterText(p.name, p.description),
    )
    .sort((a, b) => (sort ? a.name.localeCompare(b.name) : 0));
  const connectors = connectorDirectory
    .filter(
      (c) =>
        (!category || c.category === category) &&
        filterText(c.name, c.description),
    )
    .sort((a, b) => (sort ? a.name.localeCompare(b.name) : 0));
  async function openPlugin(p: PluginEntry) {
    setOpening(p.id);
    setDetailError("");
    try {
      if (p.source) setPlugin(await loadPlugin(p.id));
      else {
        const full = await Promise.all(
          ownedPluginSkills(skills, user.id, p.id).map((s) =>
            skillsApi.get(s.id),
          ),
        );
        setPlugin({
          ...p,
          skills: full.map((s) => ({
            id:
              s.meta?.tags
                ?.find((t) => t.startsWith("kividas-plugin-skill:"))
                ?.slice("kividas-plugin-skill:".length) || s.id,
            name: s.name,
            description: s.description || "",
            content: s.content || "",
          })),
        });
      }
    } catch (e) {
      setDetailError(messageOf(e));
    } finally {
      setOpening("");
    }
  }
  const connectorCard = (c: DirectoryConnector) => (
    <article className="directory-card" key={c.id}>
      <button className="directory-card-main" onClick={() => setConnector(c)}>
        <span className="connector-logo" style={{ color: c.color }}>
          {c.mark}
        </span>
        <span>
          <strong>{c.name}</strong>
          <span className="skill-description">{c.description}</span>
          <small>by {c.author}</small>
        </span>
      </button>
      <button
        className="skill-card-action"
        aria-label={`Add ${c.name}`}
        onClick={() => setConnector(c)}
      >
        <Plus size={17} />
      </button>
    </article>
  );
  const pluginCard = (p: PluginEntry) => {
    const mine = ownedPluginSkills(skills, user.id, p.id);
    return (
      <article className="directory-card" key={p.id}>
        <button
          className="directory-card-main"
          disabled={opening === p.id}
          onClick={() => void openPlugin(p)}
        >
          <span className="skill-card-icon">
            <Puzzle size={23} />
          </span>
          <span>
            <strong>{p.name}</strong>
            <span className="skill-description">{p.description}</span>
            <small>
              {mine.length ? (
                <span className="directory-badge">
                  Added · {mine.length} skills
                </span>
              ) : (
                <span className="directory-badge">Open source</span>
              )}{" "}
              · by {p.author}
            </small>
          </span>
        </button>
        <button
          className="skill-card-action"
          disabled={opening === p.id}
          aria-label={`${mine.length ? "Manage" : "Add"} ${p.name}`}
          onClick={() => void openPlugin(p)}
        >
          {mine.length ? <Check size={17} /> : <Plus size={17} />}
        </button>
      </article>
    );
  };
  const collection = collections[slide];
  return (
    <div className="page customize-page directory-page">
      <h1>Customize</h1>
      <div className="customize-toolbar">
        <nav className="customize-tabs" aria-label="Customize">
          <NavLink to="/customize/skills">Skills</NavLink>
          <NavLink to="/customize/connectors">Connectors</NavLink>
          <NavLink to="/customize/plugins">Plugins</NavLink>
        </nav>
        <span className="toolbar-divider" />
        <div className="segmented skill-views">
          <button
            className={view === "yours" ? "selected" : ""}
            onClick={() => {
              setView("yours");
              setCategory("");
            }}
          >
            Yours <span>{count}</span>
          </button>
          <button
            className={view === "discover" ? "selected" : ""}
            onClick={() => setView("discover")}
          >
            Discover
          </button>
        </div>
        <div className="customize-controls">
          <div className="skills-search">
            <Search size={16} />
            <input
              aria-label={
                section === "connectors"
                  ? "Search connectors"
                  : "Search plugins"
              }
              placeholder={
                section === "connectors"
                  ? "Search connectors"
                  : "Search skills and plugins"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            className="icon-btn"
            aria-label="Filter directory"
            aria-expanded={filter}
            onClick={() => setFilter((v) => !v)}
          >
            <SlidersHorizontal size={17} />
          </button>
          <button
            className="icon-btn"
            aria-label="Sort directory by name"
            aria-pressed={sort}
            onClick={() => setSort((v) => !v)}
          >
            <ArrowUpDown size={17} />
          </button>
          <div className="popover-anchor">
            <button
              className="btn primary"
              aria-label={`Add ${section === "connectors" ? "connector" : "plugin"}`}
              aria-expanded={add}
              onClick={() => setAdd((v) => !v)}
            >
              <Plus size={17} />
              Add
              <ChevronDown size={13} />
            </button>
            {add && (
              <>
                <button
                  className="dismiss-layer"
                  aria-label="Close add menu"
                  onClick={() => setAdd(false)}
                />
                <div className="popover skill-add-menu">
                  {section === "connectors" ? (
                    <button
                      onClick={() => {
                        setAdd(false);
                        setAddingConnector(null);
                      }}
                    >
                      <Plug size={16} />
                      Add custom connector
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setAdd(false);
                          setView("discover");
                          setQuery("");
                          setCategory("");
                          setAll(true);
                        }}
                      >
                        <BookOpen size={16} />
                        Browse all plugins
                      </button>
                      <button
                        onClick={() => {
                          setAdd(false);
                          upload.current?.click();
                        }}
                      >
                        <Upload size={16} />
                        Upload instruction bundle
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <input
        type="file"
        ref={upload}
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (f.size > 1024 * 1024)
              throw new Error("Choose a JSON instruction bundle under 1 MB.");
            const data = JSON.parse(await f.text());
            if (
              typeof data.name !== "string" ||
              !Array.isArray(data.skills) ||
              !data.skills.length ||
              data.skills.length > 50 ||
              data.skills.some(
                (s: any) =>
                  typeof s.name !== "string" ||
                  typeof s.content !== "string" ||
                  !s.content.trim(),
              )
            )
              throw new Error(
                "Expected a name and skills array, each with name and content.",
              );
            setPlugin({
              id: `imported-${crypto.randomUUID()}`,
              name: data.name,
              description:
                typeof data.description === "string"
                  ? data.description
                  : "Imported instructions",
              author: "You",
              version: "1.0",
              category: "productivity",
              skillCount: data.skills.length,
              source: "",
              revision: "local",
              connectors: [],
              hasScripts: false,
              skills: data.skills.map((s: any, i: number) => ({
                id: String(i),
                name: s.name,
                description:
                  typeof s.description === "string"
                    ? s.description
                    : "Imported instructions",
                content: s.content,
              })),
            });
          } catch (e) {
            notify(messageOf(e), true);
          } finally {
            if (upload.current) upload.current.value = "";
          }
        }}
      />
      {filter && (
        <div className="directory-categories" aria-label="Directory categories">
          <button
            className={!category ? "selected" : ""}
            onClick={() => setCategory("")}
          >
            All categories
          </button>
          {[
            ...new Set(
              section === "plugins"
                ? catalog.map((p) => p.category)
                : connectorDirectory.map((c) => c.category),
            ),
          ].map((c) => (
            <button
              className={category === c ? "selected" : ""}
              key={c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      {(error || detailError) && (
        <ErrorPanel error={error || detailError} retry={refresh} />
      )}
      {view === "discover" &&
        !query &&
        !category &&
        (section === "connectors" ? (
          <>
            <section className={`connector-feature ${collection.color}`}>
              <small>CURATED FOR KIVIDAS</small>
              <h2>{collection.name}</h2>
              <p>{collection.description}</p>
              <div className="floating-logos">
                {connectorDirectory
                  .filter((c) => c.category === collection.category)
                  .map((c) => (
                    <button
                      key={c.id}
                      className="connector-logo"
                      style={{ color: c.color }}
                      aria-label={`View ${c.name}`}
                      onClick={() => setConnector(c)}
                    >
                      {c.mark}
                    </button>
                  ))}
              </div>
              <button
                className="btn"
                onClick={() => {
                  setCategory(collection.category);
                  setFilter(true);
                }}
              >
                Explore
              </button>
              <button
                className="carousel-prev icon-btn"
                aria-label="Previous collection"
                onClick={() =>
                  setSlide(
                    (s) => (s + collections.length - 1) % collections.length,
                  )
                }
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="carousel-next icon-btn"
                aria-label="Next collection"
                onClick={() => setSlide((s) => (s + 1) % collections.length)}
              >
                <ChevronRight size={20} />
              </button>
            </section>
            <div className="carousel-dots">
              {collections.map((c, i) => (
                <button
                  key={c.name}
                  aria-label={`Show ${c.name}`}
                  aria-pressed={slide === i}
                  onClick={() => setSlide(i)}
                />
              ))}
            </div>
          </>
        ) : (
          <section className="skills-feature plugin-feature">
            <div>
              <small>From Anthropic · Open source</small>
              <h2>Data</h2>
              <p>
                Explore datasets, write SQL and turn results into clear stories.
              </p>
              <button
                className="btn primary"
                disabled={!catalog.some((p) => p.id === "data")}
                onClick={() =>
                  void openPlugin(catalog.find((p) => p.id === "data")!)
                }
              >
                Add
              </button>
            </div>
            <svg viewBox="0 0 160 140" fill="none" aria-hidden="true">
              <path
                d="M18 23h102v86H18zM18 45h102M18 67h102M18 89h102M43 23v86M69 23v86M94 23v86"
                stroke="currentColor"
                strokeWidth="3"
              />
              <circle
                cx="115"
                cy="100"
                r="30"
                fill="#bad0c7"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                d="m98 106 11-13 10 9 13-15m-13 0h13v13"
                stroke="currentColor"
                strokeWidth="3"
              />
            </svg>
          </section>
        ))}
      {section === "connectors" && view === "yours" ? (
        <>
          <div className="skill-section-heading">
            <h2>Your connectors</h2>
            <button className="btn" onClick={refresh}>
              Refresh connections
            </button>
          </div>
          {loading ? (
            <Loading />
          ) : tools.filter((t) => filterText(t.name, t.meta?.description || ""))
              .length ? (
            <div className="skill-grid">
              {tools
                .filter((t) => filterText(t.name, t.meta?.description || ""))
                .map((t) => (
                  <article
                    className="directory-card installed-connector"
                    key={t.id}
                  >
                    <span className="skill-card-icon">
                      <Plug size={23} />
                    </span>
                    <div>
                      <strong>{t.name}</strong>
                      <p>{t.meta?.description}</p>
                      <small>
                        {t.authenticated === false
                          ? "Account authorization required"
                          : "Available in your workspace"}
                      </small>
                      <div className="row">
                        {t.authenticated === false ? (
                          <a
                            className="btn primary"
                            href={authorizationPath(t.id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Connect account
                            <ExternalLink size={14} />
                          </a>
                        ) : (
                          <button
                            className="btn"
                            onClick={() =>
                              navigate(
                                `/?new=${Date.now()}&tool=${encodeURIComponent(t.id)}`,
                              )
                            }
                          >
                            Use in chat
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          ) : (
            <Empty title="No connectors added yet">
              Find one in Discover, or add a custom connection.
            </Empty>
          )}
        </>
      ) : (
        <>
          <div className="skill-section-heading">
            <h2>
              {view === "yours"
                ? "Your plugins"
                : category
                  ? `${category[0].toUpperCase() + category.slice(1)} ${section}`
                  : section === "connectors"
                    ? "Explore connectors"
                    : all
                      ? "All plugins"
                      : "New in the directory"}{" "}
              <span className="directory-count">
                {section === "connectors" ? connectors.length : plugins.length}
              </span>
            </h2>
            {!all && section === "plugins" && view === "discover" && (
              <button className="row" onClick={() => setAll(true)}>
                Show all
                <ArrowRight size={16} />
              </button>
            )}
          </div>
          {loading && section === "plugins" ? (
            <Loading />
          ) : (
            <div className="skill-grid">
              {section === "connectors"
                ? connectors.map(connectorCard)
                : (all || query || category || view === "yours"
                    ? plugins
                    : plugins.slice(0, 6)
                  ).map(pluginCard)}
            </div>
          )}
          {!loading && section === "plugins" && plugins.length === 0 && (
            <Empty
              title={view === "yours" ? "Make it yours" : "No matching plugins"}
            >
              Add a plugin from Discover to get started.
            </Empty>
          )}
          {section === "plugins" &&
            view === "discover" &&
            !all &&
            !query &&
            !category && (
              <>
                <div className="skill-section-heading">
                  <h2>More to explore</h2>
                  <button className="row" onClick={() => setAll(true)}>
                    Show all
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="skill-grid">
                  {plugins.slice(6, 12).map(pluginCard)}
                </div>
              </>
            )}
        </>
      )}
      {section === "plugins" && view === "yours" && extensions.length > 0 && (
        <>
          <div className="skill-section-heading">
            <h2>Server extensions</h2>
          </div>
          <p className="muted small">
            Workspace functions are managed separately from plugin skill
            bundles.
          </p>
          <div className="skill-grid">
            {extensions.map((e) => (
              <article
                key={e.id}
                className="directory-card installed-connector"
              >
                <Puzzle size={22} />
                <div>
                  <strong>{e.name}</strong>
                  <p>{e.meta?.description || e.type}</p>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      <p className="directory-footnote">
        {section === "plugins" ? (
          <>
            Public plugin skills are adapted for Kividas. External connectors
            and script runtimes require separate setup.{" "}
            <a
              href="/licenses/anthropic-plugins-NOTICE.txt"
              target="_blank"
              rel="noreferrer"
            >
              Sources & licenses
            </a>
          </>
        ) : (
          <>
            Service availability depends on your account and the provider.
            Configure a connection, authorize your account, then select it in
            chat.
          </>
        )}
      </p>
      {connector && (
        <Modal title={connector.name} wide onClose={() => setConnector(null)}>
          <div className="directory-detail-heading">
            <span className="connector-logo" style={{ color: connector.color }}>
              {connector.mark}
            </span>
            <div>
              <p>{connector.description}</p>
              <small>
                by {connector.author} · {connector.category}
              </small>
            </div>
          </div>
          <h3>Connect to Kividas</h3>
          <p>
            {connector.url
              ? "Add this provider’s MCP server, then complete account authorization where required."
              : "This provider needs a workspace MCP gateway. Enter the server address supplied by your administrator."}
          </p>
          <a
            href={connector.docs}
            target="_blank"
            rel="noreferrer"
            className="btn"
          >
            Provider documentation
            <ExternalLink size={14} />
          </a>
          <div className="row end">
            <button
              className="btn primary"
              onClick={() => {
                setAddingConnector(connector);
                setConnector(null);
              }}
            >
              Set up connection
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {addingConnector !== false && (
        <ConnectorSetup
          user={user}
          initial={addingConnector}
          close={() => setAddingConnector(false)}
          saved={async () => {
            setAddingConnector(false);
            setView("yours");
            await refresh();
          }}
        />
      )}
      {plugin && (
        <PluginDetail
          key={plugin.id}
          bundle={plugin}
          user={user}
          installed={ownedPluginSkills(skills, user.id, plugin.id)}
          canInstall={canInstall}
          close={() => setPlugin(null)}
          updated={async () => {
            await refresh();
          }}
          onConnect={() => {
            setPlugin(null);
            navigate("/customize/connectors");
          }}
        />
      )}
    </div>
  );
}
function ConnectorSetup({
  user,
  initial,
  close,
  saved,
}: {
  user: User;
  initial: DirectoryConnector | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name || ""),
    [url, setUrl] = useState(initial?.url || ""),
    [auth, setAuth] = useState("oauth_2.1"),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [step, setStep] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal
      title="Add custom connector"
      wide
      onClose={() => {
        if (!busy) close();
      }}
    >
      {user.role !== "admin" ? (
        <>
          <p>
            Your administrator must configure the workspace connection first.
            Once available in Yours, you can authorize your own account.
          </p>
          <label>
            Provider
            <input readOnly value={name || "Custom MCP server"} />
          </label>
          <label>
            Server address
            <input
              readOnly
              value={url || "Ask your administrator for the server address"}
            />
          </label>
          <button className="btn" onClick={close}>
            Done
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const connection = newConnection(
                name.trim(),
                url,
                user.id,
                auth,
                key,
              );
              setStep("Verifying server…");
              await connectorsApi.verify(connection);
              if (auth === "oauth_2.1") {
                setStep("Registering connection…");
                const registration = await connectorsApi.register(connection);
                if (!registration.oauth_client_info)
                  throw new Error(
                    "The server did not return OAuth registration details.",
                  );
                connection.info.oauth_client_info =
                  registration.oauth_client_info;
              }
              setStep("Saving connection…");
              await connectorsApi.add(connection);
              setKey("");
              await saved();
            } catch (e) {
              setError(messageOf(e));
            } finally {
              setBusy(false);
              setStep("");
            }
          }}
        >
          <label>
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Remote MCP server URL
            <input
              required
              type="url"
              placeholder="https://mcp.example.com/mcp"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label>
            Authentication
            <select value={auth} onChange={(e) => setAuth(e.target.value)}>
              <option value="oauth_2.1">OAuth · Sign in with provider</option>
              <option value="bearer">API token</option>
              <option value="none">No authentication</option>
            </select>
          </label>
          {auth === "bearer" && (
            <label>
              API token
              <input
                required
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
          )}
          <p className="muted small">
            Added privately for your account. Existing workspace connections are
            preserved. OAuth providers may require an approved client
            registration.
          </p>
          {error && <ErrorPanel error={error} />}
          <div className="row end">
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={busy || !name.trim() || !url.trim()}
            >
              {busy ? step : "Verify and add"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
function PluginDetail({
  bundle,
  user,
  installed,
  canInstall,
  close,
  updated,
  onConnect,
}: {
  bundle: PluginBundle;
  user: User;
  installed: Skill[];
  canInstall: boolean;
  close: () => void;
  updated: () => Promise<void>;
  onConnect: () => void;
}) {
  const [selected, setSelected] = useState(bundle.skills.map((s) => s.id)),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [remove, setRemove] = useState(false),
    [preview, setPreview] = useState("");
  const notify = useNotify(),
    navigate = useNavigate();
  const installedComponent = (id: string) =>
    installed.find((s) => s.meta?.tags?.includes(componentTag(id)));
  return (
    <Modal
      title={bundle.name}
      wide
      onClose={() => {
        if (!busy) close();
      }}
    >
      <div className="directory-detail-heading">
        <span className="skill-card-icon">
          <Puzzle size={28} />
        </span>
        <div>
          <p>{bundle.description}</p>
          <small>
            by {bundle.author} · Version {bundle.version} ·{" "}
            {bundle.skills.length} skills
          </small>
        </div>
      </div>
      <div className="plugin-detail-links">
        {bundle.source && (
          <a href={bundle.source} target="_blank" rel="noreferrer">
            View source
            <ExternalLink size={14} />
          </a>
        )}
        {bundle.source && <a
          href="/licenses/anthropic-plugins-Apache-2.0.txt"
          target="_blank"
          rel="noreferrer"
        >
          Apache-2.0 license
        </a>}
      </div>
      <h3>Skills included</h3>
      <p className="muted small">
        Choose instructions to add to your account. Select an added skill when
        starting a chat.
      </p>
      <div className="plugin-skill-list">
        {bundle.skills.map((s) => {
          const own = installedComponent(s.id);
          return (
            <div className="plugin-skill-row" key={s.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, s.id]
                        : ids.filter((i) => i !== s.id),
                    )
                  }
                />
                <span>
                  <strong>{s.name}</strong>
                  <small>{s.description}</small>
                </span>
              </label>
              {own ? (
                <button
                  className="btn"
                  disabled={!own.is_active}
                  onClick={() =>
                    navigate(
                      `/?new=${Date.now()}&skill=${encodeURIComponent(own.id)}`,
                    )
                  }
                >
                  Use in chat
                </button>
              ) : (
                <button
                  className="icon-btn"
                  aria-label={`Read ${s.name}`}
                  onClick={() => setPreview(preview === s.id ? "" : s.id)}
                >
                  <BookOpen size={16} />
                </button>
              )}
              {preview === s.id && <pre>{s.content}</pre>}
            </div>
          );
        })}
      </div>
      {bundle.connectors.length > 0 && (
        <div className="settings-row">
          <h3>Works with</h3>
          <p className="muted small">
            {bundle.connectors.map((c) => c.name).join(", ")}
          </p>
          <button className="btn" onClick={onConnect}>
            Set up connectors
          </button>
        </div>
      )}
      <p className="muted small">
        {bundle.hasScripts
          ? "This plugin also includes scripts that require a separate execution environment. "
          : ""}
        This installation adds its Markdown skills. Hooks, sub-agents,
        filesystem tools and background execution are not enabled by this web
        frontend.
      </p>
      {error && <ErrorPanel error={error} />}
      <div className="row between">
        {installed.length > 0 ? (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => setRemove(true)}
          >
            Remove plugin skills
          </button>
        ) : (
          <span />
        )}
        <button
          className="btn primary"
          disabled={busy || !canInstall || selected.length === 0}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await installPlugin(bundle, selected, user.id, (n, total) =>
                setProgress(`${n} / ${total}`),
              );
              await updated();
              notify("Plugin skills added to your account");
            } catch (e) {
              setError(
                `${messageOf(e)} Already added skills are kept. Retry to add the remaining skills.`,
              );
              await updated();
            } finally {
              setBusy(false);
              setProgress("");
            }
          }}
        >
          {busy
            ? `Adding ${progress}`
            : installed.length
              ? "Add remaining skills"
              : "Add selected skills"}
        </button>
      </div>
      {!canInstall && (
        <p className="muted small">
          Your account needs permission to create skills.
        </p>
      )}
      {remove && (
        <Confirm
          title="Remove plugin skills"
          description={`Delete the ${installed.length} skills installed from ${bundle.name}? Other skills remain unchanged.`}
          onClose={() => setRemove(false)}
          onConfirm={async () => {
            try {
              for (const s of installed) await skillsApi.remove(s.id);
            } finally {
              await updated();
            }
            close();
          }}
        />
      )}
    </Modal>
  );
}
