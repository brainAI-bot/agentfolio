# AgentFolio Route Ownership Map

Last updated: 2026-05-13

This file is the canonical workflow route ownership map. When a route is listed here, the owner module below is the source of truth for runtime behavior; legacy duplicate definitions should either delegate to the owner or stay unmounted until they are removed.

## Workflow mismatch fixes

| Workflow | Public route | Owner module | Auth | Status | Notes |
|---|---|---|---|---|---|
| Activity feed | `GET /api/activity` | `src/routes/workflow-read-routes.js` | Public read | Canonical | Replaces stale/unmounted `src/routes/activity.js` ownership and old docs references to `/api/activity/feed`. |
| Marketplace stats | `GET /api/marketplace/stats` | `src/routes/workflow-read-routes.js` | Public read | Canonical | Replaces unmounted `src/sprint3-endpoints.js` definition without mounting its duplicate `/api/search` routes. |
| Fee tiers catalog | `GET /api/fees/tiers` | `src/routes/workflow-read-routes.js` | Public read | Canonical | Replaces unmounted read route in `src/api/fees.js`; intentionally does **not** mount legacy fee write/admin endpoints. |

## Deprecated duplicate definitions

| Legacy module | Duplicate/stale route(s) | Decision |
|---|---|---|
| `src/sprint3-endpoints.js` | `/api/search`, `/api/agent/:id/avatar`, `/api/marketplace/stats`, `/api/endorsements` | Do not mount wholesale. Move individual read endpoints into owned modules or delete after replacement. |
| `src/api/fees.js` | `/api/fees/tiers`, `/api/fees/:profileId`, `/api/fees/:profileId/history`, fee write/admin routes | Do not mount wholesale until admin/write auth is explicit. `/api/fees/tiers` is owned by workflow read routes. |
| `src/routes/activity.js` | `/api/activity` | Superseded by the robust workflow read route. Remove or delegate in a later cleanup. |
| `src/api/docs.js` | `/api/activity/feed`, `/api/marketplace/stats/{id}` | Docs drift; update generated API docs separately to match the canonical public routes. |

## Guardrail

New public workflow routes must add an entry here and a route registration test before production promotion. Avoid adding large catch-all endpoint bundles when a single audited route is needed.
