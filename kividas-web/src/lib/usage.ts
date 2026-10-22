export type UsageWindow = { used: number; limit: number; resetAt?: string | number | null };
export type AccountWindow = { usedPercent: number | null; resetsAt?: string | null };
export type UsageLimits = {
  linked: boolean;
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
  if (!value || !Number.isFinite(value.used) || value.used < 0 || !Number.isFinite(value.limit) || value.limit <= 0) return null;
  return Math.round(value.used / value.limit * 1000) / 10;
}

export function accountPercent(value?: AccountWindow | null): number | null {
  return value && typeof value.usedPercent === "number" && Number.isFinite(value.usedPercent) && value.usedPercent >= 0
    ? Math.round(value.usedPercent * 10) / 10 : null;
}

export function accountStale(value: UsageLimits["sharedAccount"], now = Date.now()) {
  const at = value?.observedAt ? Date.parse(value.observedAt) : NaN;
  return !value || value.stale || !Number.isFinite(at) || now - at > 15 * 60000 || at > now + 60000;
}

export function usageSummary(data: UsageLimits | null, now = Date.now()) {
  if (!data?.linked) return { percent: null, accountStale: false };
  const seat = data.enterprise;
  const values = seat
    ? [windowPercent({ used: seat.used, limit: seat.quota })]
    : [windowPercent(data.tp5h), windowPercent(data.tpw), windowPercent(data.tpwFable)];
  const stale = !seat && !!data.sharedAccount && accountStale(data.sharedAccount, now);
  if (!seat && data.sharedAccount && !stale) values.push(accountPercent(data.sharedAccount.fiveHour), accountPercent(data.sharedAccount.sevenDay));
  const valid = values.filter((v): v is number => v !== null);
  return { percent: valid.length ? Math.max(...valid) : null, accountStale: stale };
}

export function resetLabel(value: string | number | null | undefined, now: number) {
  if (!value) return "Reset time unavailable";
  const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return "Reset time unavailable";
  const mins = Math.ceil((date.getTime() - now) / 60000);
  if (mins <= 0) return "Awaiting reset update";
  if (mins < 24 * 60) return `Resets in ${Math.floor(mins / 60) ? `${Math.floor(mins / 60)} hr ` : ""}${mins % 60} min`;
  return `Resets ${date.toLocaleDateString(undefined, { weekday: "short" })} ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
