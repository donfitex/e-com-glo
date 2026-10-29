# E-com Global

A modular, multi-category e-commerce application with a **Next.js storefront and Express API** built with Node.js 22, Express, strict TypeScript, PostgreSQL/Prisma and Redis. Supports electronics, fashion, home, beauty, sports, books, groceries and toys, with category-neutral product attributes.

## Quick start

Requires Node.js 22+, npm and Docker Compose v2.

```sh
npm ci
cp .env.example .env
# Replace JWT_SECRET with a cryptographically random value (at least 32 characters).
docker compose up -d postgres redis
npm run prisma:generate
npm run prisma:migrate
npm run db:seed
npm run dev
```

The API listens on port 3000. In another terminal, start the storefront:

```sh
npm --prefix storefront ci
cp storefront/.env.example storefront/.env.local
npm run web:dev
```

Open **http://localhost:3001**. The optional sample catalog uses original local illustrations and is seeded explicitly with `ALLOW_DEMO_SEED=true npm run db:seed:demo` after `npm run db:seed`. Demo seeding is idempotent and never overwrites existing product prices or inventory.

Configure `CHECKOUT_RULES_JSON` in the root `.env` before testing checkout. Its default empty array rejects every destination. For example, this **development-only** rule charges USD 7.00 shipping and no tax; replace it with your merchant-approved policy:

```dotenv
CHECKOUT_RULES_JSON=[{"country":"US","currency":"USD","shipping":700,"taxBasisPoints":0}]
STOREFRONT_ORIGIN=http://localhost:3001
```

`GET /health` checks the process; `GET /ready` checks PostgreSQL and Redis. `.env` is ignored by Git. The supplied database password is for local development only.

Provision an administrator with `npm run admin:create`, supplying `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` through your environment or secret manager. There is deliberately no default account. Public registration always creates a customer.

## Architecture

```text
HTTP routes / validation / authentication
                 ↓
        application services
                 ↓
  catalog repository / database port
                 ↓
        Prisma → PostgreSQL
                 ↕
 Redis catalog cache and distributed rate limits
```

Modules own identity, catalog, cart and orders. The composition root (`createApp`) injects database, cache, rate limiter, password hasher, token signer, logger and readiness probes. Services implement business rules; handlers translate HTTP input/output. `Database`, `Cache`, `RateLimiter`, `PasswordHasher`, `Tokens` and `CatalogReader` define narrow contracts. `index.ts` owns connections and graceful shutdown; importing the app never opens a listener.

Checkout uses a serializable PostgreSQL transaction with bounded retries for serialization/deadlock conflicts, conditional stock decrements, immutable item snapshots and atomic cart clearing. Unique per-customer idempotency keys make retries safe; reusing a key with a different address returns 409. Unpaid cancellation follows controlled transitions and restores inventory once in the same audited transaction. Paid orders cannot be cancelled through a status shortcut. Check constraints enforce nonnegative money/stock and valid item quantities.

Money is stored in integer **minor units**: USD 1999 means $19.99; JPY 1999 means ¥1999. Supported currencies: USD, EUR, GBP, NGN, CAD, AUD, JPY and INR. A cart/order has one currency; prices are never automatically converted. Currency is immutable per SKU. Addresses use ISO-style two-letter uppercase country codes; this validates format, not delivery eligibility. Pagination is bounded to 100 rows and carts to 100 distinct products. A product may carry arbitrary string attributes such as size, material or brand; variant-specific inventory should use distinct SKUs.

## API

