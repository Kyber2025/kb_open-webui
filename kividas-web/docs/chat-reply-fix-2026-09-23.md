# Saved chat reply repair — 2026-09-23

Runtime source: `949538fbba442a2182df8522b59ba049c0f175e3`.

Saved conversations include `chat_id` and `id`. The existing backend therefore consumes the provider stream, emits Socket.IO events, persists the answer, and returns JSON `null` after processing. Omitting `session_id` does not switch those conversations to direct SSE. The initial independent client only consumed SSE/JSON choices, missed the real answer, then saved its empty placeholder over the server message.

The independent client now authenticates its event listener before generation, filters by chat and message ID, handles full content snapshots and deltas, and recovers the canonical saved message after the synchronous HTTP acknowledgement. It retains server message metadata and stores errors in history so navigation cannot hide failures. Guest and temporary conversations retain their direct SSE path. The socket is released after completion, errors, or cancellation.

Validation:

- 73 tests passed; TypeScript and production build passed.
- Regression coverage includes live snapshots with a null acknowledgement, missed-socket recovery, provider errors, empty replies, cleanup on abort, persisted errors, and guest/temporary SSE.
- In the user's authenticated production Chrome session, a Max 10x account with Opus 5.5 / Max received `连接正常`, then `4` for a second turn asking for 2+2.
- Reloading that conversation retained both prompts and both answers.

The frontend release inherits the existing production backend and overlays static files. It preserves prior hashed resources for tabs open during the rolling update. Database schemas, subscriptions, roles, credentials, and chat records are not migrated by this release.
