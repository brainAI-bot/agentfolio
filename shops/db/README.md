# Shops PostgreSQL migrations

`migrations/0001_durable_commerce.up.sql` creates the repository-only durable commerce model for:

- immutable pinned catalogue versions;
- immutable commerce quote snapshots with a payment `pair_hash` and exactly one immutable fee and product leg quote;
- one idempotent order per complete quote pair;
- payment dispatches bound to the order-owned leg quote, with copied network, scheme, asset, amount, recipient, facilitator, and validity terms checked by PostgreSQL;
- at most one non-failed dispatch per order leg, monotonic dispatch state, and settlement bindings that cannot be replaced once recorded;
- immutable finality receipts requiring a complete, non-failed settlement; and
- immutable delivery receipts bound to the pinned artifact and both `SETTLED` payment legs.

`migrations/0002_durable_orders_dispatch.up.sql` adds the focused durable order/dispatch packet without changing the inert API surface:

- one durable fee row and one durable product row per order, joined to the order quote and its immutable payment-leg quote;
- versioned, monotonic order and payment-leg states with idempotent same-state updates;
- a product-dispatch gate that requires a committed fee settlement (`AWAITING_FINALITY` or `SETTLED`);
- persisted dispatch result status, observation time, bounded error reason, and allowlisted public settlement evidence;
- an observer-safe readback view joined through the pinned product version and artifact; and
- a scoped down migration that removes only packet `0002`, preserving all `0001` rows and objects.

The migration does not provision or connect to production infrastructure. The harness defaults to the loopback PostgreSQL service from `shops/compose.ci.yml`; destructive `test:migrations` mode refuses any `SHOPS_POSTGRES_HOST` that is not `localhost`, `::1`, or an address in `127.0.0.0/8` before invoking `psql`. `db:migrate` detects the installed base objects and applies only pending migrations, so a base-only `0001` database upgrades to `0002` and repeated runs are no-ops. `db:rollback` removes only the latest `0002` packet and preserves the `0001` schema and rows.

```bash
docker compose -f compose.ci.yml up -d postgres
npm run check:services
npm run test:migrations
docker compose -f compose.ci.yml down -v
```

`test:migrations` proves the base migration, upgrades a base-only database through the pending-migration path, reruns that path as a no-op, executes the prior `0001` contract harness with `0002` active, exercises `0002` success and must-fail constraints, rolls back only `0002`, proves base objects remain, reapplies `0002`, and compares a committed base sentinel before and after the final scoped rollback. It then removes `0001` only as explicit test cleanup. The normal `npm test` suite includes a stubbed runner test proving that a non-loopback host is rejected without invoking `psql`.