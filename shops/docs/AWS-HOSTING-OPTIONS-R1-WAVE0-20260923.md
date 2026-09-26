# Makings Shops R1 Wave 0 — hosting options (superseded)

**Status:** superseded on 2026-09-25.

The earlier SQLite/DynamoDB hosting comparison is retired. The authoritative reconciled `eu-north-1` PostgreSQL comparison is:

- [`AWS-HOSTING-OPTIONS-R1-WAVE0-20260925.md`](./AWS-HOSTING-OPTIONS-R1-WAVE0-20260925.md)

Do not provision from the superseded sheet. The replacement requires PostgreSQL, explicit web/API and worker/scanner processes, S3 `quarantine/`, `artifacts/`, and `evidence/` namespaces, measured recovery evidence, and separate approval before any resource, spend, credential, DNS, or deployment action.
