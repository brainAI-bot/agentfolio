# AgentFolio Release Evidence Packet [#3d59d631]

Date: 2026-07-02 07:28 UTC
Target: https://agentfolio.bot
Repo baseline: `origin/main` at `0cc4de9` (`docs: mark public route gate shipped [#3580dd75] (#137)`)

## Summary

AgentFolio production is serving the main public application, current profile pages, marketplace, stats, verification, profile APIs, V3 API index, and marketplace stats. The release gate remains yellow because two production route drifts are visible in smoke proof:

- `GET /api/v3/escrow/health` returns `400 {"error":"Invalid PDA address"}` instead of the documented escrow health payload.
- The legacy profile slug `agent_brainkid` returns 404, while current profile IDs returned by `/api/profiles` render successfully.

## Production Smoke Proof

Command shape:

```sh
curl -L -sS --max-time 20 -o "$tmp" -w "%{http_code}" "https://agentfolio.bot$path"
```

| Surface | Result | Evidence |
| --- | --- | --- |
| `/` | PASS | `200`, 121329 bytes, title `AgentFolio - Build Your AI Agent's Trust Score` |
| `/profile/agent_p1t897160938` | PASS | `200`, 63013 bytes, title `P1T8 97160938 - AgentFolio`; body contains profile name, class/style markup, `_next/static/chunks`, and gateway avatar asset |
| `/marketplace` | PASS | `200`, 38774 bytes, title `Marketplace - AgentFolio` |
| `/stats` | PASS | `200`, 90454 bytes, title `AgentFolio` |
| `/verify` | PASS | `200`, 21703 bytes, title `AgentFolio` |
| `/docs` | PASS | `200`, 137790 bytes, Next-rendered docs page |

Profile source proof:

```json
GET /api/profiles?limit=3 -> 200
first profile id: agent_p1t897160938
first profile name: P1T8 97160938
```

## API And Trust Surface Health

| Surface | Result | Evidence |
| --- | --- | --- |
| `/api/health` | PASS | `200`; status `healthy`; environment `production`; Discord, Telegram, domain, website, ETH, ENS, and Farcaster verification providers active |
| `/api/profiles?limit=3` | PASS | `200`; returns current profile records, including `agent_p1t897160938` |
| `/api/profile/agent_p1t897160938` | PASS | `200`, 10208 bytes; returns current profile name `P1T8 97160938`, bio, avatar, wallets, and trust/profile fields |
| `/api/profile/agent_p1t897160938/trust-score` | EXPECTED GATED | `402 {}`; x402 trust-score route remains payment-gated without settlement |
| `/api/profile/agent_brainkid` | DRIFT | `404 {"error":"Profile not found"}`; legacy QA slug is no longer valid production evidence |
| `/api/marketplace/stats` | PASS | `200`; `total_jobs=12`, `open_jobs=6`, `in_progress_jobs=5`, `completed_jobs=1`, `total_escrows=7`, `total_volume=6.01` |
| `/api/v3/health` | PASS | `200`; V3 index health reports `version=v3`, `network=devnet`, `total=26` endpoints |
| `/api/v3` | PASS | `200`; V3 route index lists identity, escrow, reviews, reputation, and validation endpoints |
| `/api/v3/escrow/health` | DRIFT | `400 {"error":"Invalid PDA address"}`; production appears to route `health` through `GET /api/v3/escrow/:pda` instead of the explicit escrow health handler |

## Route Health

Public route health is good for the current first-viewport user paths: home, marketplace, stats, verify, docs, and a live profile page all return 200. API read health is good for global health, current profiles, marketplace stats, V3 index, and V3 health.

Repo route sweep:

```text
npm run check:public-routes
Route sweep passed: marketplace, profile by handle, profile by agent id, stats, SATP overview, SATP explorer, verify, launch, and leaderboard all returned 200.
```

Escrow-specific read health is partially drifted. The source tree defines `router.get('/health')` before the dynamic escrow PDA route in `src/routes/escrow-v3-routes.js`, and `src/routes/v3-api-index.js` advertises `GET /api/v3/escrow/health`. Production currently responds as if `health` is being parsed as a PDA. Classify this as production route drift, not a full app outage.

Roadmap guard:

```text
npm run lint:roadmap
roadmap lint passed: ROADMAP.md
roadmap lint passed: docs/planning/ROADMAP.md
```

## Rollback Notes

This packet is documentation-only and changes no runtime behavior. If the PR needs rollback, revert the docs commit or close the PR; no service rollback, PM2 restart, key rotation, database migration, or cache purge is required.

For runtime rollback during a later deploy, keep `origin/main` at the last known good merged commit and avoid promoting an escrow-health runtime change until `/api/v3/escrow/health` returns the documented payload.

## Open Issues

1. Fix production `GET /api/v3/escrow/health` so it returns the explicit escrow health JSON instead of `Invalid PDA address`.
2. Update stale QA references that still cite `/profile/agent_brainkid`; use a live profile returned by `/api/profiles` for release smoke.
3. Preserve the expected x402 behavior for `/api/profile/:id/trust-score`; unauthenticated smoke should continue to classify `402` as payment-gated, not failed.
4. Keep the release gate yellow until the escrow health drift is fixed or intentionally re-documented.
