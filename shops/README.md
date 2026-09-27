# Makings Shops R1 boundary (Wave 0)

This directory is an **inert, independently locked boundary** for Shops work. It does not start a production process, register a route, change a database, provision infrastructure, or add a deploy hook.

Scope is the Shops runtime. The static Makings landing is served separately and is not deployed from this boundary.

Wave 0 provides:

- an isolated Node package and lockfile;
- a CI-only PostgreSQL 16 + MinIO harness;
- executable boundary/retired-route assertions;
- ADRs for route, data, runtime, hosting, and landing-switch decisions;
- an inert in-memory `/api/shops/v1` contract handler for pinned catalogue list/detail reads, quote create/read, and idempotent order create/read.
- reversible PostgreSQL migrations for pinned catalogue versions and durable quote, order, dispatch, finality, and delivery-receipt rows.

The contract handler in `src/service-api.mjs` does not open a listener or mount into AgentFolio. Its catalogue entry and recipient are synthetic fixtures, payment dispatch is absent, and new orders remain explicitly blocked at payment, finality, and delivery boundaries.

## Inert API contract

The unmounted handler accepts `{ method, path, headers, body }` and returns `{ status, headers, body }` for:

- `GET /api/shops/v1/catalogue`
- `GET /api/shops/v1/catalogue/:productId/versions/:productVersion`
- `POST /api/shops/v1/quotes`
- `GET /api/shops/v1/quotes/:quoteId`
- `POST /api/shops/v1/orders` (requires `Idempotency-Key`)
- `GET /api/shops/v1/orders/:orderId`

## Local checks

```bash
npm ci
npm test
npm run check:boundary

docker compose -f compose.ci.yml up -d
npm run check:services
npm run test:migrations
docker compose -f compose.ci.yml down -v
```

The compose project binds services to loopback on non-production ports. It is test infrastructure only and must never be used by the AgentFolio production PM2 worktree.

Use `docker-compose` instead of `docker compose` on hosts where Compose is installed as the standalone compatibility command. The migration harness defaults to the loopback CI database and performs an up/constraint/down/reapply/down sequence, leaving no Shops schema behind.