All business routes are under `/api/v1`. Successful responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "requestId" } }`. Validation errors include field details. Private routes require `Authorization: Bearer <accessToken>`. Tokens expire after 15 minutes and require login again; there is no refresh-token endpoint.

| Method | Path                         | Access / behavior                                                                             |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------- |
| POST   | `/auth/register`             | Public: name, email, password (12–128 characters)                                             |
| POST   | `/auth/login`                | Public: email, password                                                                       |
| GET    | `/auth/me`                   | Current account                                                                               |
| GET    | `/categories`                | Public                                                                                        |
| POST   | `/categories`                | Admin: name, unique lowercase slug                                                            |
| PATCH  | `/categories/:id`            | Admin: complete name/slug replacement                                                         |
| DELETE | `/categories/:id`            | Admin; rejects categories referenced by products                                              |
| GET    | `/products`                  | Public, paginated active products                                                             |
| GET    | `/products/:id`              | Public, active product                                                                        |
| POST   | `/products`                  | Admin: sku, name, description, price, currency, stock, categoryId; optional active/attributes |
| PATCH  | `/products/:id`              | Admin: partial product fields                                                                 |
| DELETE | `/products/:id`              | Admin: deactivate, preserving history                                                         |
| GET    | `/search?q=...`              | Public text search with filters                                                               |
| GET    | `/cart`                      | Current priced cart; reports unavailable items as conflicts                                   |
| POST   | `/cart/items`                | Set absolute quantity: productId, quantity (1–100)                                            |
| PATCH  | `/cart/items/:id`            | Set quantity; id is product UUID                                                              |
| DELETE | `/cart/items/:id`            | Remove item                                                                                   |
| DELETE | `/cart`                      | Clear cart                                                                                    |
| POST   | `/orders/quote`              | Authenticated destination-aware quote from shippingAddress                                    |
| POST   | `/orders/:id/payment`        | Current customer: create/reuse Paystack test Checkout session                                 |
| POST   | `/payments/paystack/webhook` | Public raw-body endpoint, verified Paystack signature required                                |
| GET    | `/admin/products`            | Admin: all products, including inactive products                                              |
| GET    | `/orders/preview`            | Current authoritative cart quote                                                              |
| POST   | `/orders/checkout`           | Checkout with shippingAddress and Idempotency-Key header                                      |
| GET    | `/orders`                    | Current customer's paginated history                                                          |
| GET    | `/orders/:id`                | Current customer's order with snapshots                                                       |
| GET    | `/admin/orders`              | Admin; optional status and pagination                                                         |
| PATCH  | `/admin/orders/:id/status`   | Admin: status                                                                                 |

Product/search filters: `categoryId`, `currency`, `minPrice`, `maxPrice`, `available=true|false`, `q`, `page`, `limit`, `sort=newest|price_asc|price_desc|name`. Prices use minor units. Sorting uses an ID tiebreaker. Category reads are ordered by slug. Products are fetched with their categories to avoid N+1 reads.

Example checkout body (prices and totals are deliberately rejected):

```json
{
  "shippingAddress": {
    "name": "Global Buyer",
    "email": "buyer@example.com",
    "phone": "+2348012345678",
    "line1": "10 Market Road",
    "city": "Lagos",
    "postalCode": "100001",
    "country": "NG"
  }
}
```

Send a unique `Idempotency-Key` of 8–100 letters, digits, underscores or hyphens and retain it for retries. Replaying a key returns its original order. A verified paid Paystack notification moves `PENDING → CONFIRMED`; administrators can then move `CONFIRMED → SHIPPED → DELIVERED`. Unpaid pending orders may be cancelled. Paid cancellations require a separate verified refund process. Terminal statuses cannot transition further.

## Verification

```sh
npm run check
npm run format:check
```

Without `TEST_DATABASE_URL`, integration tests are explicitly skipped. To run the full suite, create an isolated test database:

```sh
docker compose exec postgres createdb -U ecom ecom_test
DATABASE_URL=postgresql://ecom:local-development-only@localhost:5432/ecom_test npm run prisma:migrate
TEST_DATABASE_URL=postgresql://ecom:local-development-only@localhost:5432/ecom_test npm test
```

Tests intentionally delete data in the selected test database and flush the Redis database selected by `TEST_REDIS_URL` (default `redis://localhost:6379/15`). Never point these at shared services. The test database name must end in `_test`. Tests cover duplicate registration, JWTs/passwords, authorization, validation, catalog filters, mixed currencies, authoritative prices, stock rollback, parallel checkouts, idempotency, order ownership, cancellation, caching and distributed limits.

## Operations

