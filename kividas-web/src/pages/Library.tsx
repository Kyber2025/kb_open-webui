import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, Code2, FolderOpen, Plus, Search } from "lucide-react";
import { api } from "../lib/api";
import type { Chat, Folder } from "../lib/types";
import { downloadText } from "../lib/preferences";
import { activeMessages } from "../lib/domain";
import {
  Empty,
  ErrorPanel,
  Loading,
  Modal,
  messageOf,
  useNotify,
} from "../components/UI";
export function Projects() {
  const [folders, setFolders] = useState<Folder[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [adding, setAdding] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("recent"),
    [busy, setBusy] = useState(false);
  const notify = useNotify();
  async function load() {
    try {
      setFolders(await api.folders());
      setError("");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="page library">
      <div className="section-heading">
        <div>
          <h1>Projects</h1>
          <p>Keep related conversations together.</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Plus size={16} />
          New project
        </button>
      </div>
      <div className="catalog-filters">
        <input
          aria-label="Search projects"
          placeholder="Search projects"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Sort projects"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="recent">Recent</option>
          <option value="name">Name</option>
        </select>
      </div>
      {error ? (
        <ErrorPanel error={error} retry={load} />
      ) : loading ? (
        <Loading />
      ) : !folders.length ? (
        <Empty title="A home for your next idea">
          Create a project to organize your conversations.
        </Empty>
      ) : (
        <div className="project-grid">
          {folders
            .filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
            .sort((a, b) =>
              sort === "name" ? a.name.localeCompare(b.name) : 0,
            )
            .map((f) => (
              <Link
                className="panel project-card"
                key={f.id}
                to={`/projects/${encodeURIComponent(f.id)}`}
              >
                <FolderOpen size={23} />
                <h3>{f.name}</h3>
                <span className="muted small">
                  Start a conversation <ArrowUpRight size={14} />
                </span>
              </Link>
            ))}
        </div>
      )}
      {adding && (
        <Modal title="New project" onClose={() => setAdding(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api.createFolder(name.trim(), description.trim());
                setName("");
                setAdding(false);
                await load();
                notify("Project created");
              } catch (e) {
                notify(messageOf(e), true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Project name
              <input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What are you working on?"
              />
            </label>
            <label>
              What are you trying to achieve?
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your project, goals, subject, etc…"
              />
            </label>
            <div className="row end">
              <button className="btn primary" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
export function Chats() {
  const [chats, setChats] = useState<Chat[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(1),
    [more, setMore] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      (query ? api.searchChats(query) : api.chats(page))
        .then((c) => {
          if (alive) {
            setChats((old) =>
              page === 1 || query
                ? c
                : [...old, ...c.filter((x) => !old.some((y) => y.id === x.id))],
            );
            setMore(c.length >= 60);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError(messageOf(e));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, page]);
  return (
    <div className="page library">
      <h1>Your conversations</h1>
      <div className="search-field library-search">
        <Search size={18} />
        <input
          aria-label="Search conversations"
          placeholder="Search your chats…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {error ? (
        <ErrorPanel error={error} />
      ) : (
        <>
          <div className="chat-list">
            {chats.map((c) => (
              <Link key={c.id} to={`/c/${c.id}`}>
                <span>{c.title || "Untitled conversation"}</span>
                <ArrowUpRight size={16} />
              </Link>
            ))}
          </div>
          {loading ? (
            <Loading />
          ) : !chats.length ? (
            <Empty title="No conversations found" />
          ) : (
            more &&
            !query && (
              <button className="btn" onClick={() => setPage((p) => p + 1)}>
                Load more
              </button>
            )
          )}
        </>
      )}
    </div>
  );
}
export function Artifacts() {
  const [items, setItems] = useState<
      { id: string; title: string; code: string; language: string }[]
    >([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<number | null>(null),
    [query, setQuery] = useState(""),
    [type, setType] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.chats();
        const docs = await Promise.all(
          list.slice(0, 20).map((c) => api.chat(c.id)),
        );
        const found = docs.flatMap((c) =>
          c.chat
            ? activeMessages(c.chat)
                .filter((m) => m.role === "assistant")
                .flatMap((m) =>
                  Array.from(
                    m.content.matchAll(/```([^\n]*)\n([\s\S]*?)```/g),
                  ).map((match, i) => ({
                    id: `${m.id}-${i}`,
                    title: c.title,
                    language: match[1] || "text",
                    code: match[2],
                  })),
                )
            : [],
        );
        if (alive) setItems(found);
      } catch (e) {
        if (alive) setError(messageOf(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="page library">
      <h1>Artifacts</h1>
      <div className="catalog-filters">
        <input
          aria-label="Search artifacts"
          placeholder="Search artifacts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Artifact type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All types</option>
          {[...new Set(items.map((a) => a.language))].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <h3>Make something new</h3>
      <div className="artifact-templates">
        {[
          ["Docs", "Write a well-structured Markdown document about "],
          ["Code", "Build a small application that "],
          ["Design", "Create an accessible HTML and CSS design for "],
        ].map(([name, prompt]) => (
          <Link
            className="panel project-card"
            key={name}
            to={`/?new=${Date.now()}&prompt=${encodeURIComponent(prompt)}`}
          >
            <Code2 size={23} />
            <h3>{name}</h3>
            <small>Start with a prompt</small>
          </Link>
        ))}
      </div>
      <p className="muted">
        Code and documents from your 20 most recent conversations.
      </p>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorPanel error={error} />
      ) : !items.length ? (
        <Empty title="Your ideas, made tangible">
          Ask Kividas to write code. Your generated code blocks will appear
          here.
        </Empty>
      ) : (
        <div className="project-grid">
          {items
            .map((a, i) => ({ a, i }))
            .filter(
              ({ a }) =>
                a.title.toLowerCase().includes(query.toLowerCase()) &&
                (!type || a.language === type),
            )
            .map(({ a, i }) => (
              <button
                className="panel project-card"
                key={a.id}
                onClick={() => setSelected(i)}
              >
                <Code2 size={23} />
                <h3>{a.title}</h3>
                <small>{a.language}</small>
              </button>
            ))}
        </div>
      )}
      {selected !== null && (
        <Modal
          title={items[selected].title}
          wide
          onClose={() => setSelected(null)}
        >
          <div className="row end">
            <button
              className="btn"
              onClick={() =>
                downloadText(
                  `artifact.${({ javascript: "js", typescript: "ts", python: "py", html: "html", css: "css", json: "json", markdown: "md" } as Record<string, string>)[items[selected].language] || "txt"}`,
                  items[selected].code,
                )
              }
            >
              Download
            </button>
          </div>
          <pre className="artifact-code">
            <code>{items[selected].code}</code>
          </pre>
        </Modal>
      )}
    </div>
  );
}
export function Project() {
  const { id } = useParams();
  const [chats, setChats] = useState<Chat[]>([]),
    [folder, setFolder] = useState<Folder | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [instructions, setInstructions] = useState(""),
    [busy, setBusy] = useState(false);
  const notify = useNotify();
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.folderChats(id!), api.folder(id!)])
      .then(([c, f]) => {
        if (alive) {
          setChats(c);
          setFolder(f);
          setName(f.name);
          setDescription(f.data?.description || "");
          setInstructions(f.data?.system_prompt || "");
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(messageOf(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <div className="page library">
      <div className="section-heading">
        <div>
          <h1>{folder?.name || "Project"}</h1>
          <p>{folder?.data?.description || "Conversations in this project"}</p>
        </div>
        <div className="row">
          <button
            className="btn"
            disabled={!folder}
            onClick={() => setEditing(true)}
          >
            Edit project
          </button>
          <Link
            className="btn primary"
            to={`/?project=${encodeURIComponent(id!)}`}
          >
            <Plus size={16} />
            New chat
          </Link>
        </div>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorPanel error={error} />
      ) : (
        <>
          <div className="panel project-instructions">
            <div className="row between">
              <h3>Instructions</h3>
              <button className="btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            </div>
            <p className="muted">
              {folder?.data?.system_prompt ||
                "Add instructions to guide every conversation in this project."}
            </p>
          </div>
          {chats.length ? (
            <div className="chat-list">
              {chats.map((c) => (
                <Link key={c.id} to={`/c/${c.id}`}>
                  <span>{c.title}</span>
                  <ArrowUpRight size={16} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="Room for your first idea">
              Start a conversation in this project.
            </Empty>
          )}
        </>
      )}
      {editing && folder && (
        <Modal
          title="Edit project"
          wide
          onClose={() => {
            if (!busy) setEditing(false);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const saved = await api.updateFolder(folder.id, {
                  name: name.trim(),
                  data: {
                    ...folder.data,
                    description,
                    system_prompt: instructions,
                  },
                });
                setFolder(saved);
                setEditing(false);
                notify("Project updated");
              } catch (e) {
                notify(messageOf(e), true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Project name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              Instructions
              <textarea
                rows={6}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={busy || !name.trim()}>
              Save project
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
