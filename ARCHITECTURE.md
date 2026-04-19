# AgentFolio Architecture

AgentFolio is a Solana-native agent marketplace and identity platform.

## Runtime layout

Production is split into two PM2 apps:
- `agentfolio` backend, `src/server.js`, port `3333`
- `agentfolio-frontend` Next.js app, `frontend`, port `3000`

The backend and frontend are reverse-proxied behind Caddy. The frontend talks to backend APIs over same-origin routes and local upstreams.

## Tech stack

- Backend: Node.js, Express 5, CommonJS modules
- Frontend: Next.js 16, React 19, TypeScript, Tailwind 4
- Database: SQLite via `better-sqlite3`
- Chain: Solana, SPL Token, Metaplex, SATP V3 SDK
- Process manager: PM2

## Repo structure

### Core app directories
- `src/`: backend server, route registration, chain integrations, marketplace logic, verification logic
- `frontend/`: Next.js application
- `public/`: static assets served by the frontend
- `docs/`: audits, specs, planning, and operational docs
- `scripts/`: admin scripts, one-off maintenance scripts, and manual test helpers
- `tests/`, `test/`: automated and ad hoc test coverage

### Chain and protocol directories
- `core-cm/`, `core-cm-v2/`: chain-manager style logic and Solana integration helpers
- `satp-client/`: local SATP client code used by the app
- `satp-idls/`: SATP IDLs
- `sdk/`: external-facing SDK assets and helpers

### Supporting directories
- `boa-pipeline/`: burn or mint related pipeline scripts and workers
- `brand-kit/`, `marketing/`, `outreach/`, `research/`, `blog/`: non-runtime collateral
- `tools/`, `specs/`, `skill/`: tooling, protocol notes, and agent-skill metadata

## Backend entrypoints

### Main server
- `src/server.js` is the backend entrypoint
- It starts the Express app on `process.env.PORT || 3333`
- It mounts route families from `src/routes/` and supporting libraries under `src/lib/`

### Major route families in `src/routes/`
- `burn-to-become-public.js`, `burn-to-become-public-birth.js`, `safe-burn-to-become.js`: burn and birth flows
- `escrow-routes.js`, `escrow-v3-routes.js`: escrow and release flows
- `github-import.js`: GitHub import flow
- `restored-verify-routes.js`, `verify-face.js`, `trust-credential.js`: verification and trust flows
- `identity-v3-routes.js`, `satp-api.js`, `satp-auto-identity.js`, `satp-auto-identity-v3.js`, `satp-write-api.js`, `satp-explorer-api.js`, `satp-boa-linker-v3.js`, `reputation-v3-routes.js`, `reviews-v3-routes.js`, `v3-api-index.js`: SATP and V3 identity or reputation APIs
- `activity.js`, `avatar.js`, `badge.js`, `claim-routes.js`, `explorer-api.js`, `reviews-routes.js`, `prepare-birth-endpoint.js`, `batch-register.js`: supporting product APIs

### Profile APIs
`src/profile-store.js` documents and implements these profile-facing endpoints:
- `POST /api/register`
- `GET /api/profiles`
- `GET /api/profile/:id`
- `PATCH /api/profile/:id`
- `POST /api/profile/:id/endorsements`
- `GET /api/profile/:id/endorsements`
- `POST /api/profile/:id/reviews`
- `GET /api/profile/:id/reviews`

## Frontend surface

`frontend/src/app/` is a Next.js app-router project.

Verified route families include:
- `/directory`
- `/marketplace`
- `/marketplace/job/[id]`
- `/profile/[id]`
- `/register`
- `/verify`, `/verify/[id]`
- `/burn`, `/mint`, `/claim/[id]`, `/trust/[id]`
- `/import/github`
- `/satp/explorer`
- `/leaderboard`, `/stats`, `/staking`, `/activity`
- `/solana-rpc` proxy route

## Persistence and data model

The primary database file is `data/agentfolio.db`.

### Core SQLite tables from `src/lib/database.js`
- `profiles`: profile records with JSON columns for links, wallets, skills, portfolio, verification, metadata
- `activity`: profile activity feed
- `jobs`: marketplace jobs, budget, escrow, lifecycle state, selection state
- `applications`: job applications, budget, timeline, status, wallet address, optional team id
- `bounty_submissions`: bounty-specific submissions
- `reviews`: marketplace reviews between client and agent
- `escrows`: escrow state, deposit, release, refund lifecycle
- `disputes`, `follows`, `webhooks`, `webhook_logs`
- `api_keys`: hashed API keys, rate limits, usage tracking, tiering
- `verification_requests`: review queue for verification requests
- `collaborations`, `claims`, `feedback`
- `analytics_views`, `analytics_api`
- `custom_proofs`, `telegram_verifications`, `discord_verifications`, `agentmail_verifications`
- `satp_attestations`, `satp_trust_scores`
- `integrations`

### Additional domain tables in other libs
Other libraries initialize specialized tables such as:
- `teams`, `team_members`, `team_invites`, `team_activity`
- `attestations`
- `delegation_vaults`, `delegations`, `nav_snapshots`
- `verification_providers`, `custom_verifications`
- staking, governance, premium, OAuth, featured auction, performance fee, VAA, achievement, peer review, and cross-chain identity tables

### Profile store schema
`src/profile-store.js` also initializes profile-centric tables in the same database:
- `profiles`
- `endorsements`
- `reviews`
- `verifications`
- `activity_feed`

This means AgentFolio currently has two overlapping schema layers, a broader app database in `src/lib/database.js` and a profile-focused store in `src/profile-store.js`, both pointed at `data/agentfolio.db`.

## Solana and SATP integration

The codebase is Solana-native.

Verified dependencies and integration points include:
- `@solana/web3.js`
- `@solana/spl-token`
- `@metaplex-foundation/*`
- `@brainai/satp-v3`
- local SATP client code under `satp-client/`

The frontend includes wallet adapter dependencies and a `/solana-rpc` proxy route. The backend includes burn, identity, reputation, escrow, and write paths for SATP-related flows.

## Deployment and process config

### Backend PM2 config
`ecosystem.config.js` runs:
- script: `src/server.js`
- cwd: `/home/ubuntu/agentfolio`
- env: `PORT=3333`, `NODE_ENV=production`, `BOA_CLUSTER=mainnet`, `SATP_NETWORK=mainnet`

### Frontend PM2 config
`frontend/ecosystem.config.js` runs:
- script: `node_modules/.bin/next`
- args: `start -p 3000`
- cwd: `/home/ubuntu/agentfolio/frontend`
- env: `NODE_ENV=production`, `PORT=3000`, `API_URL=http://localhost:3333`

## Operational notes

- GitHub is the source of truth for deploys
- Production deploys should be: merge PR, pull `main`, restart PM2, verify live endpoints
- The repo previously accumulated logs, backup files, keys, videos, and one-off scripts at root, which this cleanup branch is removing or relocating

## Current architectural rough edges

- Cleanup is still reducing root-level clutter and tracked artifacts
- Multiple backup and archive artifacts were committed historically
- There is duplicated schema ownership between `src/lib/database.js` and `src/profile-store.js`
- SATP-related code is still embedded across several directories instead of being fully extracted
- Both `test/` and `tests/` exist and should eventually be rationalized