`docker compose up -d postgres redis` provides local infrastructure. Apply migrations before starting the app image with `npm run prisma:migrate`; the runtime image intentionally excludes migration tooling. Then `docker compose up -d --build api`. In a proxy-managed environment, use `docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t e-com-global .` to pass the session CA without baking it into an image. Standard environments need no build secret.

CI runs lint, formatting, typecheck, real PostgreSQL/Redis tests, build and Docker image validation. A staging container and Render Blueprint are provided; deployment requires applying the Blueprint and configuring merchant/payment secrets. The Docker runtime is non-root and shuts down within 10 seconds after SIGTERM/SIGINT.

Security headers, a 64 KB payload limit, strict write schemas, allowlisted CORS origins and centralized redacted errors apply globally. Rate limits use atomic Redis counters (120 API requests, 10 authentication requests, 30 searches per minute per source IP). Rate limiting fails closed with 503 when Redis is unavailable. Catalog cache failures fall back to PostgreSQL; TTL is 30 seconds. Writes advance a cache-generation token; in-flight old reads cannot repopulate the current generation. A failed invalidation may leave stale public reads for up to the TTL; checkout always reads PostgreSQL directly.

Trust proxy is disabled by default to prevent forged forwarding headers. Behind a trusted reverse proxy, configure a reviewed subnet/hop policy in `createApp` before enabling it; otherwise clients share the proxy's rate bucket. CORS is a browser policy, not an authorization mechanism. Logs contain generated request IDs, method, path, status and duration, without bodies, query strings, passwords or tokens. Audit records store privileged changes and order transitions. Short-lived role claims remain valid until expiry; immediate revocation requires a token-version/session mechanism.

Use managed database backups and point-in-time recovery; rehearse restore procedures and choose explicit RPO/RTO targets. Roll back application images independently; database changes should use forward-compatible expand/contract migrations, with a backup before destructive changes. Run ANALYZE/EXPLAIN against representative catalog queries before adding indexes; substring text search may need trigram/full-text indexing at scale. Monitor readiness, 5xx, transaction conflicts, Redis latency, cache effectiveness and checkout latency. Place TLS at the ingress and inject production secrets through the host secret manager.

## Scope and extension points

The storefront and API support **Paystack test-mode** checkout, signed payment notifications, destination-based shipping/tax rules and expiring stock reservations. Live Paystack keys are intentionally rejected. Refund execution, automated jurisdiction-aware tax services, live carrier quotes, FX conversion and merchant legal/support policies remain separate integrations. The shipping/tax engine is explicit merchant configuration, not a tax-compliance service. Hosting configuration is provided below; a Blueprint file alone is not a live deployment.

## Optional local semantic discovery

Text search works by default without a model. For semantic search, run PostgreSQL with **pgvector** installed (for example `pgvector/pgvector:pg16`), apply `scripts/search-index.sql` explicitly to the same database, and run the optional Python service under `embeddings/`. It uses the free local `sentence-transformers/all-MiniLM-L6-v2` model; no paid API or API key is involved.

Pre-download that model through your approved model-distribution process, then supply its local directory through `MODEL_PATH`. The service deliberately uses `local_files_only=True`; it never fetches a model during requests.

```sh
python -m venv work/embedding-venv
work/embedding-venv/bin/pip install -r embeddings/requirements.txt
MODEL_PATH=/path/to/local/all-MiniLM-L6-v2 work/embedding-venv/bin/uvicorn embeddings.server:app --host 127.0.0.1 --port 8000
# In another terminal, configure SEMANTIC_SEARCH_URL=http://127.0.0.1:8000 in .env.
npm run search:index
```

The reindex command processes active products in batches of 100, storing model identity and the source text alongside 384-dimensional vectors. Run it after product text changes and when adding products. Changing models requires coordinated service/index changes and a complete reindex. The semantic reader excludes stale text snapshots and inactive products, applies catalog filters and a 0.35 cosine-similarity threshold, and returns relevance order. Explicit price/name sorts use normal catalog search. HNSW provides a vector index; benchmark selective category/filter workloads before scaling it.

