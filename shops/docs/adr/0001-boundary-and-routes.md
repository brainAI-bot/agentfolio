# ADR 0001: Shops route and repository boundary

Status: proposed for R1 Wave 0

## Decision

All Shops implementation remains under top-level `shops/` with its own package and lockfile. No Shops route is mounted by the legacy Express server or Next frontend in Wave 0. Future public routes reserve `/shops/**`; future service APIs reserve `/api/shops/**`. Existing `/marketplace`, SATP, profile, trust, escrow, and verification routes remain unchanged.

The legacy frontend continues to deploy through the established `origin/main` → AWS box poller → locked production worktree → PM2 path. `shops/**` is inert in that path: no PM2 process, package install, build step, route mount, or deployment hook consumes it.

## Collision guard

`shops/scripts/validate-boundary.mjs` fails closed when a Wave 0 diff mutates production runtime/deploy paths or unrelated legacy routes. The only legacy edits allowed in this wave are removal of token-launch public pages/copy and their verification sweep.
