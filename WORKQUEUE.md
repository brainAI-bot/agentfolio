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

### P1 — SATP review helper route derived devnet PDAs on prod
- **Found during:** Phase 1 Flow 8 validation
- **Symptom:** `/api/reviews/pda/derive` returned the devnet review PDA on production.
- **Root cause:** `src/routes/reviews-routes.js` defaulted to `SOLANA_NETWORK || devnet` while prod only set a mainnet `SOLANA_RPC_URL`.
- **Fix:** Commit `f958682` (`Infer mainnet for SATP review routes on prod`)
- **Proof:** same derive request changed from devnet PDA `4ABirmreZnrffK8DY3PoZ1GznfRN89tTfWiJRfJPJr1K` to mainnet PDA `4YSWtAzaYSB6bJU9DoHSt2wsb6iF824F5UussBForXNa` after deploy.
- **Status:** Fixed and deployed

### P0 — Marketplace review builder path failed against live mainnet reviews program
- **Found during:** Phase 1 Flow 8 validation after fixes `c648cd9`, `f958682`, `3d0170e`, and `d416c9a`
- **Symptom:** `/api/reviews/submit` built a `submit_review` transaction for `Ge1sD2qwmH8QaaKCPZzZERvsFXNVMvKbAgTp2p17yjLK`, but the deployed mainnet reviews program did not expose that instruction, causing `InstructionFallbackNotFound (0x65)` and blocking the final marketplace review write path.
- **Root cause:** `src/routes/reviews-routes.js` used an incompatible tx builder instead of matching the live on-chain program's `create_review` / `init_review_counter` instruction set.
- **Fix:** Commit `efdb7b2` (`Fix marketplace review tx builder`)
- **Proof:** released prod job `job_9dd8addb50d2603f` now completes the full Flow 8 path in both directions. Worker -> client tx `3GUseVTWoAkkMEfdwBpJKR5efohrm9LA2SrNjqfH1xPMsGgGttQpKRZi6qcK9zLL3wqyWt5c9rQSZDiTRqrNXmUR`, client -> worker tx `5v9R8bfCR167EPvQdkvAsKcRo6i633Eib96TSKW5AW9TJvCC7hiHWU75UHzR5HLxyFBcN1WJwM3Ev4KZ3UPeBA7A`, both persisted and rendered on the live job page.
- **Status:** Fixed and deployed

### P1 — Flow 6 paid x402 trust-score path needed live settlement proof
- **Found during:** Phase 1 Flow 6 validation
- **Symptom:** unpaid and invalid-signature checks passed, but the real paid path still needed an end-to-end production settlement proof.
- **Root cause:** validation was incomplete, not a backend bug.
- **Fix:** Verified on prod, no code change required
- **Proof:** real paid request to `https://agentfolio.bot/api/profile/agent_p1reg_35028542/trust-score` returned HTTP 200 after Solana USDC x402 settlement. Payment response tx `59pQzQV1fPACjLeQqPsRWyYqoMXNuHG5kc76eCe2q1akBCxqWA5yJDqsnU35XLpuLAas9qev6hMhkYgV1aqi6a8x` moved 0.01 USDC from `JAbcYnKy4p2c5SYV3bHu14VtD6EDDpzj44uGYW8BMud4` to treasury `FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be`.
- **Status:** Verified on prod


### P1 — GET /api/reviews/:pda failed on live marketplace review accounts
- **Found during:** Phase 1 Flow 8 validation on CEO job `job_d2d2bb4054c0d9bb`
- **Symptom:** direct on-chain fetch route returned an offset parse error for live marketplace review PDA `Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3` even though the review tx and DB persistence both succeeded.
- **Root cause:** `satp-client/src/index.js#getReview` parsed a newer job-scoped review layout, while prod marketplace review builder writes the legacy `create_review` account layout from `satp-idls/reviews.json`.
- **Fix:** Commit `fdc9401` (`Fix SATP review reader for legacy marketplace accounts`)
- **Proof:** after deploy, `GET /api/reviews/Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3` returns parsed review JSON with reviewer/reviewed/rating/layout instead of an offset error.
- **Status:** Fixed and deployed