Missing vectors, unavailable models, missing pgvector, timeouts, or no relevant matches fall back to normal text search. The embedding request timeout is two seconds. Semantic and text modes are reported in the response metadata. Keep the embedding service private; it has no public authentication layer. Its model execution requires a separately provisioned model artifact; the unit tests exercise provider selection and outage fallback without downloading a model.

## Storefront and session boundary

`storefront/` is a separate, locked Next.js 16 / React 19 project. Public catalog pages render on the server; account, cart, checkout and admin interactions use a same-origin backend-for-frontend under `/api/commerce`. Successful sign-in stores the API access token in an HTTP-only, SameSite=Lax cookie, secure in production, and strips it from the browser response. Tokens are never stored in localStorage. Mutations require an exact matching Origin; set `STOREFRONT_ORIGIN` to the deployed HTTPS origin, without a trailing slash. `COMMERCE_API_URL` is server-only and points to the API, not the storefront. Expired sessions require sign-in again.

The storefront includes a responsive homepage, category/currency filters, text/optional semantic search, product pages, cart quantity/removal, address quotes, checkout, payment handoff, paginated order history and admin category/product/inventory/order tools. API authorization remains authoritative. Admins upload real product photos from their device; the demo illustration selector is removed. New products default to NGN and appear in their selected category as soon as they are saved with store visibility enabled. The category link on the saved-product notice includes the SKU currency. Existing demo illustrations remain only for previously seeded products.

## Shipping, tax and Paystack test setup

Each `CHECKOUT_RULES_JSON` entry supplies `country`, `currency`, `shipping` in minor units and `taxBasisPoints` (750 = 7.5%). Optional `freeShippingAbove` makes delivery free at or above that merchandise subtotal. Tax is exclusive and applies to merchandise only, rounded once per order; shipping is not taxed by this policy. Duplicate destination/currency rules are rejected. Unsupported destinations fail with 422. The storefront sends the quoted total and rule version; checkout recomputes both and rejects changed quotes rather than charging silently changed totals.

Configure these values directly in the API host's secret manager:

- `PAYSTACK_SECRET_KEY`: a Paystack **test** secret key (`sk_test_…`).
- `STOREFRONT_ORIGIN`: the exact storefront HTTPS origin.

For a separately hosted API, register `/api/v1/payments/paystack/webhook` on its public origin. The combined staging container exposes that endpoint at **`/api/payments/paystack/webhook`** on the storefront origin. Configure a test-mode Paystack webhook for `charge.success`. Forwarding preserves the exact raw body and `x-paystack-signature`. The server validates HMAC-SHA512 with `PAYSTACK_SECRET_KEY`, then verifies the transaction with Paystack before changing order state.

Checkout creates an unpaid pending order and reserves its inventory for one hour. Paystack checkout can be initialized until the local reservation deadline. Initialization is serialized per order, uses a deterministic reference, and stores the authorization URL for repeat requests. Paystack does not expose the previous provider's checkout-session expiration API; expired/cancelled local orders therefore cannot be assumed to have disabled hosted links. A return URL never confirms payment: verified, deduplicated notifications must match the stored amount, currency and session. A notification after inventory was released sets `REFUND_REQUIRED` and does not fulfill the order. Paid-order refunds need the separate refund workflow.

The running API expires unpaid reservations in batches of 100 once per minute, with transactional protection across instances. A paused/free-tier service cannot sweep while asleep; overdue reservations are processed after it wakes. Paystack checkout remains unavailable with a clear 503 response until the test secret is configured. Local tests verify Paystack HMAC signatures, mocked transaction initialization/server verification and simulated provider events; they do not charge a card or claim live Paystack integration verification.

## Browser verification

```sh
npm run web:typecheck
npm run web:build
```

Browser tests require an isolated `_test` database, migrated and seeded with the demo catalog, and the API/storefront pointed to that same database. The test API needs the development US/USD rule shown above. Tests create test accounts, orders and catalog records. They must never run against customer databases.

