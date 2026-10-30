export type UsageWindow = { used: number | null; limit: number; resetAt?: string | number | null;
  unit?: 'percent'; stopAt?: number; stale?: boolean };
export type OfficialUsageMeta = { source: 'official_cache'; provider: 'claude'; bindingId?: string | null; observedAt: string | null; stale: boolean };
export type AccountWindow = { usedPercent: number | null; resetsAt?: string | null };
export type UsageLimits = {
  linked: boolean;
  usageSource?: 'official_cache' | 'local_tokens';
  officialUsage?: OfficialUsageMeta | null;
  tp5h?: UsageWindow;
  tpw?: UsageWindow;
  tpwFable?: UsageWindow | null;
  enterprise?: { orgName?: string; used: number; quota: number; cycleEndsAt?: number | null } | null;
  sharedAccount?: {
    seats: number;
    observedAt: string | null;
    stale: boolean;
    fiveHour: AccountWindow | null;
    sevenDay: AccountWindow | null;
  } | null;
};

export function windowPercent(value?: UsageWindow | null): number | null {
  if (!value || typeof value.used !== 'number' || !Number.isFinite(value.used) || value.used < 0 || !Number.isFinite(value.limit) || value.limit <= 0) return null;
  return Math.round(value.used / value.limit * 1000) / 10;
}

// The server selects official percentages for a verified 20x allocation only.
// Never infer eligibility from seats or substitute shared-account diagnostics.
export function usageSummary(data: UsageLimits | null) {
  if (!data?.linked) return { percent: null };
  const seat = data.enterprise;
  const values = seat
    ? [windowPercent({ used: seat.used, limit: seat.quota })]
    : [windowPercent(data.tp5h), windowPercent(data.tpw), windowPercent(data.tpwFable)];
  const valid = values.filter((v): v is number => v !== null);
  return { percent: valid.length ? Math.max(...valid) : null };
}

export function usageWindowDetail(value?: UsageWindow | null): string {
  const percent = windowPercent(value);
  if (!value || value.used === null || !Number.isFinite(value.used)) return 'Unavailable';
  if (value.unit === 'percent') return `Official Claude usage: ${percent ?? '—'}%${value.stopAt && value.stopAt < 100 ? ` · Platform stops at ${value.stopAt}%` : ''}`;
  return `${value.used.toLocaleString()} / ${value.limit > 0 ? value.limit.toLocaleString() : 'Unlimited'} tokens`;
}

export function officialCacheNote(meta?: OfficialUsageMeta | null, now = Date.now()): string | null {
  if (!meta) return null;
  const stamp = Date.parse(meta.observedAt ?? '');
  if (!Number.isFinite(stamp)) return 'Official Claude usage is awaiting an update.';
  const minutes = Math.max(0, Math.floor((now - stamp) / 60000));
  return `${meta.stale ? 'Showing the last official Claude reading' : 'Official Claude usage'} · Updated ${minutes === 0 ? 'just now' : `${minutes} min ago`}.`;
}

/** Keep the last successful value on a cache gap, but never across a changed
 * allocation, subscription mode or login. Components are keyed by login. */
export function retainLastUsage<T extends { officialUsage?: OfficialUsageMeta | null; tp5h?: UsageWindow; tpw?: UsageWindow }>(previous: T | null, next: T): T {
  if (!next.officialUsage?.bindingId || next.officialUsage.bindingId !== previous?.officialUsage?.bindingId) return next;
  const missing = (value?: UsageWindow) => !value || value.used === null;
  const keepFive = missing(next.tp5h) && !missing(previous.tp5h);
  const keepWeek = missing(next.tpw) && !missing(previous.tpw);
  if (!keepFive && !keepWeek) return next;
  return { ...next,
    tp5h: keepFive ? { ...previous.tp5h!, stale: true } : next.tp5h,
    tpw: keepWeek ? { ...previous.tpw!, stale: true } : next.tpw,
    officialUsage: { ...next.officialUsage, stale: true, observedAt: previous.officialUsage!.observedAt } };
}

export function resetLabel(value: string | number | null | undefined, now: number) {
  if (!value) return "Reset time unavailable";
  const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return "Reset time unavailable";
  const mins = Math.ceil((date.getTime() - now) / 60000);
  if (mins <= 0) return "Awaiting reset update";
  if (mins < 24 * 60) return `Resets in ${Math.floor(mins / 60) ? `${Math.floor(mins / 60)} hr ` : ""}${mins % 60} min`;
  return `Resets ${date.toLocaleDateString("en-US", { weekday: "short" })} ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