### P1 — Live marketplace review accounts returned null metadataJson
- **Found during:** Phase 1 Flow 8 validation on CEO job `job_d2d2bb4054c0d9bb`
- **Symptom:** `GET /api/reviews/:pda` returned the on-chain account after `fdc9401`, but `metadataJson` was still `null` for live marketplace reviews.
- **Root cause:** existing marketplace review accounts stored truncated metadata strings, so strict `JSON.parse(...)` failed even though key fields were still recoverable.
- **Fix:** Commit `b6d5107` (`Recover metadata from legacy marketplace review accounts`)
- **Proof:** after deploy, `GET /api/reviews/Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3` returns recovered `metadataJson` including `jobId`, `jobPDA`, `reviewerRole`, `revieweeId`, and `reviewerIdentity`.
- **Status:** Fixed and deployed

### P1 — Marketplace review builder emitted truncated invalid metadata for future review accounts
- **Found during:** Phase 1 Flow 8 validation on CEO job `job_d2d2bb4054c0d9bb`
- **Symptom:** fresh `/api/reviews/submit` builds serialized metadata by JSON-stringifying a large object and slicing to 240 chars, which could truncate the JSON mid-field and write invalid metadata to new on-chain review accounts.
- **Root cause:** `src/routes/reviews-routes.js` used arbitrary string slicing instead of a compact bounded metadata schema.
- **Fix:** Commit `7091551` (`Emit valid compact metadata for marketplace review txs`)
- **Proof:** after deploy, a fresh review build for `job_d2d2bb4054c0d9bb` decodes to `metadataLen=212` with valid JSON metadata containing `k`, `j`, `p`, `rr`, `re`, `i`, `q`, `rl`, and `c`.
- **Status:** Fixed and deployed

### P1 — /api/reviews/submit allowed reviews before escrow release
- **Found during:** Phase 1 Flow 8 validation on live job `job_121cdf8bdd5dd038`
- **Symptom:** `POST /api/reviews/submit` returned an unsigned on-chain review transaction for in-progress job `Hv6bstiCEeEzWkwzFjY7jDoALxiT37kfXr89384uVXn4` even though the spec requires reviews only after escrow release/completion.
- **Root cause:** `src/routes/reviews-routes.js` validated reviewer/job linkage but never checked job completion/release state or the 7-day review window.
- **Fix:** Commit `96234f7` (`Enforce marketplace review release window`)
- **Proof:** after deploy, the same in-progress job now returns `Reviews are only allowed for completed marketplace jobs with released escrow.`, while completed Flow 8 job `job_d2d2bb4054c0d9bb` still returns a valid review build with PDA `Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3`.
- **Status:** Fixed and deployed

### P1 — /api/reviews/submit trusted completed status without release proof
- **Found during:** Phase 1 Flow 8 validation on live job `job_5de0de03e053cf04`
- **Symptom:** after `96234f7`, `POST /api/reviews/submit` still returned an unsigned review tx for completed escrow `EGUyNoUMEB2zYPhYHHUSGtFUsr5i9PhKb15frBrHPeFs` even though the job file had no release proof (`fundsReleased=null`, `v3ReleasedAt=null`).
- **Root cause:** `src/routes/reviews-routes.js` treated `completedAt` as sufficient release evidence instead of requiring an explicit release signal.
- **Fix:** Commit `5be4da1` (`Require escrow release proof for marketplace reviews`)
- **Proof:** after deploy, the same unreleased-completed job now returns `Reviews are only allowed for completed marketplace jobs with released escrow.`, while released Flow 8 job `job_d2d2bb4054c0d9bb` still returns HTTP 200 with reviewPDA `Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3`.
- **Status:** Fixed and deployed

### P1 — /api/reviews/submit returned HTTP 500 for expected gating failures
- **Found during:** Phase 1 Flow 8 validation after release-gate fixes
- **Symptom:** invalid review submissions for unreleased jobs returned the correct error message but surfaced as HTTP 500, making user/input failures look like backend crashes.
- **Root cause:** `src/routes/reviews-routes.js` caught all submit-path exceptions and always responded with status 500.
- **Fix:** Commit `f7482fc` (`Return 400 for marketplace review gating errors`)
- **Proof:** after deploy, unreleased job `Hv6bstiCEeEzWkwzFjY7jDoALxiT37kfXr89384uVXn4` now returns HTTP 400 with `Reviews are only allowed for completed marketplace jobs with released escrow.`, while released Flow 8 job `job_d2d2bb4054c0d9bb` still returns HTTP 200 with reviewPDA `Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3`.
- **Status:** Fixed and deployed

