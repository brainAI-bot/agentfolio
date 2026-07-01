# Marketplace Truth States Evidence [#34d647c7]

This evidence note ties the Phase 4 marketplace and escrow truth-state work to the current HQ marker without changing ROADMAP.md.

## Merged Coverage

- PR #128 merged as commit `19b4657413337d4b62dc49db7cd77eb1734fcd75` and updated marketplace, SATP, stats, docs, and client-facing escrow copy so devnet-safe escrow runtime smoke is stated as verified while mainnet/live-funds escrow remains gated pending security re-review.
- PR #128 updated `src/lib/write-surface-gate.js` so runtime responses expose live escrow gate/status metadata, including `runtimeNetwork: "devnet"`, `verifiedRuntime.network: "devnet"`, and `mainnetLiveFundsCleared: false`.
- PR #128 updated `frontend/src/components/MarketplaceClient.tsx` and `frontend/src/app/marketplace/job/[id]/page.tsx` so marketplace UI copy does not present beta escrow tooling as live-funds clearance.
- PR #128 updated `tests/escrow-v3-pda-query.test.js` and `tests/write-surface-gate.test.js` to lock the gated live-funds API response and escrow gate payload semantics.

## Current Verification

- `gh pr checks 128 --repo brainAI-bot/agentfolio` reports CodeQL, gitleaks, and analysis checks passing.
- `npm test` passes locally after `npm ci` in a clean worktree, covering the marketplace review path, escrow gate payload, and marketplace surface regression tests from main.

## Changed File Summary

- Adds this marker-correct evidence note only.
- Does not edit `ROADMAP.md`.
