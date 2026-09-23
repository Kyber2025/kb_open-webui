# Existing backend contract

All calls are same-origin, use `credentials: include`, and send the existing bearer session token when available. Guest calls also send the persistent `X-Guest-Device-Id`. Provider credentials remain on the backend.

| Capability | Method and path |
| --- | --- |
| Configuration | GET `/api/config` |
| Session | GET `/api/v1/auths/` |
| Login / guest | POST `/api/v1/auths/signin`, POST `/api/v1/auths/guest` |
| Logout | POST `/api/v1/auths/signout` |
| Accessible models | GET `/api/models` → `{data: Model[]}` |
| Stream chat | POST `/api/chat/completions`; saved chats use authenticated Socket.IO `events`, guest/temporary chats use OpenAI-compatible SSE |
| History | GET `/api/v1/chats/`, GET `/api/v1/chats/search`, GET `/api/v1/chats/:id` |
| Save history | POST `/api/v1/chats/new` or POST `/api/v1/chats/:id` |
| Projects | GET/POST `/api/v1/folders/`, GET `/api/v1/chats/folder/:id` |
| Documents | POST `/api/v1/files/?process=true`, GET `/api/v1/files/:id/process/status?stream=true` |
| Admin models | GET `/api/v1/subscriptions/admin/models` (full catalog, not admin's personal model allow-list) |
| Plans | GET/POST `/api/v1/subscriptions/admin/tiers`, DELETE `/api/v1/subscriptions/admin/tiers/:id` |
| Default plans | POST `/api/v1/subscriptions/admin/seed` |
| Gift list / generation | GET/POST `/api/v1/subscriptions/admin/gift-cards` |
| Gift enablement | POST `/api/v1/subscriptions/admin/gift-cards/:code/status` with `{enabled}` |
| Gift revocation | POST `/api/v1/subscriptions/admin/gift-cards/:code/invalidate` |
| Gift deletion | DELETE `/api/v1/subscriptions/admin/gift-cards/:code` |
| Guest policy | GET/POST `/api/v1/guest/config` |
| IP blacklist | GET/POST `/api/v1/guest/blacklist`, DELETE `/api/v1/guest/blacklist/:ip` |
| User plan / redemption | GET `/api/v1/subscriptions/me`, POST `/api/v1/subscriptions/redeem` |

Plan fields: `id`, `name`, `description`, `price_usd`, `duration_days`, `token_limit_5h`, `token_limit_week`, `extra_usage_multiplier`, `allowed_model_ids`, `enabled`, `sort_order`.

Guest policy fields: `ENABLE_GUEST_ACCESS`, `GUEST_DAILY_LIMIT`, `GUEST_ALLOWED_MODEL_IDS`, `GUEST_BLOCKED_MODEL_IDS`.

Gift list query: `status_filter` and `search` run on the server so codes outside the newest 500 can be located. Plan and duration filters run on returned records. A redeemed disabled card is displayed as invalidated. Invalidation and disablement remain different operations.

Conversation persistence writes the existing history shape (`history.messages`, `history.currentId`, `messages`, `models`, `title`). Alternative branches are retained. Saved chats include `chat_id` and `id`, which select the backend event pipeline even without `session_id`. The client subscribes to `/ws/socket.io` before generation and filters events by both IDs. No `session_id` is sent: the HTTP request waits for processing, then returns JSON `null`. The client reads the canonical saved message after that acknowledgement, recovering from missed socket events and retaining provider errors. Guest and temporary requests omit the chat/message IDs and receive direct SSE. Errors are persisted and displayed after navigation.

## Additional retained surfaces

| Capability | Method and path |
| --- | --- |
| Desktop / CLI downloads | GET `/api/v1/code/latest`, GET `/api/v1/code/cli` |
| User list | GET `/api/v1/users/?page=&query=&order_by=&direction=` (30 per page) |
| User creation / editing | POST `/api/v1/auths/add`, POST `/api/v1/users/:id/update` |
| Ban / unban | POST `/api/v1/users/:id/ban` with `{banned, reason}` |
| User deletion | DELETE `/api/v1/users/:id` |
| User plan and usage snapshot | POST `/api/v1/subscriptions/admin/users/overview` with `{user_ids}` |
| Grant / revoke user plan | POST/DELETE `/api/v1/subscriptions/admin/users/:id/subscription` |
| Usage reset | POST `/api/v1/subscriptions/admin/users/:id/usage/reset` with `{windows: ['5h'|'week'|'fable']}` |
| User access preview | GET `/api/v1/users/:id/preview` |
| User chats | GET `/api/v1/chats/list/user/:id?page=&query=&order_by=updated_at&direction=desc` |

The `rate_limits_synced: false` result is displayed as a partial failure when token billing and a wallet link are active. User creation does not replace the signed-in administrator's token. Password changes and bans use existing backend synchronization rather than client-only changes.

Effort is sent as `params.reasoning_effort` (`low`, `medium`, `high`, `xhigh`, `max`) and saved in the conversation's `params`. The existing backend flattens params into the upstream request; the selected provider must support the requested level. No provider behavior or billing multiplier is fabricated.

## Customize, organization, schedules and preferences

- Skills: `GET /api/v1/skills/`, `GET /api/v1/skills/id/{id}`, `POST /api/v1/skills/create`, `POST /api/v1/skills/id/{id}/update`, `POST .../toggle`, `DELETE .../delete`. Preserve `access_grants` and tags on edits. Pass authorized enabled `skill_ids` to completion and saved chat data.
- Connectors: `GET /api/v1/tools/`; select authorized `tool_ids` in chat. Admin setup uses GET/POST `/api/v1/configs/tool_servers`, POST `/api/v1/configs/tool_servers/verify`, POST `/api/v1/configs/oauth/clients/register?type=mcp`. Preserve all existing connection entries and unknown fields. New connection access grants are private to the administrator. OAuth authorization uses the same-origin `/oauth/clients/{client_id}/authorize` cookie flow, without tokens in URLs. The existing full-list configuration endpoint has no compare-and-swap; concurrent administrators should avoid simultaneous configuration edits.
- Plugins: static public catalog `/catalog/plugins/index.json` and individual bundles. Installation creates private skills via existing skills endpoints, with UUID IDs and component/provenance tags in `meta.tags`; partial retry skips already installed components. Uninstall only selects the current user's tagged skills. Imported JSON bundles are reconstructed from saved skills after refresh. `/api/v1/functions/` remains a separate server extensions list, not a plugin installer.
- Schedules: `/api/v1/automations/list`, `/create`, `/{id}/update`, `/{id}/toggle`, `/{id}/run`, `/{id}/runs`, `DELETE /{id}/delete`. Data contains `prompt`, `model_id`, `rrule`; preserve meta, terminal configuration and existing recurrence when editing unrelated fields. Server evaluates recurrence in account time zone. Timestamps are nanoseconds.
- Organization: `/api/v1/chats/pinned`, `/{id}/pin`, `/{id}/archive`, `/{id}/folder`. Rename sends only `{chat:{title}}`; backend merges without dropping history. Project detail `/api/v1/folders/{id}` and update `/{id}/update`; `data.system_prompt` is applied server-side. Preserve existing files and metadata.
- Preferences: `/api/v1/users/user/settings` and `/user/settings/update`, preserving unrelated fields. Profile `/api/v1/auths/update/profile`. Personal `ui.system` enters completion as a system message, because backend strips `params.system`.
- Memory: `/api/v1/memories/`, `/add`, `/{id}/update`, `DELETE /{id}`; chat `features.memory` only offered when enabled in config.
- Usage: `/api/v1/kyber/usage/limits`; display actual tp5h/tpw/tpwFable values and unavailable state rather than fabricated zero usage.

## 网页订阅 Claude 路由

前端统一使用现有聊天接口，套餐选择由网关认证和数据库决定，不在浏览器判断并拼接上游地址。`openrouter-ai-project/backend/src/services/webChatTransport.ts` 将有效固定订阅的网页请求接到桌面端使用的 native-seat 通道；免费/到期用户继续使用 CometAPI。须部署该网关改动后线上才生效；详情见网关 `docs/web-subscription-native-routing.md`。
