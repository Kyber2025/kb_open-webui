# Subscription / USDT Billing (Kividas fork)

Adds Free/Pro/Max/Ultra **monthly subscriptions** to open-webui, paid in USDT via the
Java `payment_service`. Tiers are **admin-configurable** (allowed models, daily message
limit, price). Models are served by **KyberRouter** (the OpenAI-compatible upstream).

## Architecture

```
open-webui (this fork)                         payment_service (Java, :7120/api)
 ├─ subscription_tier      (admin config)      POST /payment/create  {orderId,chainId,amount}
 ├─ user_subscription      (who has what)        → {orderId(composite),address,qrCodeImage,status,expiresAt}
 ├─ subscription_order     (payment intents)    GET  /payment/status/{orderId(composite)}
 └─ subscription_usage_daily (metering)           → same OrderResponseDTO
        │
        └── enforcement in main.py chat_completion: tier model-allowlist + daily quota
```

Model backend = KyberRouter via `OPENAI_API_BASE_URLS`. We do **not** change routing;
we gate *which* managed models a user may call and *how many* messages/day.

## Java payment_service contract (verified from source)

- `POST {PAYMENT_SERVICE_URL}/payment/create` body `{orderId, chainId, amount}` (amount ≥ 0.000001, BigDecimal).
- `GET  {PAYMENT_SERVICE_URL}/payment/status/{orderId}`.
- Response `OrderResponseDTO`: `{orderId, chainId, amount, address, qrCodeImage, status, txHash, createTime, expiresAt}`.
  - **`orderId` in the response is COMPOSITE** = `<sent orderId>_<chainId>` (AbstractBlockchainService#createPaymentOrder).
    Store and poll with the **returned** id.
  - `status` ∈ `PENDING | PAID | EXPIRED | FAILED`.
  - `qrCodeImage` = `data:image/png;base64,...` (ready for `<img src>`).
  - `expiresAt` = create time + **24h** (`now.plusMinutes(60*24)`), formatted `yyyy-MM-dd HH:mm:ss` (India tz on the server side).
  - On error the service returns a `ResultDTO` envelope `{code,message,...}` with HTTP 200 — detect success by presence of `address`/`status`.
- chainId: **ETH=1, BSC=56, TRON=728126428** (Solana=-1, unused). Decision: multi-chain ETH/BSC/Tron.
- ⚠️ The service has a **hardcoded success callback to `https://pay.spyn.top/payin/manual/paid`** (the existing merchant). We **ignore** it and use **polling** for activation. (P4: make callback configurable / point at open-webui, requires Java rebuild.)
- ⚠️ Address index = `countPendingByChainId(chainId)+1` (HD derivation). Existing behavior; only one service instance may run network-wide (see SESSION-HANDOFF §12 ops rule).

`PAYMENT_SERVICE_URL` default = `http://172.31.1.81:7120/api` (payment node private IP, reachable from app nodes via SG :7120 from app-sg).

## Backend files

- `backend/open_webui/models/subscriptions.py` — 5 tables + Pydantic + CRUD singletons:
  `SubscriptionTiers`, `UserSubscriptions`, `SubscriptionOrders`, `SubscriptionUsage`, `GiftCards`.
- `backend/open_webui/migrations/versions/f0a1b2c3d4e5_add_subscription_tables.py` — down_revision = `461111b60977`.
- `backend/open_webui/migrations/versions/a7b8c9d0e1f2_add_gift_card_table.py` — down_revision = `f0a1b2c3d4e5` (current head).
- `backend/open_webui/utils/subscription.py` — tier resolution, enforcement, Java client (aiohttp), activation, seeding, **gift card generation + redemption**.
- `backend/open_webui/routers/subscriptions.py` — `/api/v1/subscriptions/*`.
- `backend/open_webui/config.py` — `PAYMENT_SERVICE_URL`, `SUBSCRIPTION_ENABLED` ConfigVars.
- `backend/open_webui/main.py` — import models + router include; seed tiers on startup; **enforcement** in `chat_completion` (after model_info load, ~line 1688); **visible-model filter** in `/api/models` (~line 1481).

### Tier resolution
Effective tier = active `user_subscription` (status active & `expires_at > now`, max `expires_at`); else default tier `free`. **Admins bypass all enforcement.**

### Enforcement (in `main.py chat_completion`, non-direct models, non-admin)
1. Model allow-list: if `tier.allowed_model_ids` non-empty and `model_id` not in it → **403**.
2. Daily quota: if `tier.daily_message_limit` not null and today's count ≥ limit → **429**; else increment. Day = UTC `YYYY-MM-DD`. Internal title/tag completions go through the `tasks` router, **not** counted.

## API (`/api/v1/subscriptions`)
- `GET  /tiers` (verified user) — enabled tiers for the subscription page.
- `GET  /me` (verified user) — current tier + today usage + active subscription + expiry.
- `POST /subscribe` `{tier_id, chain_id}` — creates Java order, returns `{order_id, address, qr_code_image, amount, chain_id, status, expires_at}`.
- `GET  /order/{order_id}` — polls Java; on PAID activates subscription (idempotent). Returns order + subscription state.
- `POST /redeem` `{code}` (verified user) — redeem a gift card; grants/extends the card's tier. See **Gift cards** below.
- `GET  /admin/tiers` / `POST /admin/tiers` / `POST /admin/tiers/{id}` / `DELETE /admin/tiers/{id}` (admin) — tier CRUD.
- `GET  /admin/subscriptions` (admin) — list user subscriptions (basic).
- `POST /admin/gift-cards` `{tier_id, count, duration_days?, note?}` (admin) — generate a batch of single-use codes; returns the new `GiftCardModel[]`.
- `GET  /admin/gift-cards?status_filter=&batch_id=` (admin) — recent cards (capped 500) + `{counts:{total,available,redeemed,disabled}}`.
- `POST /admin/gift-cards/{code}/status` `{enabled}` (admin) — enable/disable a code.
- `DELETE /admin/gift-cards/{code}` (admin) — delete a code.

## Frontend files
- `src/lib/apis/subscriptions/index.ts` — API client.
- `src/routes/(app)/subscription/+page.svelte` — tiers, current plan + usage bar, **redeem-a-gift-card box**, subscribe → QR + address + countdown + status poll.
- `src/lib/components/admin/Subscriptions.svelte` — per-tier config (price, daily limit, allowed models multiselect from `$models`, enabled).
- `src/lib/components/admin/GiftCards.svelte` — gift card generator + list/manage. Rendered together with `Subscriptions.svelte` from `src/routes/(app)/admin/subscriptions/+page.svelte`.
- Link to `/subscription` + remaining-quota hint in the user menu.

## Gift cards / redemption codes

Admin-generated **single-use codes** that grant a subscription tier on redemption — no payment.
Built on the same tier/`user_subscription` machinery (a redeemed card calls the same
`create_or_extend`, so it extends the same tier or supersedes another, identical to a paid order).

- **Table** `subscription_gift_card` (migration `a7b8c9d0e1f2`, down_revision `f0a1b2c3d4e5`):
  `code` (PK, canonical `XXXX-XXXX-XXXX-XXXX`), `tier_id`, `duration_days` (snapshot at generation,
  defaults to tier's), `batch_id`, `note`, `enabled`, `redeemed_by`/`redeemed_at` (NULL = unredeemed),
  `created_by`, timestamps.
- **Code format**: 4×4 groups from a no-ambiguous-character alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`
  — no `0/O/1/I/L`), generated with `secrets`. `normalize_gift_code()` canonicalizes user input
  (case, spaces, missing dashes) so redemption is forgiving.
- **Atomicity / double-spend**: `GiftCards.claim()` is a conditional `UPDATE ... WHERE code=? AND
  redeemed_by IS NULL AND enabled IS TRUE` — the DB row lock is the gate, so only one concurrent
  redeemer wins (correct on Postgres prod + SQLite tests). If the subsequent grant throws, the claim
  is **released** (`order_id` on the granted sub is `gift:<code>` for audit).
- **Logic**: `utils/subscription.py` → `generate_gift_cards()` (unique-code gen with in-memory + DB
  collision guard, batch ≤ 1000), `redeem_gift_card()` (claim → grant → release-on-failure, with
  precise 404/400 errors for invalid/disabled/already-redeemed).
- **Admin UI**: `/admin/subscriptions` now renders the plans config **and** the gift card section —
  pick a plan + quantity (+ optional duration/note) → Generate → copy-all / download-CSV the new codes;
  list with status filter + counts; enable/disable/delete.
- **User UI**: a "Redeem a gift card" box on `/subscription` (`POST /redeem`); on success the plan
  activates immediately and the page refreshes the current-plan/usage state.
- **Notes**: redemption is **not** gated on `ENABLE_SUBSCRIPTIONS` (admins can grant via codes even when
  the paid flow is off; the grant is harmless when enforcement is off and applies once it's on).
  No `main.py` change needed — the router was already included and migrations run on boot.

## Testing without the live Java service
The Java service is **stopped** (cutover pending — SESSION-HANDOFF §12). Tier enforcement +
metering + tier CRUD are testable standalone. The create/status path is tested against a
**mock** (`PAYMENT_SERVICE_URL` → local stub) until cutover. Real QR / deposit detection
needs the live sole-instance service (post-cutover, P3 verification).

## Smoke test (backend, no frontend build)

Run the modified backend inside the official v0.9.6 image (which already has all deps),
with SQLite + a throwaway payment mock — validates imports, migration, seeding, routes:

```bash
# 1) boot with this source mounted over the image's package
docker run --rm -p 8080:8080 \
  -e DATABASE_URL=sqlite:////app/backend/data/webui.db \
  -e ENABLE_SUBSCRIPTIONS=True \
  -e PAYMENT_SERVICE_URL=http://host.docker.internal:9999/api \
  -e WEBUI_SECRET_KEY=test \
  -v "$PWD/backend/open_webui:/app/backend/open_webui" \
  ghcr.io/open-webui/open-webui:v0.9.6
# 2) in logs: expect alembic 'Running upgrade ... f0a1b2c3d4e5' + 'Seeded 4 default subscription tiers', no tracebacks
# 3) routes registered:
curl -s localhost:8080/openapi.json | grep -o '/api/v1/subscriptions[^"]*' | sort -u
# 4) first signup becomes admin → token → list tiers:
#    POST /api/v1/auths/signup, then GET /api/v1/subscriptions/tiers with Bearer
```

For the full payment flow, point `PAYMENT_SERVICE_URL` at a 2-endpoint mock returning the
`OrderResponseDTO` shape (PENDING then PAID) — or the live payment_service after cutover.

## Status
**P2 DEPLOYED (2026-06-03).** Built via Jenkins `kividas-ci #14` → ECR
`kividas/openwebui:b14`; smoke-tested; rolling-deployed to kividas-1 + kividas-2 (both
healthy on the fork image). Migration applied to production RDS, 4 default tiers seeded,
subscription routes live, ALB both targets healthy, chat.kividas.com 200. Enforcement is
**live** (non-admin users default to `free` = 10 msgs/day; admins exempt).

**Gift cards DEPLOYED (2026-06-04).** Built from `feat/subscription-system` (commit
`f8a5f072d`) via Jenkins `kividas-ci #22` (build+smoke) → `#23` (DEPLOY) → ECR
`kividas/openwebui:b23`; SQLite smoke passed (migration `f0a1b2c3d4e5 → a7b8c9d0e1f2`,
table created, 4 tiers seeded, no tracebacks); rolling-deployed to kividas-1 + kividas-2.
ALB verified: `/redeem` + `/admin/gift-cards` return 401 (live; 404 on the old image), both
targets healthy. **Merged to `main`** (`12d776a00..f8a5f072d`, fast-forward) — `origin/main`
now equals `feat/subscription-system`, so default `GIT_REF=main` builds keep the gift cards.

**Still needed:** (1) admin configures the Free model allow-list + tier prices at
`/admin/subscriptions` (seeded defaults: Free model list is empty = all models allowed);
(2) **real payments require the payment_service running as the sole instance** — until the
cutover (SESSION-HANDOFF §12 P1②) the "Subscribe" flow 502s at order creation because the
payment_service is stopped. To soft-launch without enforcement, set
`ENABLE_SUBSCRIPTIONS=false`. See SESSION-HANDOFF.md §12.