```sh
# With the API on :3000 and storefront on :3001 already running:
E2E_DATABASE_URL=postgresql://ecom:local-development-only@localhost:5432/ecom_e2e_test npm run web:test:e2e
# Optional: use an installed Chromium instead of Playwright's downloaded browser.
CHROMIUM_PATH=/usr/bin/chromium E2E_DATABASE_URL=postgresql://ecom:local-development-only@localhost:5432/ecom_e2e_test npm run web:test:e2e
```

CI prepares an isolated browser database, installs Chromium, starts the API and storefront, and exercises registration, purchase discovery, cart, quotes, unpaid-order creation, missing-payment configuration, order ownership, mobile navigation, admin inventory changes and CSRF rejection. It also runs the PostgreSQL/Redis/pgvector tests, both TypeScript builds and both Docker builds.

## Neon project setup

The repository includes `neon.ts` for PostgreSQL only. Prisma remains the database client for the long-running Node API; authentication remains in the application. The local `.neon` project link and all environment files are ignored by Git.

```bash
npm i -g neon@latest
neon login
neon init -y --org-id org-steep-field-51623490 --project-id twilight-silence-41750490 --branch production --services postgres
neon deploy
```

Complete browser sign-in when prompted. Deployment retrieves the existing database connection settings into `.env` (or `.env.local` when `.env` does not exist). This repository uses dotenv's `.env` loading by default: if the CLI writes `.env.local`, start commands with `DOTENV_CONFIG_PATH=.env.local`. Preserve the other required API settings, including Redis and JWT configuration. Never commit or paste connection secrets.

Use pooled `DATABASE_URL` for the API and direct `DATABASE_URL_UNPOOLED` for migrations. The staging launcher selects the direct URL for `prisma migrate deploy` automatically. For manual migrations, inject the direct URL as `DATABASE_URL` through your secret manager or shell environment. `neon deploy` provisions Neon configuration; it does not replace Prisma migrations or deploy the frontend/API to Render.

## Staging deployment

`Dockerfile.staging` combines the Next.js standalone server and API in a single non-root container. The API listens on loopback-targeted port 3010 for the storefront; Next.js listens on the host's `PORT` (default 10000). `/api/health` checks API/database/Redis readiness. The launcher handles child shutdown, applies committed migrations and seeds categories. Demo products require `ALLOW_DEMO_SEED=true`. This bootstrap is intended for **one staging replica**; production should run migrations as a separate release job and scale the API and storefront independently.

`render.yaml` proposes one free Docker web service and Redis-compatible Key Value in Oregon, with PostgreSQL hosted separately on Neon. It does not create a Render PostgreSQL instance. The web process derives its public origin from Render's `RENDER_EXTERNAL_URL`. Redis uses a private Blueprint reference; Neon credentials are entered as secrets. Free-plan availability and retention limits must be checked in the target workspace.

Deploy from the committed `main` branch using:

**https://dashboard.render.com/blueprint/new?repo=https://github.com/donfitex/e-com-glo**

Review the services and plan availability. In your existing Neon `e-com-glo` project (`twilight-silence-41750490`), select the `production` database branch and open **Connect**. Enter its pooled connection string as Render `DATABASE_URL`, and its direct connection string (pooling disabled) as `DATABASE_URL_UNPOOLED`. Keep `sslmode=require` on both. The launcher uses the direct URL only for Prisma migrations; application traffic and seeds use the pooled URL. For a small instance, append `&connection_limit=5&pool_timeout=20&connect_timeout=15` to the pooled URL to bound the Prisma pool and allow Neon wake-up time. Enter the merchant-approved `CHECKOUT_RULES_JSON`, then Apply the Blueprint. This configuration is a deployment draft until Render validates it: the execution environment blocked current Render documentation/schema retrieval, and CLI platform validation requires a confirmed workspace and CLI authentication. No cloud resources are created merely by committing these files.

After deployment, configure the Paystack test secret in the web service's secret settings and register the webhook URL above. To provision the first administrator without a shared default account, configure `ADMIN_EMAIL`, `ADMIN_NAME`, and a strong `ADMIN_PASSWORD` in the staging secret settings, redeploy once, then remove the provisioning values. Restarts do not reset an existing administrator's password or promote an existing customer account. Never commit these values or put them in browser-visible variables.