### P1 — /api/reviews/respond returned HTTP 500 for malformed pubkeys
- **Found during:** Phase 1 Flow 8 review-route hardening
- **Symptom:** malformed `responder` / `reviewPDA` inputs returned HTTP 500 with low-level `Non-base58 character` instead of a client validation error.
- **Root cause:** `src/routes/reviews-routes.js` did not validate response route pubkeys before calling the SATP SDK, and the catch path always responded with status 500.
- **Fix:** Commit `015c228` (`Validate review response pubkeys`)
- **Proof:** after deploy, `POST /api/reviews/respond` with `responder=not-a-wallet` and `reviewPDA=also-not-a-pda` now returns HTTP 400 `Invalid responder pubkey`, while valid response build for review `Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3` by `Hfavc5HJoM4kxn28cLFg6VF2b2Fmpq8dxZTx3NStgjbn` still returns HTTP 200 with a transaction.
- **Status:** Fixed and deployed

### P1 — /api/reviews/pda/derive returned the wrong PDA for marketplace reviews
- **Found during:** Phase 1 Flow 8 review-route compatibility audit
- **Symptom:** deriving a PDA for live marketplace escrow `9Ri3EeKjurHhK16CUCV1zK6dqYLv9jWkqXTF45mw5vt8` and reviewer `84kXQBeL9jrPHN6WdR5Hivrq9P3czyaTfGz7ModV6yrE` returned `BAPAonto8y6LhWqeVESxZFcXn6U3rYjNzvUd2AWH7qZ`, but the actual on-chain review account created/read by Flow 8 is `Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3`.
- **Root cause:** `src/routes/reviews-routes.js` always used `getReviewV3PDA(job, reviewer, network)` even for marketplace compatibility mode, while submit/read paths still use the legacy review PDA derived from `revieweeWallet + reviewer`.
- **Fix:** Commit `cd15c89` (`Derive marketplace review PDAs in compatibility mode`)
- **Proof:** after deploy, `GET /api/reviews/pda/derive?job=9Ri3EeKjurHhK16CUCV1zK6dqYLv9jWkqXTF45mw5vt8&reviewer=84kXQBeL9jrPHN6WdR5Hivrq9P3czyaTfGz7ModV6yrE` now returns `Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3` with `compatibilityMode=legacy_create_review_with_job_binding`.
- **Status:** Fixed and deployed

### P1 — /api/reviews/:pda returned HTTP 200 for invalid non-review accounts
- **Found during:** Phase 1 Flow 8 review-read audit
- **Symptom:** `GET /api/reviews/11111111111111111111111111111111` returned HTTP 200 with an embedded parse error payload instead of a not-found response.
- **Root cause:** `src/routes/reviews-routes.js` only treated `null` as not-found; invalid/non-review accounts came back from `sdk.getReview(...)` as objects with an `error` field and were still returned as success JSON.
- **Fix:** Commit `7477896` (`Return 404 for invalid review accounts`)
- **Proof:** after deploy, `GET /api/reviews/11111111111111111111111111111111` now returns HTTP 404 `Review not found`, while live review `Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3` still returns HTTP 200 with parsed review data.
- **Status:** Fixed and deployed

### P1 — /api/reviews/respond built transactions for non-review accounts
- **Found during:** Phase 1 Flow 8 review-response integrity audit
- **Symptom:** `POST /api/reviews/respond` returned HTTP 200 with an unsigned transaction even when `reviewPDA=11111111111111111111111111111111`, which is not a real review account.
- **Root cause:** `src/routes/reviews-routes.js` validated pubkey format but never verified that the target account existed and parsed as a review before calling `buildRespondToReview(...)`.
- **Fix:** Commit `2c9b5f3` (`Require real review target for response builds`)
- **Proof:** after deploy, `POST /api/reviews/respond` for `11111111111111111111111111111111` now returns HTTP 404 `Review not found`, while valid review `Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3` still returns HTTP 200 with a transaction.
- **Status:** Fixed and deployed

