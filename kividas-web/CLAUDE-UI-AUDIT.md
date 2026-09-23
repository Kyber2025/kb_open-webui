# Claude UI review — 2026-09-23

Reference: the user's signed-in Chrome at claude.ai. Read-only navigation, menus and forms; no chats sent, connectors installed, settings changed, or account data copied into the application.

## Observed interface and Kividas mapping

| Surface | Observed Claude controls | Independent Kividas implementation |
| --- | --- | --- |
| Sidebar | Home/Code, New, Projects, Artifacts, Scheduled, Customize, More, pinned chats, recents, account | Same primary hierarchy; Kividas Code downloads retained; More includes all chats and admin for authorized administrators |
| Recent conversations | Pin, rename, add to project, move to group, delete; filter/group/sort | Backend pin, rename, move to project, archive, delete; local search/name sorting; arbitrary Claude groups not available |
| Customize / Skills | Yours/Discover, search, filter, sort, Add; upload, create, create with Claude; name/description/SKILL.md editor | Real existing skills API, private create/import/edit, preserved grants, enable/disable, delete, download, use in chat; original Kividas templates; draft with Kividas opens an unsent prompt |
| Customize / Connectors | Yours/Discover directory, custom MCP connector form, categories | 12-entry curated directory, carousel, categories, search, Yours; administrator MCP verify/register/save, private grants, user OAuth authorization and chat selection; provider support required |
| Customize / Plugins | Yours/Discover directory, categories, Add | 17 public Anthropic bundles / 181 skills, detail/source/license, selected Markdown skill installation, retry, removal and custom JSON bundles; existing server extensions remain separate |
| Composer | Files/photos, screenshot, project, skills, connectors, design system, plugins, research, web search, memory; model/effort; Chat/Cowork; incognito | File upload, skills, connectors, web search, memory, temporary chats; persisted model/effort; project context through Projects; no simulated remote Cowork/browser execution |
| Model/effort | Fable/Opus/Sonnet/Haiku, More models, Low/Medium/High/Extra/Max | Actual available model catalog; Extra maps to xhigh; no invented usage multiplier |
| Projects | Search/sort, create name + description; instructions and materials | Existing folders with description and system_prompt; server applies project instructions; existing file metadata preserved |
| Artifacts | All/Yours/Shared, search, type, Docs/Slides/Design prompt entry | Search/type filters for generated code from recent 20 chats; Docs/Code/Design unsent prompt entries; downloads. No claim of Claude-hosted artifacts or slide renderer |
| Scheduled | Search, sort, new task: Create with Claude / Set up manually; name/instructions/project/model/frequency/permissions; Manual/Hourly/Daily/Weekdays/Weekly/Monthly | Existing automations API: create/edit/list/filter/paginate/pause/resume/run/history/delete; hourly/daily/weekdays/weekly/monthly, model selection, account time zone. Existing custom schedules preserved until deliberately changed |
| Settings / General | Appearance, fonts, transcript size/width, code themes, session and PR options | Light/dark, transcript size/width, keyboard shortcuts; desktop coding settings remain desktop responsibilities |
| Settings / Account | Name, personal instructions, work, avatar, sessions/devices | Existing profile and account-saved instructions; no copied Anthropic session controls |
| Settings / Privacy | Export, shared content, uploaded files, memory, training/location preferences | Own conversation JSON export and archived chat restoration. No misleading Anthropic training/privacy toggles |
| Settings / Billing & Usage | Subscription management, current/weekly/Fable limits | Kividas subscription/gift redemption and actual gateway usage windows |
| Settings / Memory | Search/history memory switches; memory topics and editing | Existing memory list/create/edit/delete; chat memory tool enabled only when server advertises it |
| Settings / Capabilities | Tools, artifact/code execution, network controls | Links to implemented skills, connectors and artifacts. Remote code execution/network sandbox requires a separate service |
| Settings / Design systems, Cowork, Chrome, Claude Code | Design systems, local devices/browser preferences, extension permissions, code authorization tokens | Kividas Code download and CLI retained. Claude's device/extension agents and services are not available from the existing web backend |

## Branding

Favicon, touch icon, sidebar, greeting and assistant avatar use the exact icon extracted from `/Applications/Kividas Code.app/Contents/Resources/kividas.icns`, matching the user's blue/purple ring reference. The application bundle was read only. No image regeneration or screenshot crop.

## Boundaries

This is original frontend code, not Claude's proprietary source. Existing backend/data remain authoritative. Skills execute through the backend's `skill_ids` handling; tools through `tool_ids`; project instructions through `folder.data.system_prompt`. Permissions continue to be enforced by the server. Admin pages remain restricted by authenticated admin role; the live server was previously observed to have more than one admin.

The local demo uses in-memory fixtures and does not execute models, scheduled work, or connector actions. Production deployment and end-to-end live backend writes are not part of this verification. Broad Claude service parity is not claimed: Cowork/Design runtime, private marketplace and plugin execution runtimes, automatic topic memory, and richer shared artifact services require additional backend work.
