import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  Users as UsersIcon,
  CreditCard,
  Gift,
  ShieldCheck,
  Plus,
  Download,
  Copy,
  Trash2,
  Save,
  Search,
  RefreshCw,
} from "lucide-react";
import { Users } from "./Users";
import { api } from "../lib/api";
import { isSuperAdmin } from "../lib/access";
import {
  cardState,
  csvRows,
  guestModelAllowed,
  guestPolicy,
  modelOptions,
  normalizeIds,
  safeCell,
} from "../lib/domain";
import type {
  BlacklistEntry,
  GiftCard,
  GiftList,
  GuestConfig,
  Model,
  Tier,
  User,
} from "../lib/types";
import {
  Confirm,
  Empty,
  ErrorPanel,
  Loading,
  messageOf,
  useNotify,
} from "../components/UI";

export function Admin({ user }: { user: User | null }) {
  if (!isSuperAdmin(user)) return <Navigate to="/" replace />;
  return (
    <div className="admin-layout">
      <header className="admin-header">
        <div className="eyebrow">
          <ShieldCheck size={15} /> KIVIDAS ADMIN
        </div>
        <h1>Manage your workspace</h1>
        <p className="muted">
          Your users, plans, gift cards, and guest access. All in one place.
        </p>
      </header>
      <nav className="admin-tabs" aria-label="Administration">
        <NavLink to="users/overview">
          <UsersIcon size={17} />
          Users
        </NavLink>
        <NavLink to="subscriptions">
          <CreditCard size={17} />
          Subscriptions
        </NavLink>
        <NavLink to="gift-cards">
          <Gift size={17} />
          Gift Cards
        </NavLink>
        <NavLink to="guest">
          <ShieldCheck size={17} />
          Guest Access
        </NavLink>
      </nav>
      <Routes>
        <Route index element={<Navigate replace to="users/overview" />} />
        <Route
          path="users"
          element={<Navigate replace to="/admin/users/overview" />}
        />
        <Route path="users/overview" element={<Users sessionUser={user!} />} />
        <Route path="subscriptions" element={<Subscriptions />} />
        <Route path="gift-cards" element={<GiftCards />} />
        <Route path="guest" element={<GuestAccess />} />
        <Route path="*" element={<Navigate replace to="/admin/users/overview" />} />
      </Routes>
    </div>
  );
}
const blankTier = (): Tier => ({
  id: "",
  name: "",
  description: "",
  price_usd: 0,
  duration_days: 30,
  token_limit_5h: null,
  token_limit_week: null,
  extra_usage_multiplier: 1,
  allowed_model_ids: [],
  enabled: true,
  sort_order: 0,
});
function Subscriptions() {
  const [tiers, setTiers] = useState<Tier[]>([]),
    [catalog, setCatalog] = useState<Model[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [adding, setAdding] = useState(false),
    [remove, setRemove] = useState<Tier | null>(null),
    [seedBusy, setSeedBusy] = useState(false);
  const notify = useNotify();
  async function load() {
    setError("");
    setLoading(true);
    try {
      const [t, m] = await Promise.all([api.tiers(), api.catalog()]);
      setTiers(t);
      setCatalog(m);
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
    <section className="admin-content">
      <div className="section-heading">
        <div>
          <h2>Subscription plans</h2>
          <p>
            Set pricing, usage limits, and the models included in each plan.
          </p>
        </div>
        <button
          className="btn primary"
          disabled={loading || !!error || adding}
          onClick={() => setAdding(true)}
        >
          <Plus size={16} />
          Add plan
        </button>
      </div>
      {error ? (
        <ErrorPanel error={error} retry={load} />
      ) : loading ? (
        <Loading />
      ) : (
        <>
          <div className="info-note">
            Token limits apply to rolling 5-hour and weekly windows. Leave a
            limit empty to inherit the global setting; use 0 for unlimited.
          </div>
          {adding && (
            <TierEditor
              key="new"
              tier={{ ...blankTier(), sort_order: tiers.length }}
              catalog={catalog}
              isNew
              onSaved={async () => {
                setAdding(false);
                await load();
              }}
              onDelete={() => setAdding(false)}
            />
          )}
          {tiers.map((t) => (
            <TierEditor
              key={t.id}
              tier={t}
              catalog={catalog}
              onSaved={load}
              onDelete={() => setRemove(t)}
            />
          ))}
          {!tiers.length && !adding && (
            <Empty title="Create your first plan">
              <button
                className="btn"
                disabled={seedBusy}
                onClick={async () => {
                  setSeedBusy(true);
                  try {
                    await api.seedTiers();
                    await load();
                    notify("Default plans created");
                  } catch (e) {
                    notify(messageOf(e), true);
                  } finally {
                    setSeedBusy(false);
                  }
                }}
              >
                {seedBusy ? "Creating…" : "Create default plans"}
              </button>
            </Empty>
          )}
        </>
      )}
      {remove && (
        <Confirm
          title={`Delete ${remove.name}?`}
          description="This removes the plan from the available subscription plans. The default free plan cannot be deleted."
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await api.deleteTier(remove.id);
            await load();
            notify("Plan deleted");
          }}
        />
      )}
    </section>
  );
}
function TierEditor({
  tier,
  catalog,
  isNew = false,
  onSaved,
  onDelete,
}: {
  tier: Tier;
  catalog: Model[];
  isNew?: boolean;
  onSaved: () => Promise<void>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState({
      ...tier,
      allowed_model_ids: normalizeIds(tier.allowed_model_ids),
    }),
    [saving, setSaving] = useState(false),
    [search, setSearch] = useState("");
  const notify = useNotify();
  useEffect(
    () =>
      setDraft({
        ...tier,
        allowed_model_ids: normalizeIds(tier.allowed_model_ids),
      }),
    [tier],
  );
  const set = <K extends keyof Tier>(key: K, value: Tier[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const options = modelOptions(catalog, draft.allowed_model_ids).filter((m) =>
    (m.name + " " + m.id).toLowerCase().includes(search.toLowerCase()),
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const id = draft.id.trim().toLowerCase();
      if (!id) throw new Error("A plan ID is required.");
      await api.saveTier({
        ...draft,
        id,
        name: draft.name.trim() || id,
        allowed_model_ids: normalizeIds(draft.allowed_model_ids),
      });
      notify("Plan saved");
      await onSaved();
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="panel plan-panel" onSubmit={save}>
      <div className="row between plan-title">
        <div className="row">
          <span className="plan-symbol">
            <CreditCard size={21} />
          </span>
          <div>
            <h3>{draft.name || "New plan"}</h3>
            <span className="muted small">
              {isNew ? "Create a subscription tier" : draft.id}
            </span>
          </div>
        </div>
        <label className="switch-label">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          Enabled
        </label>
      </div>
      <div className="form-grid two">
        <label>
          Plan ID
          <input
            required
            disabled={!isNew}
            value={draft.id}
            onChange={(e) => set("id", e.target.value)}
            placeholder="e.g. pro"
            pattern="[a-zA-Z0-9_-]+"
          />
        </label>
        <label>
          Display name
          <input
            required
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Plan name"
          />
        </label>
      </div>
      <div className="form-grid four">
        <label>
          Price (USDT)
          <input
            type="number"
            required
            min="0"
            step="0.01"
            value={draft.price_usd}
            onChange={(e) => set("price_usd", Number(e.target.value))}
          />
        </label>
        <label>
          Duration (days)
          <input
            type="number"
            required
            min="1"
            step="1"
            value={draft.duration_days}
            onChange={(e) => set("duration_days", Number(e.target.value))}
          />
        </label>
        {(["token_limit_5h", "token_limit_week"] as const).map((k, i) => (
          <label key={k}>
            {i ? "Weekly token limit" : "5h token limit"}
            <input
              type="number"
              min="0"
              step="1"
              placeholder="Inherit"
              value={draft[k] ?? ""}
              onChange={(e) =>
                set(k, e.target.value === "" ? null : Number(e.target.value))
              }
            />
          </label>
        ))}
      </div>
      <div className="form-grid two">
        <label>
          Extra-usage multiplier
          <input
            type="number"
            required
            min="0"
            step="0.1"
            value={draft.extra_usage_multiplier}
            onChange={(e) =>
              set("extra_usage_multiplier", Number(e.target.value))
            }
          />
        </label>
        <label>
          Sort order
          <input
            type="number"
            step="1"
            value={draft.sort_order}
            onChange={(e) => set("sort_order", Number(e.target.value))}
          />
        </label>
      </div>
      <label>
        Description
        <input
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <div className="row between model-heading">
        <label>
          Allowed models{" "}
          <span className="muted">
            {draft.allowed_model_ids.length
              ? `(${draft.allowed_model_ids.length} selected)`
              : "(all models)"}
          </span>
        </label>
        <button
          type="button"
          className="text-btn"
          onClick={() => set("allowed_model_ids", [])}
        >
          Allow all
        </button>
      </div>
      <input
        aria-label={`Search models for ${draft.name || "new plan"}`}
        placeholder="Search models…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="model-checklist">
        {options.map((m) => (
          <label key={m.id}>
            <input
              type="checkbox"
              checked={draft.allowed_model_ids.includes(m.id)}
              onChange={(e) =>
                set(
                  "allowed_model_ids",
                  e.target.checked
                    ? [...draft.allowed_model_ids, m.id]
                    : draft.allowed_model_ids.filter((id) => id !== m.id),
                )
              }
            />
            <span>
              {m.name}
              {m.unavailable && <small className="muted"> · Unavailable</small>}
            </span>
          </label>
        ))}
      </div>
      <p className="small muted">
        An empty selection allows all models. Existing unavailable models remain
        in the policy until removed.
      </p>
      <div className="panel-footer">
        <button
          type="button"
          className="text-btn danger"
          disabled={saving || (!isNew && tier.id === "free")}
          onClick={onDelete}
        >
          {isNew ? "Cancel" : "Delete plan"}
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          <Save size={15} />
          {saving ? "Saving…" : "Save plan"}
        </button>
      </div>
    </form>
  );
}

function download(name: string, content: Blob) {
  const url = URL.createObjectURL(content),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function GiftCards() {
  const [tiers, setTiers] = useState<Tier[]>([]),
    [result, setResult] = useState<GiftList>({
      cards: [],
      counts: { total: 0, available: 0, redeemed: 0, disabled: 0 },
    }),
    [batch, setBatch] = useState<GiftCard[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("all"),
    [query, setQuery] = useState(""),
    [tierFilter, setTierFilter] = useState("all"),
    [daysFilter, setDaysFilter] = useState("all"),
    [genTier, setGenTier] = useState(""),
    [count, setCount] = useState(10),
    [duration, setDuration] = useState(""),
    [note, setNote] = useState(""),
    [action, setAction] = useState<{
      card: GiftCard;
      kind: "delete" | "invalidate";
    } | null>(null),
    [refresh, setRefresh] = useState(0);
  const notify = useNotify();
  const giftTiers = tiers.filter(
    (t) => t.enabled && ["pro", "max", "ultra"].includes(t.id),
  );
  useEffect(() => {
    let alive = true;
    api
      .tiers()
      .then((t) => {
        if (alive) {
          setTiers(t);
          setGenTier(
            t.find((t) => t.enabled && ["pro", "max", "ultra"].includes(t.id))
              ?.id || "",
          );
        }
      })
      .catch((e) => {
        if (alive) setError(messageOf(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const timer = setTimeout(
      () => {
        api
          .giftCards(status, query)
          .then((r) => {
            if (alive) {
              setResult(r);
              setError("");
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
  }, [status, query, refresh]);
  const filtered = result.cards.filter(
    (c) =>
      (tierFilter === "all" || c.tier_id === tierFilter) &&
      (daysFilter === "all" || String(c.duration_days) === daysFilter),
  );
  const tierName = (id: string) => tiers.find((t) => t.id === id)?.name || id;
  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const cards = await api.generateCards({
        tier_id: genTier,
        count,
        duration_days: duration ? Number(duration) : null,
        note: note.trim() || null,
      });
      setBatch(cards);
      setRefresh((r) => r + 1);
      notify(`Generated ${cards.length} gift cards`);
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      setBusy(false);
    }
  }
  async function copy(cards: GiftCard[]) {
    try {
      await navigator.clipboard.writeText(cards.map((c) => c.code).join("\n"));
      notify(`Copied ${cards.length} codes`);
    } catch (e) {
      notify(messageOf(e), true);
    }
  }
  async function excel() {
    try {
      const XLSX = await import("xlsx");
      const rows = filtered.map((c) => ({
        Code: safeCell(c.code),
        Plan: safeCell(tierName(c.tier_id)),
        Tier: safeCell(c.tier_id),
        Days: c.duration_days,
        Status: cardState(c),
        "Redeemed by": safeCell(c.redeemed_by),
        "Redeemed at": c.redeemed_at
          ? new Date(c.redeemed_at * 1000).toISOString()
          : "",
        Note: safeCell(c.note),
        "Created at": new Date(c.created_at * 1000).toISOString(),
      }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(rows),
        "Gift Cards",
      );
      XLSX.writeFile(
        book,
        `gift-cards-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (e) {
      notify(messageOf(e), true);
    }
  }
  return (
    <section className="admin-content">
      <div className="section-heading">
        <div>
          <h2>Gift cards</h2>
          <p>
            A simple way to share access. Create single-use subscription codes.
          </p>
        </div>
        <Gift className="heading-icon" size={25} />
      </div>
      <div className="stats-grid">
        {Object.entries(result.counts).map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong>{v.toLocaleString()}</strong>
          </div>
        ))}
      </div>
      <form className="panel" onSubmit={generate}>
        <h3>Generate gift cards</h3>
        <div className="form-grid four">
          <label>
            Plan
            <select
              required
              value={genTier}
              onChange={(e) => setGenTier(e.target.value)}
            >
              <option value="" disabled>
                Select a plan
              </option>
              {giftTiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              type="number"
              required
              min="1"
              max="1000"
              step="1"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <label>
            Duration (days)
            <input
              type="number"
              min="1"
              step="1"
              placeholder={String(
                tiers.find((t) => t.id === genTier)?.duration_days || 30,
              )}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <label>
            Note (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Welcome gift"
            />
          </label>
        </div>
        <div className="row between wrap">
          <span className="muted small">
            {genTier
              ? `Each code grants ${tierName(genTier)} for ${duration || tiers.find((t) => t.id === genTier)?.duration_days} days.`
              : "Create an enabled Pro, Max or Ultra plan first."}
          </span>
          <button className="btn primary" disabled={busy || !genTier}>
            <Plus size={16} />
            {busy ? "Generating…" : "Generate codes"}
          </button>
        </div>
      </form>
      {!!batch.length && (
        <div className="panel generated-panel">
          <div className="row between wrap">
            <h3>Newly generated · {batch.length}</h3>
            <div className="row">
              <button className="btn" onClick={() => copy(batch)}>
                <Copy size={14} />
                Copy all
              </button>
              <button
                className="btn"
                onClick={() =>
                  download(
                    `gift-cards-${batch[0].batch_id || "export"}.csv`,
                    new Blob(
                      [
                        csvRows([
                          ["code", "plan", "duration_days", "note"],
                          ...batch.map((c) => [
                            c.code,
                            tierName(c.tier_id),
                            c.duration_days,
                            c.note,
                          ]),
                        ]),
                      ],
                      { type: "text/csv;charset=utf-8" },
                    ),
                  )
                }
              >
                <Download size={14} />
                CSV
              </button>
            </div>
          </div>
          <div className="code-grid">
            {batch.map((c) => (
              <code key={c.code}>{c.code}</code>
            ))}
          </div>
        </div>
      )}
      <div className="filters">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search gift card code"
            placeholder="Search code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Gift card status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["all", "available", "redeemed", "disabled"].map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <select
          aria-label="Gift card plan"
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
        >
          <option value="all">All plans</option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Gift card duration"
          value={daysFilter}
          onChange={(e) => setDaysFilter(e.target.value)}
        >
          <option value="all">All durations</option>
          {[...new Set(result.cards.map((c) => c.duration_days))]
            .sort((a, b) => a - b)
            .map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
        </select>
        <button
          className="btn"
          disabled={!filtered.length || loading}
          onClick={excel}
        >
          <Download size={15} />
          Excel
        </button>
        <button
          className="icon-btn"
          aria-label="Refresh gift cards"
          onClick={() => setRefresh((r) => r + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error ? (
        <ErrorPanel error={error} retry={() => setRefresh((r) => r + 1)} />
      ) : loading ? (
        <Loading />
      ) : !filtered.length ? (
        <Empty title="No gift cards found">
          Generate a batch or adjust your filters.
        </Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code / plan</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.code}>
                    <td>
                      <code>{c.code}</code>
                      <small>
                        {tierName(c.tier_id)}
                        {c.note && ` · ${c.note}`}
                      </small>
                      {c.redeemed_by && (
                        <small>
                          Redeemed by {c.redeemed_by}
                          {c.redeemed_at &&
                            ` · ${new Date(c.redeemed_at * 1000).toLocaleDateString()}`}
                        </small>
                      )}
                    </td>
                    <td>{c.duration_days} days</td>
                    <td>
                      <span className={`badge ${cardState(c)}`}>
                        {cardState(c)}
                      </span>
                    </td>
                    <td>
                      <div className="row">
                        <button
                          className="icon-btn"
                          aria-label={`Copy ${c.code}`}
                          onClick={() => copy([c])}
                        >
                          <Copy size={15} />
                        </button>
                        {!c.redeemed_by ? (
                          <button
                            className="text-btn"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await api.cardStatus(c.code, !c.enabled);
                                setRefresh((r) => r + 1);
                              } catch (e) {
                                notify(messageOf(e), true);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {c.enabled ? "Disable" : "Enable"}
                          </button>
                        ) : (
                          c.enabled && (
                            <button
                              className="text-btn danger"
                              onClick={() =>
                                setAction({ card: c, kind: "invalidate" })
                              }
                            >
                              Invalidate
                            </button>
                          )
                        )}
                        <button
                          className="icon-btn danger"
                          aria-label={`Delete ${c.code}`}
                          onClick={() => setAction({ card: c, kind: "delete" })}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Showing {filtered.length} of {result.cards.length}
            {result.cards.length >= 500
              ? " · Most recent 500. Search to find older codes."
              : ""}
          </p>
        </>
      )}
      {action && (
        <Confirm
          title={
            action.kind === "delete"
              ? "Delete gift card?"
              : "Invalidate redeemed gift card?"
          }
          description={
            action.kind === "delete"
              ? `Permanently delete ${action.card.code}. This cannot be undone.`
              : `Void ${action.card.code} and revoke the subscription it granted. This changes the recipient’s access.`
          }
          onClose={() => setAction(null)}
          onConfirm={async () => {
            if (action.kind === "delete")
              await api.deleteCard(action.card.code);
            else await api.invalidateCard(action.card.code);
            setBatch((b) => b.filter((c) => c.code !== action.card.code));
            setRefresh((r) => r + 1);
            notify("Gift card updated");
          }}
        />
      )}
    </section>
  );
}
function GuestAccess() {
  const [cfg, setCfg] = useState<GuestConfig | null>(null),
    [models, setModels] = useState<Model[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ip, setIp] = useState(""),
    [reason, setReason] = useState(""),
    [search, setSearch] = useState("");
  const notify = useNotify();
  async function load() {
    setError("");
    try {
      const [c, m, b] = await Promise.all([
        api.guestConfig(),
        api.catalog(),
        api.blacklist(),
      ]);
      setCfg(c);
      setModels(m);
      setSelected(m.filter((m) => guestModelAllowed(c, m.id)).map((m) => m.id));
      setBlacklist(b);
    } catch (e) {
      setError(messageOf(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    setBusy(true);
    try {
      const saved = await api.saveGuestConfig(
        guestPolicy(cfg, models, selected),
      );
      setCfg(saved);
      notify("Guest access settings saved");
    } catch (e) {
      notify(messageOf(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-content">
      <div className="section-heading">
        <div>
          <h2>Guest access</h2>
          <p>Let visitors try Kividas, with the limits you choose.</p>
        </div>
        <ShieldCheck size={25} className="heading-icon" />
      </div>
      {error ? (
        <ErrorPanel error={error} retry={load} />
      ) : !cfg ? (
        <Loading />
      ) : (
        <>
          <form className="panel" onSubmit={save}>
            <div className="row between">
              <div>
                <h3>Allow guest conversations</h3>
                <p className="small muted">
                  Visitors can chat without creating an account.
                </p>
              </div>
              <label className="switch-label">
                <input
                  aria-label="Enable guest access"
                  type="checkbox"
                  checked={cfg.ENABLE_GUEST_ACCESS}
                  onChange={(e) =>
                    setCfg({ ...cfg, ENABLE_GUEST_ACCESS: e.target.checked })
                  }
                />
                Enabled
              </label>
            </div>
            <label className="short-field">
              Daily message limit
              <input
                type="number"
                min="0"
                required
                step="1"
                value={cfg.GUEST_DAILY_LIMIT}
                onChange={(e) =>
                  setCfg({ ...cfg, GUEST_DAILY_LIMIT: Number(e.target.value) })
                }
              />
            </label>
            <div className="row between model-heading">
              <h3>
                Allowed models{" "}
                <span className="muted small">
                  {selected.length} / {models.length}
                </span>
              </h3>
              <div className="row">
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setSelected(models.map((m) => m.id))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setSelected([])}
                >
                  Select none
                </button>
              </div>
            </div>
            <input
              aria-label="Search guest models"
              placeholder="Search models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="model-checklist">
              {models
                .filter((m) =>
                  (m.name + " " + m.id)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((m) => (
                  <label key={m.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(m.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, m.id]
                            : selected.filter((id) => id !== m.id),
                        )
                      }
                    />
                    {m.name}
                  </label>
                ))}
            </div>
            <div className="panel-footer">
              <span className="small muted">
                Selecting none blocks all currently listed models.
              </span>
              <button className="btn primary" disabled={busy}>
                <Save size={15} />
                {busy ? "Saving…" : "Save settings"}
              </button>
            </div>
          </form>
          <div className="panel">
            <h3>IP blacklist</h3>
            <p className="small muted">
              Block guest access from specific IPv4 or IPv6 addresses.
            </p>
            <form
              className="row wrap"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const row = await api.blockIp(ip.trim(), reason.trim());
                  setBlacklist((b) => [
                    ...b.filter((x) => x.ip !== row.ip),
                    row,
                  ]);
                  setIp("");
                  setReason("");
                  notify("IP address blocked");
                } catch (e) {
                  notify(messageOf(e), true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="grow">
                IP address
                <input
                  required
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="192.0.2.1"
                />
              </label>
              <label className="grow">
                Reason (optional)
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for blocking"
                />
              </label>
              <button className="btn align-bottom" disabled={busy}>
                <Plus size={15} />
                Block IP
              </button>
            </form>
            {!blacklist.length ? (
              <Empty title="No blocked IP addresses" />
            ) : (
              <div className="blacklist">
                {blacklist.map((b) => (
                  <div className="row between" key={b.ip}>
                    <div>
                      <code>{b.ip}</code>
                      <small className="muted">
                        {b.reason || "No reason provided"}
                      </small>
                    </div>
                    <button
                      className="text-btn danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.unblockIp(b.ip);
                          setBlacklist((list) =>
                            list.filter((x) => x.ip !== b.ip),
                          );
                          notify("IP address unblocked");
                        } catch (e) {
                          notify(messageOf(e), true);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
