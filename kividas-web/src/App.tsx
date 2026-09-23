import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Archive,
  Clock,
  Download,
  BriefcaseBusiness,
  ArrowUpRight,
  ChevronDown,
  Code2,
  CreditCard,
  FolderOpen,
  Home,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { api, ApiError, token } from "./lib/api";
import type { Chat, Config, Model, User } from "./lib/types";
import { isSuperAdmin } from "./lib/access";
const Admin = lazy(() =>
  import("./pages/Admin").then((module) => ({ default: module.Admin })),
);
import { RecentChats } from "./components/RecentChats";
import { SettingsPanel } from "./components/Settings";
import { Subscription } from "./components/Subscription";
import { Scheduled } from "./pages/Scheduled";
import { Customize } from "./pages/Customize";
import { CodeDownloads } from "./pages/Code";
import { BrandMark, ChatPage } from "./pages/Chat";
import { Artifacts, Chats, Project, Projects } from "./pages/Library";
import {
  ErrorPanel,
  Loading,
  Modal,
  messageOf,
  useNotify,
} from "./components/UI";
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [config, setConfig] = useState<Config>({ name: "Kividas" }),
    [models, setModels] = useState<Model[]>([]),
    [chats, setChats] = useState<Chat[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [sidebar, setSidebar] = useState(
      () =>
        innerWidth > 760 && localStorage.getItem("kividas:sidebar") !== "false",
    ),
    [menu, setMenu] = useState(false),
    [login, setLogin] = useState(false),
    [settings, setSettings] = useState(false),
    [subscription, setSubscription] = useState(false),
    [moreNav, setMoreNav] = useState(false),
    [theme, setTheme] = useState(
      localStorage.getItem("kividas:theme") || "light",
    );
  const location = useLocation(),
    navigate = useNavigate(),
    notify = useNotify();
  const guest = user?.email === "guest@guest.local";
  const refreshChats = useCallback(() => {
    if (user && !guest)
      api
        .chats()
        .then(setChats)
        .catch((e) => notify(messageOf(e), true));
    else setChats([]);
  }, [user, guest, notify]);
  async function initialize() {
    setLoading(true);
    setError("");
    try {
      const cfg = await api.config();
      setConfig(cfg);
      let current: User | null = null;
      if (token()) {
        try {
          current = await api.me();
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 401)) throw e;
        }
      }
      if (
        !current &&
        cfg.features?.enable_guest_access &&
        location.pathname !== "/auth"
      ) {
        const session = await api.guest();
        localStorage.setItem("token", session.token);
        current = await api.me();
      }
      setUser(current);
      if (current) {
        setLogin(false);
        if (location.pathname === "/auth") navigate("/", { replace: true });
        setModels(await api.models());
        if (current.email !== "guest@guest.local") setChats(await api.chats());
      } else setLogin(true);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    for (const key of ["text-size", "transcript-width"]) {
      const value = localStorage.getItem(`kividas:${key}`);
      if (value) document.documentElement.setAttribute(`data-${key}`, value);
    }
    void initialize();
    const expired = () => {
      setUser(null);
      setModels([]);
      setChats([]);
      setLogin(true);
      notify("Your session expired. Please sign in again.", true);
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("kividas:theme", theme);
  }, [theme]);
  useEffect(() => {
    setMenu(false);
    if (innerWidth <= 760) setSidebar(false);
    document.title =
      isSuperAdmin(user) && location.pathname.startsWith("/admin")
        ? "Admin Panel · Kividas"
        : "Kividas";
  }, [location.pathname, location.search, user?.role]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        navigate("/chats");
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o"
      ) {
        e.preventDefault();
        navigate(`/?new=${Date.now()}`);
      }
      if (e.key === "Escape") {
        setMenu(false);
        setMoreNav(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [navigate]);
  useEffect(() => {
    window.addEventListener("chats-updated", refreshChats);
    return () => window.removeEventListener("chats-updated", refreshChats);
  }, [refreshChats]);
  function toggleSidebar() {
    setSidebar((s) => {
      localStorage.setItem("kividas:sidebar", String(!s));
      return !s;
    });
  }
  const newChat = () => navigate(`/?new=${Date.now()}`);
  return (
    <div className={`app ${sidebar ? "sidebar-open" : "sidebar-closed"}`}>
      {sidebar && (
        <button
          className="mobile-backdrop"
          aria-label="Close sidebar"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className="sidebar" aria-label="Sidebar">
        <div className="sidebar-brand">
          <Link to="/" className="wordmark">
            <img src="/kividas-code.png" alt="" />
            Kividas
          </Link>
          <div className="row">
            <button
              className="icon-btn"
              aria-label="Hide sidebar"
              onClick={toggleSidebar}
            >
              <PanelLeftClose size={16} />
            </button>
            <button
              className="icon-btn"
              aria-label="Search"
              onClick={() => navigate("/chats")}
            >
              <Search size={16} />
            </button>
          </div>
        </div>
        <nav className="primary-nav" aria-label="Main navigation">
          <div className="surface-tabs">
            <NavLink
              to="/"
              end
              className={location.pathname === "/code" ? "" : "selected"}
            >
              <Home size={14} />
              Home
            </NavLink>
            <NavLink to="/code">
              <Code2 size={14} />
              Code
            </NavLink>
          </div>
          <button
            className={`nav-item new-chat ${location.pathname === "/" ? "selected" : ""}`}
            onClick={newChat}
          >
            <Plus size={18} />
            New
          </button>
          <NavLink className="nav-item" to="/projects">
            <FolderOpen size={18} />
            Projects
          </NavLink>
          <NavLink className="nav-item" to="/artifacts">
            <Archive size={18} />
            Artifacts
          </NavLink>
          <NavLink className="nav-item" to="/scheduled-task">
            <Clock size={18} />
            Scheduled
          </NavLink>
          <NavLink
            className={`nav-item ${location.pathname.startsWith("/customize") ? "active" : ""}`}
            to="/customize/skills"
          >
            <BriefcaseBusiness size={18} />
            Customize
          </NavLink>
          <button
            className="nav-item"
            aria-expanded={moreNav}
            onClick={() => setMoreNav((v) => !v)}
          >
            <ChevronDown size={18} />
            More
          </button>
          {moreNav && (
            <div className="more-nav">
              <NavLink className="nav-item" to="/chats">
                <Search size={18} />
                All chats
              </NavLink>
              <NavLink className="nav-item" to="/code">
                <Download size={18} />
                Get apps and CLI
              </NavLink>
              {isSuperAdmin(user) && (
                <NavLink className="nav-item" to="/admin/subscriptions">
                  <ShieldCheck size={18} />
                  Admin Panel
                </NavLink>
              )}
            </div>
          )}
        </nav>
        <RecentChats
          chats={chats}
          refresh={refreshChats}
          userId={guest ? undefined : user?.id}
        />
        <div className="account-area">
          {menu && (
            <>
              <button
                className="dismiss-layer"
                aria-label="Close account menu"
                onClick={() => setMenu(false)}
              />
              <div className="popover account-menu">
                <strong>{user?.name || "Welcome to Kividas"}</strong>
                <small>{guest ? "Guest account" : user?.email}</small>
                <hr />
                <button
                  onClick={() => {
                    setMenu(false);
                    setSettings(true);
                  }}
                >
                  <Settings size={17} />
                  Settings
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    guest || !user ? setLogin(true) : setSubscription(true);
                  }}
                >
                  <CreditCard size={17} />
                  Subscription
                </button>
                {isSuperAdmin(user) && (
                  <Link to="/admin/subscriptions">
                    <ShieldCheck size={17} />
                    Admin Panel
                  </Link>
                )}
                <hr />
                {user && !guest ? (
                  <button
                    onClick={async () => {
                      try {
                        await api.logout();
                        localStorage.removeItem("token");
                        setUser(null);
                        setModels([]);
                        setChats([]);
                        setMenu(false);
                        navigate("/");
                        setLogin(true);
                      } catch (e) {
                        notify(messageOf(e), true);
                      }
                    }}
                  >
                    <LogOut size={17} />
                    Sign out
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setMenu(false);
                      setLogin(true);
                    }}
                  >
                    Sign in
                  </button>
                )}
              </div>
            </>
          )}
          <button
            className="account-button"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            <span className="avatar">
              {(user?.name || "K").slice(0, 2).toUpperCase()}
            </span>
            <span>
              {guest ? "Guest" : user?.name || "Sign in"}
              <small>
                {isSuperAdmin(user)
                  ? "Administrator"
                  : guest
                    ? "Explore Kividas"
                    : "Personal account"}
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
      <main>
        {!sidebar && (
          <button
            className="sidebar-expand icon-btn"
            aria-label="Open sidebar"
            onClick={toggleSidebar}
          >
            <Menu size={20} />
          </button>
        )}
        {config.demo && (
          <div className="demo-banner">
            Local preview · Sample data · No production changes
          </div>
        )}
        {loading ? (
          <Loading text="Getting things ready…" />
        ) : error ? (
          <div className="page">
            <ErrorPanel error={error} retry={initialize} />
          </div>
        ) : user && !["user", "admin"].includes(user.role) ? (
          <div className="page">
            <ErrorPanel error="Your account is pending approval." />
          </div>
        ) : (
          <Routes>
            <Route
              path="/"
              element={
                <ChatPage
                  user={user}
                  models={models}
                  config={config}
                  onSaved={refreshChats}
                  onLogin={() => setLogin(true)}
                />
              }
            />
            <Route
              path="/new"
              element={
                <ChatPage
                  user={user}
                  models={models}
                  config={config}
                  onSaved={refreshChats}
                  onLogin={() => setLogin(true)}
                />
              }
            />
            <Route
              path="/c/:id"
              element={
                <ChatPage
                  user={user}
                  models={models}
                  config={config}
                  onSaved={refreshChats}
                  onLogin={() => setLogin(true)}
                />
              }
            />
            <Route
              path="/admin/*"
              element={
                isSuperAdmin(user) ? (
                  <Suspense fallback={<Loading />}>
                    <Admin user={user} />
                  </Suspense>
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/projects"
              element={
                user && !guest ? (
                  <Projects />
                ) : (
                  <SignInPrompt onLogin={() => setLogin(true)} />
                )
              }
            />
            <Route
              path="/chats"
              element={
                user && !guest ? (
                  <Chats />
                ) : (
                  <SignInPrompt onLogin={() => setLogin(true)} />
                )
              }
            />
            <Route
              path="/artifacts"
              element={
                user && !guest ? (
                  <Artifacts />
                ) : (
                  <SignInPrompt onLogin={() => setLogin(true)} />
                )
              }
            />
            <Route
              path="/projects/:id"
              element={
                user && !guest ? (
                  <Project />
                ) : (
                  <SignInPrompt onLogin={() => setLogin(true)} />
                )
              }
            />
            <Route
              path="/auth"
              element={<SignInPrompt onLogin={() => setLogin(true)} />}
            />
            <Route
              path="/customize"
              element={<Navigate to="/customize/skills" replace />}
            />
            <Route
              path="/customize/:section"
              element={
                user && !guest ? (
                  <Customize user={user} />
                ) : (
                  <SignInPrompt onLogin={() => setLogin(true)} />
                )
              }
            />
            <Route
              path="/scheduled-task"
              element={
                user && !guest ? (
                  <Scheduled models={models} user={user} />
                ) : (
                  <SignInPrompt onLogin={() => setLogin(true)} />
                )
              }
            />
            <Route path="/code" element={<CodeDownloads />} />
            <Route
              path="*"
              element={
                <div className="page">
                  <h1>Page not found</h1>
                  <Link className="btn" to="/">
                    Start a new chat
                  </Link>
                </div>
              }
            />
          </Routes>
        )}
      </main>
      {login && (
        <Login
          onClose={() => setLogin(false)}
          onSuccess={async (u) => {
            const [catalog, history] = await Promise.all([
              api.models(),
              api.chats(),
            ]);
            setUser(u);
            setModels(catalog);
            setChats(history);
            setLogin(false);
            if (location.pathname === "/auth") navigate("/", { replace: true });
          }}
        />
      )}
      {settings && (
        <SettingsPanel
          user={user}
          theme={theme}
          setTheme={setTheme}
          onUser={setUser}
          close={() => setSettings(false)}
          billing={() => {
            setSettings(false);
            setSubscription(true);
          }}
        />
      )}
      {subscription && <Subscription onClose={() => setSubscription(false)} onChanged={async () => {
        const [current, catalog] = await Promise.all([api.me(), api.models()]);
        setUser(current); setModels(catalog);
        window.dispatchEvent(new Event("subscription-updated"));
      }} />}
    </div>
  );
}
function SignInPrompt({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="page empty">
      <BrandMark />
      <h2>A place for your work</h2>
      <p>Sign in to save and organize your conversations.</p>
      <button className="btn primary" onClick={onLogin}>
        Sign in
      </button>
    </div>
  );
}
function Login({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (u: User) => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Welcome to Kividas" onClose={onClose}>
      <p className="muted">Sign in with your existing Kividas account.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const session = await api.login(email, password);
            localStorage.setItem("token", session.token);
            await onSuccess(await api.me());
          } catch (e) {
            setError(messageOf(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input
            type="email"
            required
            autoFocus
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <ErrorPanel error={error} />}
        <button className="btn primary full-width" disabled={busy}>
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>
    </Modal>
  );
}
