# ADR 0002: Data and runtime isolation

Status: proposed for R1 Wave 0

## Decision

Shops will use a dedicated PostgreSQL database/schema and dedicated object-storage bucket/prefix. It must not read or migrate the legacy SQLite files, SATP stores, marketplace job ledger, escrow records, or production object paths. Cross-product references use immutable public identifiers plus explicit adapters; they do not create foreign-key ownership across services.

Wave 0 supplies only ephemeral CI services:

- PostgreSQL 16 on loopback port 55432 with tmpfs storage;
- MinIO on loopback ports 59000/59001 with tmpfs storage;
- fixed CI-only credentials committed solely for disposable local containers.

No production environment values, migrations, volumes, network attachments, process definitions, DNS, or infrastructure are created. A future runtime must use separate least-privilege credentials, private networking, encryption, backups, lifecycle policies, and an independently reversible migration plan.
