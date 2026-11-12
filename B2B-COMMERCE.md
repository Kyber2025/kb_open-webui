# Internal ToB commerce

`/api/v1/commerce/b2b` is a service-to-service API for the independent agent-platform
company/sales/reseller tree. It does not accept customer JWTs or browser-supplied
prices. Set `B2B_COMMERCE_SECRET` to the same securely provisioned value as the agent
backend (at least 32 characters). The signature covers method, path, timestamp,
nonce, and SHA-256 of the exact body; HTTPS is required by the caller.

New Alembic revision `f7b8c9d0e1f2` adds checkout linkage, card ownership and transfer
history. All sources share the existing tier lock and stock holds. `b2b` purchases
reuse signed merchant validation, callbacks and reconciliation; fulfilled card
ownership is committed with issuance. `b2b_manual` is an explicit free gift from
the platform to a company, consuming capacity without creating an invoice.

Endpoints: catalog, create/read/cancel purchase, read terminal-state snapshot,
manual issue, inventory, transfer, transfer report and verified-paid recovery.
The agent backend enforces company, ancestor, membership and role scope and takes
all buyer IDs/prices from its own database. Do not expose the service key to clients.

Inventory only returns plaintext codes on an explicit authorized request. Transfer
reports always return opaque card references and original external order IDs;
unit price, amount and collected amount are zero. Original purchase money remains
on its original transaction. Company transfers never generate cards or commissions.

Cancelled/expired late-paid orders require administrator recovery. Recovery
rechecks signed paid evidence and stock before restoring a hold and delivering;
B2B does not need a fictitious ToC User row. Source remains `b2b`, so ownership is
attached and original agent-side price snapshots drive proceeds once fulfilled.
No automatic chain payout, refund or new Telegram notification is performed here.

Verification: `backend/tests/test_b2b_commerce.py` uses a disposable loopback
Postgres database named `owui_subscription_test` and mocked payment/capacity services.
Run with existing `test_reseller_commerce`, `test_subscription_payments` and
`test_commerce_notifications` suites. These tests clear the disposable database;
never point them at production. Agent UI, role and price tests live in agent-platform.

Rollout: migrate/publish this service first on both application nodes, then publish
agent-platform. Preserve all existing payment/JWT credentials. Rollback must retain
B2B tables and continue reconciliation for any already issued payment addresses.
