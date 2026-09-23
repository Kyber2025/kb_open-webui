import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  ChevronDown,
  MoreHorizontal,
  Pin,
  Pencil,
  FolderOpen,
  Archive,
  Trash2,
  SlidersHorizontal,
} from "lucide-react";
import type { Chat, Folder } from "../lib/types";
import { api } from "../lib/api";
import { Confirm, Modal, messageOf, useNotify } from "./UI";
export function RecentChats({
  chats,
  refresh,
  userId,
}: {
  chats: Chat[];
  refresh: () => void;
  userId?: string;
}) {
  const [pinned, setPinned] = useState<Chat[]>([]),
    [menu, setMenu] = useState<Chat | null>(null),
    [editing, setEditing] = useState<Chat | null>(null),
    [name, setName] = useState(""),
    [moving, setMoving] = useState<Chat | null>(null),
    [folders, setFolders] = useState<Folder[]>([]),
    [removing, setRemoving] = useState<Chat | null>(null),
    [collapsed, setCollapsed] = useState(false),
    [pinClosed, setPinClosed] = useState(false),
    [filter, setFilter] = useState(false),
    [sort, setSort] = useState("recent"),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [menuTop, setMenuTop] = useState(100);
  const notify = useNotify(),
    navigate = useNavigate();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    let live = true;
    if (userId)
      api
        .pinnedChats()
        .then((c) => {
          if (live) setPinned(c);
        })
        .catch(() => {});
    else setPinned([]);
    return () => {
      live = false;
    };
  }, [userId, chats]);
  async function action(run: () => Promise<unknown>) {
    setBusy(true);
    try {
      await run();
      setMenu(null);
      refresh();
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      setBusy(false);
    }
  }
  const row = (c: Chat) => (
    <div className="recent-chat-row" key={c.id}>
      <NavLink to={`/c/${c.id}`}>
        <span className="recent-dot" />
        <span>{c.title || "Untitled conversation"}</span>
      </NavLink>
      <button
        className="icon-btn recent-options"
        aria-label={`More options for ${c.title}`}
        onClick={(e) => {
          setMenuTop(
            Math.max(
              20,
              Math.min(
                e.currentTarget.getBoundingClientRect().top,
                innerHeight - 280,
              ),
            ),
          );
          setMenu(c);
        }}
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
  const visible = chats
    .filter(
      (c) =>
        !pinned.some((p) => p.id === c.id) &&
        c.title.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title) : 0));
  return (
    <div className="recents">
      <div className="row between recents-heading">
        <button
          className="plain-heading"
          aria-expanded={!pinClosed}
          onClick={() => setPinClosed((v) => !v)}
        >
          Pinned <ChevronDown size={12} />
        </button>
      </div>
      {!pinClosed &&
        (pinned.length ? (
          <div className="recent-list">{pinned.map(row)}</div>
        ) : (
          <p className="sidebar-empty pin-empty">
            <Pin size={12} /> Pin a conversation from its menu.
          </p>
        ))}
      <div className="row between recents-heading">
        <button
          className="plain-heading"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          Chats and tasks <ChevronDown size={12} />
        </button>
        <div className="row">
          <Link to="/chats" aria-label="View all chats">
            <ArrowUpRight size={14} />
          </Link>
          <button
            className="icon-btn"
            aria-label="Filter and sort recents"
            onClick={() => setFilter((v) => !v)}
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>
      </div>
      {filter && (
        <div className="recent-filter">
          <input
            aria-label="Filter recents"
            placeholder="Filter chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Sort recents"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">Last activity</option>
            <option value="name">Name</option>
          </select>
        </div>
      )}
      {!collapsed && (
        <div className="recent-list">
          {visible.slice(0, 30).map(row)}
          {!visible.length && (
            <p className="sidebar-empty">
              Your conversations will appear here.
            </p>
          )}
        </div>
      )}
      {menu && (
        <>
          <button
            className="dismiss-layer"
            aria-label="Close conversation menu"
            onClick={() => setMenu(null)}
          />
          <div
            role="menu"
            aria-label="Conversation actions"
            className="popover chat-action-menu recent-popover"
            style={{ top: menuTop }}
          >
            <button
              disabled={busy}
              onClick={() => void action(() => api.pinChat(menu.id))}
            >
              <Pin size={16} />
              {pinned.some((p) => p.id === menu.id) ? "Unpin" : "Pin"}
            </button>
            <button
              onClick={() => {
                setEditing(menu);
                setName(menu.title);
                setMenu(null);
              }}
            >
              <Pencil size={16} />
              Rename
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setFolders(await api.folders());
                  setMoving(menu);
                  setMenu(null);
                } catch (e) {
                  notify(messageOf(e), true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FolderOpen size={16} />
              Add to project
            </button>
            <button
              disabled={busy}
              onClick={() => void action(() => api.archiveChat(menu.id))}
            >
              <Archive size={16} />
              Archive
            </button>
            <button
              className="danger"
              onClick={() => {
                setRemoving(menu);
                setMenu(null);
              }}
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </>
      )}
      {editing && (
        <Modal title="Rename conversation" onClose={() => setEditing(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await action(async () => {
                await api.renameChat(editing.id, name.trim());
                setEditing(null);
              });
            }}
          >
            <label>
              Title
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="btn primary" disabled={busy || !name.trim()}>
              Save
            </button>
          </form>
        </Modal>
      )}
      {moving && (
        <Modal title="Add to project" onClose={() => setMoving(null)}>
          <div className="chat-action-menu">
            {folders.map((f) => (
              <button
                key={f.id}
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await api.moveChat(moving.id, f.id);
                    setMoving(null);
                  })
                }
              >
                <FolderOpen size={16} />
                {f.name}
              </button>
            ))}
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api.moveChat(moving.id, null);
                  setMoving(null);
                })
              }
            >
              Remove from project
            </button>
            <Link
              className="btn"
              to="/projects"
              onClick={() => setMoving(null)}
            >
              Manage projects
            </Link>
          </div>
        </Modal>
      )}
      {removing && (
        <Confirm
          title="Delete conversation"
          description={`Permanently delete “${removing.title}”?`}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.deleteChat(removing.id);
            refresh();
            if (location.pathname === `/c/${removing.id}`) navigate("/");
          }}
        />
      )}
    </div>
  );
}
