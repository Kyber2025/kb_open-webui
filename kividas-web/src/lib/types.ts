export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  timezone?: string;
  profile_image_url?: string;
  expires_at?: number;
}
export interface Config {
  name: string;
  demo?: boolean;
  features?: Record<string, boolean>;
  default_models?: string;
  default_prompt_suggestions?: { title: string[]; content: string }[];
}
export interface Model {
  id: string;
  name: string;
  info?: {
    meta?: { description?: string; capabilities?: Record<string, boolean> };
  };
  unavailable?: boolean;
}
export interface Tier {
  id: string;
  name: string;
  description: string;
  price_usd: number;
  duration_days: number;
  token_limit_5h: number | null;
  token_limit_week: number | null;
  extra_usage_multiplier: number;
  allowed_model_ids: string[];
  enabled: boolean;
  sort_order: number;
}
export interface GiftCard {
  code: string;
  tier_id: string;
  duration_days: number;
  enabled: boolean;
  note?: string;
  batch_id?: string;
  redeemed_by?: string;
  redeemed_at?: number;
  created_at: number;
}
export interface GiftList {
  cards: GiftCard[];
  counts: {
    total: number;
    available: number;
    redeemed: number;
    disabled: number;
  };
}
export interface GuestConfig {
  ENABLE_GUEST_ACCESS: boolean;
  GUEST_DAILY_LIMIT: number;
  GUEST_ALLOWED_MODEL_IDS: string[];
  GUEST_BLOCKED_MODEL_IDS: string[];
}
export interface BlacklistEntry {
  ip: string;
  reason?: string;
  created_at: number;
}
export interface Attachment {
  id: string;
  name: string;
  type: "file" | "image";
  url?: string;
  file?: Record<string, unknown>;
}
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parentId?: string | null;
  childrenIds?: string[];
  timestamp?: number;
  done?: boolean;
  model?: string;
  files?: Attachment[];
}
export interface ChatData {
  skill_ids?: string[];
  tool_ids?: string[];
  params?: { reasoning_effort?: string };
  title: string;
  models: string[];
  messages: Message[];
  history?: { currentId: string | null; messages: Record<string, Message> };
  timestamp?: number;
}
export interface Chat {
  id: string;
  title: string;
  chat?: ChatData;
  updated_at?: number;
  pinned?: boolean;
  archived?: boolean;
  folder_id?: string | null;
}
export interface Folder {
  data?: {
    system_prompt?: string;
    description?: string;
    files?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  meta?: Record<string, unknown>;
  id: string;
  name: string;
  items?: { chat_ids?: string[] };
  parent_id?: string | null;
}