For a local staging-image check, build with `docker build -f Dockerfile.staging -t e-com-global:staging .` and supply `DATABASE_URL`, optionally `DATABASE_URL_UNPOOLED` (required for Neon migrations), `REDIS_URL`, `JWT_SECRET`, `CHECKOUT_RULES_JSON` and `STOREFRONT_ORIGIN` through an ignored env file or the container host's secret settings. In a managed proxy environment, add `--secret id=proxy_ca,src="$CODEX_PROXY_CERT"`. Verify `/api/health`, register a test customer, and exercise checkout before considering the staging deployment healthy.

### Paystack currency and migration notes

`PAYSTACK_SECRET_KEY` is server-only, must be a test key (`sk_test_…`), and is also the HMAC webhook-verification key. No separate webhook secret or browser public key is needed for hosted Checkout. Set it in the API/staging host’s secret manager, never in a `NEXT_PUBLIC_` variable. `PAYSTACK_CURRENCIES` defaults to `NGN`; set `NGN,USD` only if USD collection is approved for your merchant account. Other catalog currencies remain available for browsing but cannot be paid through this gateway. Amounts are integer kobo/cents supplied by the server, and the customer email comes from the authenticated account.

The storefront defaults to NGN (`DEFAULT_CURRENCY=NGN`), and the opt-in demo seed now adds explicitly priced NGN SKUs alongside existing USD products. These are sample prices, not FX conversion. Existing merchant prices and inventory are never overwritten. Shipping/tax rules must explicitly cover the intended country and currency; for example, use country `NG` and currency `NGN` for a Nigeria delivery policy with merchant-approved amounts and rates.

Migration `202610290003_paystack` renames legacy provider-specific payment fields and preserves historical transaction identifiers. Existing orders with previous-provider references are marked as legacy and cannot initialize a new Paystack payment; unpaid legacy orders should be cancelled and reordered. Previously paid history is retained. The old webhook routes and credentials are no longer active.

A successful callback is never proof of payment. The payment screen refreshes status after a Paystack return, but only verified provider notifications can confirm a positive-value order. Server-calculated zero-total orders are confirmed locally without a provider charge. If initialization succeeds at Paystack but its response is lost before the database commits, the deterministic reference prevents a second initialization from creating a duplicate transaction; that rare incomplete setup may require cancellation/reordering after review. Late payments after stock release remain `REFUND_REQUIRED`; automatic refunds are outside this release.

Official integration references: https://paystack.com/docs/api/transaction/ and https://paystack.com/docs/payments/webhooks/. Documentation retrieval was blocked by this workspace’s network policy; tests use provider-contract fixtures and do not claim an authenticated Paystack sandbox transaction. Configure the test key and exercise a sandbox checkout/webhook before activation.

### Merchant product photos

Admin product creation requires a JPEG, PNG or WebP photo (maximum 3 MB, 20 megapixels). The API enforces administrator access, upload rate limits and decoded-image validation, strips metadata, and resizes to at most 1600 × 1600 before storing WebP bytes (maximum 1 MB each) in Neon’s `ProductImage` table. Immutable public image URLs are served through `/api/media/:id`. This avoids ephemeral Render disk storage and requires no extra image-host credentials. The image module isolates persistence so a large catalog can move binary storage to an object store/CDN later; database storage and backups currently include these photos. Uploaded assets are retained when replaced, so failed or repeated saves can leave unused images; automatic cleanup is not included.

Product/category writes invalidate Redis catalog caches and Next.js route caches. Fresh category and homepage visits read the new catalog immediately; already-open customer pages update on navigation/reload. Each product is listed only in its chosen currency; publishing a USD SKU does not create an NGN price or perform FX conversion.

### Hosted payment redirect and session recovery

