import type { ChatData, GiftCard, GuestConfig, Message, Model } from "./types";
export const canonicalId = (id: string) =>
  id
    .trim()
    .toLowerCase()
    .replace(/^[^/]*\//, "");
export const normalizeIds = (ids: string[]) => [
  ...new Set(ids.filter(Boolean).map(canonicalId)),
];
export function modelOptions(catalog: Model[], selected: string[]): Model[] {
  const options = new Map(
    catalog.map((m) => [canonicalId(m.id), { ...m, id: canonicalId(m.id) }]),
  );
  normalizeIds(selected).forEach((id) => {
    if (!options.has(id)) options.set(id, { id, name: id, unavailable: true });
  });
  return [...options.values()];
}
export function guestModelAllowed(cfg: GuestConfig, id: string) {
  return cfg.GUEST_ALLOWED_MODEL_IDS.length
    ? cfg.GUEST_ALLOWED_MODEL_IDS.includes(id)
    : !cfg.GUEST_BLOCKED_MODEL_IDS.includes(id);
}
export function guestPolicy(
  cfg: GuestConfig,
  catalog: Model[],
  selected: string[],
): GuestConfig {
  // Empty allow-list means unrestricted, so denying all must explicitly block the catalog.
  // Preserve policies for models absent from the current catalog.
  if (!catalog.length) return { ...cfg };
  const known = new Set(catalog.map((m) => m.id));
  const hiddenAllowed = cfg.GUEST_ALLOWED_MODEL_IDS.filter(
    (id) => !known.has(id),
  );
  const hiddenBlocked = cfg.GUEST_BLOCKED_MODEL_IDS.filter(
    (id) => !known.has(id),
  );
  const allowed = [...new Set([...selected, ...hiddenAllowed])];
  return {
    ...cfg,
    GUEST_ALLOWED_MODEL_IDS:
      selected.length === catalog.length && hiddenAllowed.length === 0
        ? []
        : allowed,
    GUEST_BLOCKED_MODEL_IDS:
      allowed.length === 0
        ? [...new Set([...catalog.map((m) => m.id), ...hiddenBlocked])]
        : hiddenBlocked,
  };
}
export const cardState = (c: GiftCard) =>
  c.redeemed_by
    ? c.enabled
      ? "redeemed"
      : "invalidated"
    : c.enabled
      ? "available"
      : "disabled";
export function activeMessages(chat: ChatData): Message[] {
  if (!chat.history?.currentId) return chat.messages ?? [];
  const result: Message[] = [],
    visited = new Set<string>();
  let id: string | null | undefined = chat.history.currentId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const m: Message | undefined = chat.history.messages[id];
    if (!m) break;
    result.unshift(m);
    id = m.parentId;
  }
  return result;
}
export function chatPayload(
  messages: Message[],
  model: string,
  previous?: ChatData,
): ChatData {
  const history = { ...previous?.history?.messages };
  messages.forEach((m, i) => {
    history[m.id] = {
      ...history[m.id],
      ...m,
      parentId: i ? messages[i - 1].id : null,
      childrenIds: [
        ...new Set([
          ...(history[m.id]?.childrenIds ?? []),
          ...(messages[i + 1] ? [messages[i + 1].id] : []),
        ]),
      ],
    };
  });
  return {
    ...previous,
    title:
      previous?.title ||
      messages.find((m) => m.role === "user")?.content.slice(0, 60) ||
      "New chat",
    models: [model],
    messages,
    history: { currentId: messages.at(-1)?.id ?? null, messages: history },
    timestamp: Date.now(),
  };
}
export const safeCell = (value: unknown) => {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
export const csvRows = (rows: unknown[][]) =>
  "\ufeff" +
  rows
    .map((row) =>
      row.map((v) => `"${safeCell(v).replaceAll('"', '""')}"`).join(","),
    )
    .join("\r\n");

export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, any>> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  function parse(block: string) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return null;
    return JSON.parse(data);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const event = parse(block);
        if (event) yield event;
      }
      if (done) {
        if (buffer.trim()) {
          const event = parse(buffer);
          if (event) yield event;
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
