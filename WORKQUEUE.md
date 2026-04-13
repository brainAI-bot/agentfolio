# WORKQUEUE.md — AgentFolio Phase 1 Bug Queue

## Fixed — 2026-04-13

### P1 — Public profile trust score stale for up to 30s after endorsement / score writes
- **Found during:** Phase 1 Flow 3 / Flow 4 validation
- **Symptom:** `/api/profile/:id` updated immediately after endorsement, but `/profile/:id` still rendered the old trust score because the page and its fetches were ISR-cached.
- **Root cause:** `frontend/src/app/profile/[id]/page.tsx` and `frontend/src/lib/data-fetch.ts` used `revalidate=30` for live score/profile state.
- **Fix:** Commit `858dd55` (`Make profile page scores update live`)
- **Proof:** Immediate post-endorsement API and HTML both showed trust score 95 for `agent_p1reg_35028542`.
- **Status:** Fixed and deployed

### P1 — Endorsements leaked into public reviews surface
- **Found during:** Phase 1 Flow 4 / Flow 8 validation
- **Symptom:** endorsement comments appeared in the public profile review list, conflating Flow 4 social proof with Flow 8 reviews and risking polluted rating math.
- **Root cause:** `frontend/src/app/profile/[id]/page.tsx` fetched `/api/profile/:id/endorsements` and merged results into the reviews array.
- **Fix:** Commit `99681d9` (`Keep endorsements out of review surface`)
- **Proof:** live profile HTML no longer contains endorsement strings such as `Realtime profile page fix verification`.
- **Status:** Fixed and deployed

### P0 — Marketplace reviews could bypass escrow release gate
- **Found during:** Phase 1 Flow 8 validation
- **Symptom:** `POST /api/marketplace/jobs/:id/review` accepted reviews for jobs with `status: completed` even when no escrow release markers existed.
- **Root cause:** `src/api/reviews-v2.js` treated plain job completion as equivalent to funded escrow release.
- **Fix:** Commit `c648cd9` (`Require actual escrow release for marketplace reviews`)
- **Proof:** synthetic prod test job `job_phase1_reviewgate_1776040324` returned 201 before fix and 400 after fix for the same signed request.
- **Status:** Fixed and deployed

### P0 — Marketplace reviews accepted DB-only writes without tx-backed auth
- **Found during:** Phase 1 Flow 8 validation
- **Symptom:** `/api/marketplace/jobs/:id/review` could insert reviews with `tx_signature: null` using wallet-message auth only.
- **Root cause:** marketplace review POST used `verifyReviewAuth(...)` instead of tx-backed auth and did not require a `tx_signature`.
- **Fix:** Commit `3d0170e` (`Require tx-backed auth for marketplace reviews`)
- **Proof:** on released test job `job_phase1_reviewtxreq_1776041340`, POST without `txSignature` now returns 400; same endpoint with real TEST8 wallet chain signature returns 201 and stores that exact `tx_signature`.
- **Status:** Fixed and deployed

### P0 — Marketplace reviews accepted arbitrary wallet txs as review proof
- **Found during:** Phase 1 Flow 8 validation
- **Symptom:** `/api/marketplace/jobs/:id/review` would accept unrelated confirmed transactions from the reviewer wallet, even when the tx was not a SATP review transaction.
- **Root cause:** `verifyReviewTxBackedAuth(...)` only checked wallet participation + chain confirmation and did not require the SATP Reviews program.
- **Fix:** Commit `d416c9a` (`Require SATP review tx for marketplace reviews`)
- **Proof:** before fix, fresh released test job `job_phase1_reviewtxhard_1776042300` accepted Genesis tx `52swdCD5objjxJ1yosUMnRBptSkLkNCaATjavyFo7NmPE8qg9rrctEi7E1TRNvRoMgwAem1zowvCrEFu97Bhk3pi`; after fix, fresh released test job `job_phase1_reviewtxhard2_1776042320` rejects the same tx with `tx_signature does not include the SATP reviews program.`
- **Status:** Fixed and deployed

## Open / Blocked

### P1 — SATP review helper route derived devnet PDAs on prod
- **Found during:** Phase 1 Flow 8 validation
- **Symptom:** `/api/reviews/pda/derive` returned the devnet review PDA on production.
- **Root cause:** `src/routes/reviews-routes.js` defaulted to `SOLANA_NETWORK || devnet` while prod only set a mainnet `SOLANA_RPC_URL`.
- **Fix:** Commit `f958682` (`Infer mainnet for SATP review routes on prod`)
- **Proof:** same derive request changed from devnet PDA `4ABirmreZnrffK8DY3PoZ1GznfRN89tTfWiJRfJPJr1K` to mainnet PDA `4YSWtAzaYSB6bJU9DoHSt2wsb6iF824F5UussBForXNa` after deploy.
- **Status:** Fixed and deployed


### P0 — Marketplace reviews now require SATP-review-like tx proof, but there is still no end-to-end builder/submission path from marketplace flow
- **Found during:** Phase 1 Flow 8 validation after fixes `c648cd9`, `f958682`, `3d0170e`, and `d416c9a`
- **Symptom:** marketplace review POST now rejects null signatures and rejects arbitrary non-review wallet txs, but there is still no integrated marketplace flow that builds, signs, submits, and then stores the exact SATP review tx for the job.
- **Root cause:** the separate V3 review builder in `src/routes/reviews-routes.js` is still not wired end to end into `/api/marketplace/jobs/:id/review` or the marketplace frontend UX.
- **Impact:** unsafe review proofs are blocked, but Flow 8 still falls short of the full spec requirement for a complete on-chain marketplace review write path.
- **Status:** Open / blocker
