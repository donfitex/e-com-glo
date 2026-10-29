# Backend master plan implementation

E-com Global evolves the existing `donfitex/e-com-glo` repository on `main`. The supplied Backend Development Codex Master Plan is a technical roadmap, not a replacement product specification. Existing global categories, Paystack test checkout, Neon PostgreSQL, Render hosting, real product photos and delivery tracking are retained.

## Baseline and stage mapping

- Stage 0: Node >=22, npm lockfile, strict TypeScript, modular Express services, ignored secrets and local setup already exist.
- Stages 1–2: add isolated native HTTP exercises and an injected, validated concurrent aggregation engine. These do not replace production routes.
- Stage 3: existing validated CRUD/services, request IDs and safe errors remain. Add ISO request timestamps, isolated mock-user exercises and an explicit API contract.
- Stage 4: add versioned bcrypt password hashes with legacy scrypt compatibility and opportunistic upgrades; tighten login throttling without sharing one loopback-IP bucket across all storefront customers. CUSTOMER is the existing equivalent of the plan’s USER role.
- Stage 5: existing Prisma transactions, inventory checks, relational schema and isolated integration databases remain authoritative.
- Stage 6: make cache TTL configurable, add cache measurements and preserve bounded database fallback and shared Redis limits.
- Stage 7: existing non-root multi-stage Docker images, healthy Compose dependencies and GitHub Actions remain; new modules and workers join these checks.
- Stage 8: add a transactional outbox and independent Redis Streams worker with database-backed idempotency, bounded retries and a dead-letter path. Unpaid orders must never be shipped by a worker.
- Stage 9: retain the existing optional local MiniLM adapter, pgvector search, query caching and text fallback. The model is English-oriented; do not claim multilingual quality or universal latency.
- Stage 10: integrate worker lifecycle, safe administrative deep health, release verification and rollback guidance.

Each implementation checkpoint is verified and pushed to `main` before the next begins. No feature branches, remote replacements, production data exports, or secret commits are involved. Existing successful synchronous checkout remains HTTP 201: order creation is already complete. Background acceptance must be recorded transactionally; 202 is reserved for genuinely asynchronous acceptance APIs.

## Design boundaries

Learning examples bind only to loopback and are never mounted in the live commerce API. All commerce writes retain authentication and authorization. Infrastructure configuration is supplied through the host secret manager. Local tests and benchmarks must use isolated databases, never Neon production. Render’s single-replica staging startup migration remains distinct from the documented production release-job procedure.

## Stage 1: isolated native HTTP exercise

Run `npm run learn:http`, then `curl -i http://127.0.0.1:3101/`, `curl -i http://127.0.0.1:3101/api/users`, and `curl -i http://127.0.0.1:3101/api/health`. The built-in HTTP server returns JSON, 200/404 status, process uptime, OS platform and an ISO timestamp. Stop with Ctrl+C. It binds only to loopback and refuses production mode; mock users are static examples, not commerce accounts.

## Stage 2: fault-tolerant aggregation

`aggregate<T>` accepts named HTTPS sources with a Zod schema and an injected fetch implementation. It uses `Promise.allSettled`, five-second request deadlines, redirect rejection, a twenty-source bound and a 1 MiB response bound. Successful typed results survive failed peers; errors expose source labels and safe codes, not provider payloads. It is a library boundary, not a public URL-fetching endpoint. Native fetch/network I/O is not accelerated by increasing `UV_THREADPOOL_SIZE`; no misleading thread-pool benchmark is supplied.