Placing a positive-value order initializes checkout on the server and redirects directly to `https://checkout.paystack.com`. If initialization fails, the saved unpaid order opens on the retry page; it is not placed again. Expired sessions return to sign-in with the existing order ID preserved. After sign-in, the customer can continue payment for that order. The retry page validates the hosted payment destination before navigating.

For the current staging deployment, use these Paystack **test-mode** dashboard values:

- Webhook: `https://e-com-global-staging.onrender.com/api/payments/paystack/webhook`
- Callback: `https://e-com-global-staging.onrender.com/checkout/payment`

Each initialization sends its own order-specific callback, adding `?order=<id>`. The callback alone never confirms payment; signed notifications plus server-side transaction verification remain required. Redirect browser tests simulate the Paystack destination; authenticated merchant sandbox payment verification still requires the configured test secret and a real sandbox checkout.

Checkout requires a contact email and international phone number alongside the shipping address. Email is prefilled from the signed-in account and can be changed for that order. Phone numbers require a leading country code (for example `+2348012345678`); spaces, parentheses and hyphens are normalized before storage. The saved contact email is sent to Paystack for the transaction. Older orders without contact fields remain readable and use the account email for payment initialization. Order contact details are visible only to the order owner and authorized administrators.

Checkout lists delivery countries from the server’s configured country/currency pairs, filtered to the bag’s currency. An empty `CHECKOUT_RULES_JSON` enables no delivery destinations; matching the country alone is insufficient. For Nigeria/NGN **test-mode staging only**, explicitly configure `[{"country":"NG","currency":"NGN","shipping":0,"taxBasisPoints":0}]` in Render, save, and redeploy. This means free shipping and zero tax for testing, not a production rate recommendation. Replace the amounts with approved merchant rates before live payments. `shipping` is in kobo for NGN (for example `250000` means ₦2,500), and `taxBasisPoints` uses hundredths of a percent. Country and currency codes are trimmed and normalized to uppercase on startup; unsupported pairs still fail closed, with the actual pair included in the error.

### Delivery estimates and order tracking

Delivery rules optionally accept `deliveryMinDays` and `deliveryMaxDays` (calendar days, 0–180; maximum must be at least minimum). Existing rules use an estimated **3–7 calendar days**. For example, the Nigeria/NGN test rule can be `[{"country":"NG","currency":"NGN","shipping":0,"taxBasisPoints":0,"deliveryMinDays":3,"deliveryMaxDays":7}]`. Rates remain merchant configuration; changing the window does not change shipping charges.

Checkout displays the shipping window and snapshots it onto the order. Only server-verified payment confirmation (or a server-priced free order) records `paidAt` and calculates the estimated arrival dates. A browser callback alone cannot do this. Replayed notifications do not change the payment timestamp or arrival window. Estimates use UTC calendar-day arithmetic, not business days, holiday calculations, or carrier promises.

Buyers open **My account → Orders & tracking → Track order & view details**. Paid orders show **Payment confirmed — awaiting delivery**, followed by shipment status, estimated arrival dates, optional courier/tracking details, and an order timeline. A carrier link opens separately; the app does not fetch or claim live courier locations. The detail page refreshes while visible every 30 seconds and on window focus, with a manual refresh button. Completed/cancelled orders stop automatic polling.

In **Admin → Orders**, an administrator can save a delivery partner, tracking number, HTTPS carrier link, and expected delivery date for a paid order awaiting delivery. `PATCH /api/v1/admin/orders/:id/shipment` accepts these details (`expectedDeliveryDate` uses `YYYY-MM-DD`). Setting an expected date narrows the estimate to that date; past dates are rejected. Administrators use **Mark as shipped**, then **Mark as delivered**. These actions record immutable milestone timestamps and audit events. Customers cannot edit fulfillment; unpaid orders cannot be shipped; terminal orders cannot be marked delivered again or have shipment details rewritten. Delivery status is an administrator-recorded fulfillment event, not proof of carrier API confirmation.

Migration `202610290005_order_tracking` adds the shipment fields without inventing dates for historical payments. Existing paid orders keep their status; an administrator can supply an expected delivery date if their estimate is missing. The staging launcher applies this committed migration on deployment.
