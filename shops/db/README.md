# Shops PostgreSQL migrations

`migrations/0001_durable_commerce.up.sql` creates the repository-only durable commerce model for:

- immutable pinned catalogue versions;
- immutable quote snapshots;
- one idempotent order per quote;
- fee and product settlement dispatch attempts;
- immutable finality receipts bound to recorded settlements; and
- immutable delivery receipts bound to the pinned artifact and both finalized payment legs.

The migration does not provision or connect to production infrastructure. The default connection values in the harness target only the loopback PostgreSQL service from `shops/compose.ci.yml`.

```bash
docker-compose -f compose.ci.yml up -d postgres
npm run check:services
npm run test:migrations
docker-compose -f compose.ci.yml down -v
```

`test:migrations` applies the migration, exercises success and failure constraints, applies the down migration, proves the schema is absent, reapplies the up migration, and performs a final down migration cleanup.
