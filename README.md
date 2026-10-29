# E-com Global

A modular, multi-category e-commerce **backend API** built with Node.js 22, Express, strict TypeScript, PostgreSQL/Prisma and Redis. Supports electronics, fashion, home, beauty, sports, books, groceries and toys, with category-neutral product attributes.

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

The API listens on port 3000. `GET /health` checks the process; `GET /ready` checks PostgreSQL and Redis. `.env` is ignored by Git. The supplied database password is for local development only.

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

Checkout uses a serializable PostgreSQL transaction with bounded retries for serialization/deadlock conflicts, conditional stock decrements, immutable item snapshots and atomic cart clearing. Unique per-customer idempotency keys make retries safe; reusing a key with a different address returns 409. Cancellation follows controlled transitions and restores inventory once in the same audited transaction. Check constraints enforce nonnegative money/stock and valid item quantities.

Money is stored in integer **minor units**: USD 1999 means $19.99; JPY 1999 means ¥1999. Supported currencies: USD, EUR, GBP, NGN, CAD, AUD, JPY and INR. A cart/order has one currency; prices are never automatically converted. Currency is immutable per SKU. Addresses use ISO-style two-letter uppercase country codes; this validates format, not delivery eligibility. Pagination is bounded to 100 rows and carts to 100 distinct products. A product may carry arbitrary string attributes such as size, material or brand; variant-specific inventory should use distinct SKUs.

## API

All business routes are under `/api/v1`. Successful responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "requestId" } }`. Validation errors include field details. Private routes require `Authorization: Bearer <accessToken>`. Tokens expire after 15 minutes and require login again; there is no refresh-token endpoint.

| Method | Path                       | Access / behavior                                                                             |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------- |
| POST   | `/auth/register`           | Public: name, email, password (12–128 characters)                                             |
| POST   | `/auth/login`              | Public: email, password                                                                       |
| GET    | `/auth/me`                 | Current account                                                                               |
| GET    | `/categories`              | Public                                                                                        |
| POST   | `/categories`              | Admin: name, unique lowercase slug                                                            |
| PATCH  | `/categories/:id`          | Admin: complete name/slug replacement                                                         |
| DELETE | `/categories/:id`          | Admin; rejects categories referenced by products                                              |
| GET    | `/products`                | Public, paginated active products                                                             |
| GET    | `/products/:id`            | Public, active product                                                                        |
| POST   | `/products`                | Admin: sku, name, description, price, currency, stock, categoryId; optional active/attributes |
| PATCH  | `/products/:id`            | Admin: partial product fields                                                                 |
| DELETE | `/products/:id`            | Admin: deactivate, preserving history                                                         |
| GET    | `/search?q=...`            | Public text search with filters                                                               |
| GET    | `/cart`                    | Current priced cart; reports unavailable items as conflicts                                   |
| POST   | `/cart/items`              | Set absolute quantity: productId, quantity (1–100)                                            |
| PATCH  | `/cart/items/:id`          | Set quantity; id is product UUID                                                              |
| DELETE | `/cart/items/:id`          | Remove item                                                                                   |
| DELETE | `/cart`                    | Clear cart                                                                                    |
| GET    | `/orders/preview`          | Current authoritative cart quote                                                              |
| POST   | `/orders/checkout`         | Checkout with shippingAddress and Idempotency-Key header                                      |
| GET    | `/orders`                  | Current customer's paginated history                                                          |
| GET    | `/orders/:id`              | Current customer's order with snapshots                                                       |
| GET    | `/admin/orders`            | Admin; optional status and pagination                                                         |
| PATCH  | `/admin/orders/:id/status` | Admin: status                                                                                 |

Product/search filters: `categoryId`, `currency`, `minPrice`, `maxPrice`, `available=true|false`, `q`, `page`, `limit`, `sort=newest|price_asc|price_desc|name`. Prices use minor units. Sorting uses an ID tiebreaker. Category reads are ordered by slug. Products are fetched with their categories to avoid N+1 reads.

Example checkout body (prices and totals are deliberately rejected):

```json
{
  "shippingAddress": {
    "name": "Global Buyer",
    "line1": "10 Market Road",
    "city": "Lagos",
    "postalCode": "100001",
    "country": "NG"
  }
}
```

Send a unique `Idempotency-Key` of 8–100 letters, digits, underscores or hyphens and retain it for retries. Replaying a key returns its original order. Order transitions are `PENDING → CONFIRMED → SHIPPED → DELIVERED`; pending/confirmed orders may become `CANCELLED`. Terminal statuses cannot transition further.

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

CI runs lint, formatting, typecheck, real PostgreSQL/Redis tests, build and Docker image validation. No hosting deployment is configured; production credentials and a hosting target are required. The Docker runtime is non-root and shuts down within 10 seconds after SIGTERM/SIGINT.

Security headers, a 64 KB payload limit, strict write schemas, allowlisted CORS origins and centralized redacted errors apply globally. Rate limits use atomic Redis counters (120 API requests, 10 authentication requests, 30 searches per minute per source IP). Rate limiting fails closed with 503 when Redis is unavailable. Catalog cache failures fall back to PostgreSQL; TTL is 30 seconds. Writes advance a cache-generation token; in-flight old reads cannot repopulate the current generation. A failed invalidation may leave stale public reads for up to the TTL; checkout always reads PostgreSQL directly.

Trust proxy is disabled by default to prevent forged forwarding headers. Behind a trusted reverse proxy, configure a reviewed subnet/hop policy in `createApp` before enabling it; otherwise clients share the proxy's rate bucket. CORS is a browser policy, not an authorization mechanism. Logs contain generated request IDs, method, path, status and duration, without bodies, query strings, passwords or tokens. Audit records store privileged changes and order transitions. Short-lived role claims remain valid until expiry; immediate revocation requires a token-version/session mechanism.

Use managed database backups and point-in-time recovery; rehearse restore procedures and choose explicit RPO/RTO targets. Roll back application images independently; database changes should use forward-compatible expand/contract migrations, with a backup before destructive changes. Run ANALYZE/EXPLAIN against representative catalog queries before adding indexes; substring text search may need trigram/full-text indexing at scale. Monitor readiness, 5xx, transaction conflicts, Redis latency, cache effectiveness and checkout latency. Place TLS at the ingress and inject production secrets through the host secret manager.

## Scope and extension points

This implementation creates **pending orders**, not paid transactions. Payment provider integration, signed webhooks, refund accounting, tax calculation, shipping rates, FX conversion, stock-reservation expiry, a browser storefront, and hosting deployment require separate integrations. Totals currently equal the merchandise subtotal. Do not enable real paid checkout until those commercial policies are implemented. The attached plan is a reference roadmap; the project name and category scope follow the user's E-com Global requirements.

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
