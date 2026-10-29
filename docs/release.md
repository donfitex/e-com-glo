# E-com Global release procedure

## Environment boundaries

Local/test databases must be isolated names ending in `_test`; test scripts refuse production names. Never point CI test URLs at Neon production. Render staging uses the existing Neon project and Redis service configured through hosting secrets. The single staging container supervises the API, storefront and independent order worker; production should deploy web/API and worker services independently, run one explicit migration release job, and size compute/connection pools for the actual traffic. No new paid cloud service is provisioned by these commits.

General API capacity is configurable with `API_RATE_LIMIT_PER_MINUTE` (default 120); login remains independently capped at five attempts per account per 900 seconds. Browser CI uses a larger isolated general-request budget for its dense multi-user suite. API IP limits use the direct peer address until an explicitly reviewed proxy topology is configured; behind the BFF, size that shared capacity and upstream edge controls for actual storefront traffic.

The order worker uses `DATABASE_URL`, `REDIS_URL`, optional `LOG_LEVEL`, and `WORKER_POLL_INTERVAL_MS` (default 5000). It does not need JWT or Paystack credentials. Redis should use persistent storage and `noeviction`; PostgreSQL outbox recovery still protects unprocessed events if broker data disappears. Continuous worker polling consumes database compute even while customer traffic is idle.

## Before a release

1. Verify the exact `main` commit and its green GitHub Actions run. CI must pass formatting, strict types, real PostgreSQL/Redis/pgvector tests, the storefront build, browser checkout/admin/tracking tests, independent worker processing, both Docker builds and production API/worker container smoke checks.
2. Confirm the target Neon project/database and Render service in the Dashboard, without copying connection secrets into tickets or chat. Review additive migrations and take a restorable database snapshot/backup under the merchant’s retention policy.
3. Set protected environment values: pooled application `DATABASE_URL`, direct `DATABASE_URL_UNPOOLED` for migration tooling, Redis, JWT secret, exact storefront origin, approved delivery/tax/currency rules and Paystack test key. Do not reuse test credentials in production.
4. In the explicit production release job, run `prisma migrate deploy` against the direct connection using the locked CLI in the build/release tooling. Production runtime images intentionally omit development migration tools. Do not run schema push, reset, or destructive test setup against production. Stage-only startup migration behavior remains documented separately.
5. Deploy the same revision/image to API and worker. Retain the previous known-good image. The outbox migration is additive; existing orders are preserved and old orders are not given invented events or payment dates.

## Smoke checks and operations

Run `SMOKE_BASE_URL=https://e-com-global-staging.onrender.com npm run smoke:release` for read-only public readiness/catalog/search/OpenAPI checks. Supply `SMOKE_EMAIL` and `SMOKE_PASSWORD` through the secret manager for a dedicated test account to check login, the HTTP-only BFF session, account/cart/orders and logout. An administrator smoke account additionally checks protected deep health and worker heartbeat. Credentials are not printed; when absent, authenticated checks are explicitly reported skipped.

The smoke command deliberately does not purchase products or mark orders paid. For merchant payment activation, use an explicitly approved sandbox SKU/account and verify the real hosted Paystack redirect, signed webhook, server-side transaction verification, order confirmation, inventory and event processing. Callback parameters alone are not payment proof. The browser suite simulates the provider redirect; it does not claim a real merchant sandbox charge.

- `/health`: shallow process liveness.
- `/ready`: bounded database/Redis readiness; `/api/health` exposes this through the storefront.
- `/api/v1/openapi.json` (or storefront `/api/commerce/openapi.json`): OpenAPI 3.1 contract. Backend routes use JWT; browser clients use BFF cookies and Origin checks.
- `/api/v1/admin/health`: administrator-only memory usage, safe dependency timing, catalog cache counters, worker heartbeat and queue counts/oldest pending age. A missing/stale configured worker reports degraded 503. Heartbeats expire after 180 seconds. No infrastructure URLs or credentials are returned.
- `/api/v1/admin/events`: recent durable dead letters. Investigate the safe failure code and fix the handler/configuration before an authenticated `POST /api/v1/admin/events/:id/retry`.

Alert on missing worker heartbeats, growing pending age, dead letters, unavailable shared rate limits and sustained cache errors. Cache counters are per process and reset on restart. Keep processed outbox and audit retention deliberate; never delete pending events to silence an alert. Review source text/model version and run `npm run search:index` after catalog changes when semantic search is enabled; normal text search remains usable without a model.

## Rollback

Roll back application images to the previous compatible revision; do not blindly reverse migrations or restore an old snapshot after new orders/payments have arrived. Preserve current orders, payment references, outbox rows and carrier details. If rolling back before outbox support, pause checkout during the rollback or reconcile orders created without events before resuming worker processing. Workers can stop safely because work is retained in PostgreSQL and pending consumer entries are reclaimed. Validate readiness, authentication, catalog, payments and worker heartbeat after rollback. Database restore requires a separate reviewed recovery procedure that reconciles any payments received after the backup.