### P1 — /api/reviews/respond allowed unrelated wallets to build responses
- **Found during:** Phase 1 Flow 8 review-response authorization audit
- **Symptom:** `POST /api/reviews/respond` returned HTTP 200 with an unsigned transaction both for the real reviewee wallet and for unrelated wallet `84kXQBeL9jrPHN6WdR5Hivrq9P3czyaTfGz7ModV6yrE` against review `Ej4i1YuSksv3CKGViMWa7jwjLFutmiv567doLYRpMua3`.
- **Root cause:** `src/routes/reviews-routes.js` validated pubkeys and target existence but never checked that the responder matched the review account’s `reviewed` wallet.
- **Fix:** Commit `f3fbfd6` (`Restrict review responses to reviewed wallet`)
- **Proof:** after deploy, the real reviewee wallet `Hfavc5HJoM4kxn28cLFg6VF2b2Fmpq8dxZTx3NStgjbn` still gets HTTP 200 with a transaction, while unrelated wallet `84kXQBeL9jrPHN6WdR5Hivrq9P3czyaTfGz7ModV6yrE` now gets HTTP 403 `Only the reviewed wallet may respond to this review`.
- **Status:** Fixed and deployed

### P1 — /api/reviews/submit accepted invalid reviewer identity strings
- **Found during:** Phase 1 Flow 8 review-submit integrity audit
- **Symptom:** `POST /api/reviews/submit` returned HTTP 200 and built a review transaction even when `reviewerIdentity=not-a-satp-identity`, allowing spoofed non-PDA identity data into review metadata.
- **Root cause:** `src/routes/reviews-routes.js` documented `reviewerIdentity` as a SATP Identity PDA but never validated it as a public key before building the transaction.
- **Fix:** Commit `56ff5a4` (`Validate reviewer identity pubkey on submit`)
- **Proof:** after deploy, the same request with `reviewerIdentity=not-a-satp-identity` now returns HTTP 400 `Invalid reviewerIdentity pubkey`, while valid identity `DVfGWbyKMa5FWZBzPLQtAhRxkpC3neKH5UgagzYYFXXJ` still returns HTTP 200 with a transaction.
- **Status:** Fixed and deployed

### P1 — /api/reviews/challenge accepted invalid rating values
- **Found during:** Phase 1 Flow 8 wallet-signed challenge audit
- **Symptom:** `POST /api/reviews/challenge` returned HTTP 200 and generated signed messages for `rating=9` and `rating=not-a-number`, embedding the raw invalid rating in the challenge message.
- **Root cause:** `src/api/review-challenge.js` only checked presence of `rating` and then stored a loosely parsed/clamped value without validating the original input as an integer 1-5.
- **Fix:** Commit `9eef364` (`Validate review challenge rating input`)
- **Proof:** after deploy, `rating=9` and `rating=not-a-number` now return HTTP 400 `rating must be an integer 1-5`, while `rating=5` still returns HTTP 200 with challenge message `AgentFolio Review | reviewer=agent_sm155533591 | reviewee=agent_sm155533592 | rating=5 | ...`.
- **Status:** Fixed and deployed

### P1 — wallet-signed review submit returned HTTP 500 for malformed wallet input
- **Found during:** Phase 1 Flow 8 wallet-signed challenge/submit audit
- **Symptom:** after generating a valid review challenge, `POST /api/reviews/submit` with `walletAddress=not-a-wallet` returned HTTP 500 `Non-base58 character` instead of a client validation error.
- **Root cause:** `src/api/review-challenge.js` decoded `walletAddress` with `bs58.decode(...)` outside a safe validation branch, so malformed input threw into the route-level 500 catch.
- **Fix:** Commit `2c4b546` (`Return 400 for invalid review submit wallet input`)
- **Proof:** after deploy, the same malformed-wallet request now returns HTTP 400 `Invalid wallet format`, while a real wallet with bogus signature still returns the expected HTTP 400 `Invalid signature or wallet format`.
- **Status:** Fixed and deployed

