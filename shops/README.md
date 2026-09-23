# AgentFolio Shops R1 boundary (Wave 0)

This directory is an **inert, independently locked boundary** for Shops work. It does not start a production process, register a route, change a database, provision infrastructure, or add a deploy hook.

Wave 0 provides only:

- an isolated Node package and lockfile;
- a CI-only PostgreSQL 16 + MinIO harness;
- executable boundary/retired-route assertions;
- ADRs for route, data, runtime, hosting, and landing-switch decisions.

## Local checks

```bash
npm ci
npm test
npm run check:boundary

docker compose -f compose.ci.yml up -d
npm run check:services
docker compose -f compose.ci.yml down -v
```

The compose project binds services to loopback on non-production ports. It is test infrastructure only and must never be used by the AgentFolio production PM2 worktree.