### P1 — /api/reviews/challenge accepted unsupported chains
- **Found during:** Phase 1 Flow 8 wallet-signed challenge audit
- **Symptom:** `POST /api/reviews/challenge` returned HTTP 200 and minted challenges for `chain=ethereum` and even `chain=banana`, even though production submit only supports Solana signed reviews.
- **Root cause:** `src/api/review-challenge.js` stored `chain` verbatim (defaulting only when absent) and deferred chain rejection until submit time, creating unusable challenges.
- **Fix:** Commit `9110e8c` (`Reject unsupported review challenge chains`)
- **Proof:** after deploy, `chain=ethereum` and `chain=banana` now return HTTP 400 `Only Solana signed reviews are enabled on production.`, while `chain=solana` still returns HTTP 200 with a challenge.
- **Status:** Fixed and deployed

### P1 — /api/reviews/challenge minted unusable challenges for nonexistent or ineligible pairs
- **Found during:** Phase 1 Flow 8 wallet-signed challenge eligibility audit
- **Symptom:** `POST /api/reviews/challenge` returned HTTP 200 for ghost reviewer/reviewee IDs and for real agent pairs with no released escrow, even though submit could never complete those reviews.
- **Root cause:** `src/api/review-challenge.js` generated challenges before checking profile wallet linkage or released-escrow review rights.
- **Fix:** Commit `55f2b61` (`Gate review challenges on eligible escrow pairs`)
- **Proof:** after deploy, eligible pair `agent_sm155533591 -> agent_sm155533592` still returns HTTP 200 with a challenge, ghost pair now returns HTTP 404 `Reviewer and reviewee must have linked Solana wallets.`, and no-escrow pair `phase1_test_1_694120 -> agent_p1reg_35028542` now returns HTTP 403 `No released escrow job found between these agents. Reviews require completed funded escrow.`
- **Status:** Fixed and deployed

### P1 — /api/reviews/submit allowed reviewerIdentity spoofing with foreign SATP PDAs
- **Found during:** Phase 1 Flow 8 review-submit integrity audit
- **Symptom:** `POST /api/reviews/submit` returned HTTP 200 both for the reviewer's real wallet with a foreign valid SATP PDA and for the same wallet with arbitrary profile-mismatched identity data, allowing review metadata to impersonate another agent's on-chain identity.
- **Root cause:** `src/routes/reviews-routes.js` validated `reviewerIdentity` as a pubkey but never checked that it matched the reviewer profile's stored SATP genesis PDA.
- **Fix:** Commit `7c08451` (`Bind marketplace reviewer identity to profile`)
- **Proof:** after deploy, reviewer wallet `84kXQBeL9jrPHN6WdR5Hivrq9P3czyaTfGz7ModV6yrE` with its actual profile SATP PDA `2eAwU2kFZrqL96DoE4Wo4X8CEM9j3M9XyNmHJ2vxUtBd` still returns HTTP 200 with a transaction, while foreign valid PDA `RzFWScbp4RpKE8m8DRW4VAsfUHgekSxvQwRzo6UkPTi` now returns HTTP 400 `reviewerIdentity does not match reviewer profile.`
- **Status:** Fixed and deployed

### P1 — Public profile exposed review form to anonymous ineligible visitors
- **Found during:** Phase 1 Flow 8 public-profile verification
- **Symptom:** `/profile/:id` rendered the `Write a Review` form for anonymous visitors even when no wallet or escrow-eligible review context existed.
- **Root cause:** `frontend/src/app/profile/[id]/WriteReviewForm.tsx` only hid the form after a wallet-driven escrow check, so anonymous page loads skipped the guard and exposed the UI.
- **Fix:** Commit `a75b0c4` (`Hide review form for ineligible public viewers`)
- **Proof:** before fix, anonymous live HTML for `https://agentfolio.bot/profile/phase1_test_1_694120` contained `✍️ Write a Review` and `🔐 Sign & Submit Review`; after deploy those strings are absent and a fresh browser screenshot shows the review list without the form.
- **Status:** Fixed and deployed

## Open / Blocked

- None currently. Latest previously-blocked Flow 8 reciprocal review on CEO job `job_d2d2bb4054c0d9bb` is now complete and verified on-chain in both directions.
