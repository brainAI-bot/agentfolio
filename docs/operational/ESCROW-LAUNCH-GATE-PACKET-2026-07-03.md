# Escrow Launch Gate Packet - 2026-07-03

## Scope

Read-only launch-gate packet for AgentFolio on-chain escrow. This packet did not deploy, restart, submit Solana transactions, use keypairs, move funds, mutate credentials, perform admin actions, or launch publicly.

## Repo Readback

- Repository: `brainAI-bot/agentfolio`
- Branch base: `main`
- Base commit: `ee7260ff3f03b588d53736a5dd51e771d733fe13`
- Escrow API entrypoint: `src/routes/escrow-v3-routes.js`
- Server gate: `src/lib/write-surface-gate.js`
- Frontend gate: `frontend/src/lib/write-surface-gate.ts`
- Frontend transaction helper: `frontend/src/lib/v3-escrow.ts`
- Public release notice: `frontend/src/components/ReleaseGateNotice.tsx`

Current repo state already has V3 escrow transaction builders behind live-funds gates:

- `GET /api/v3/escrow/health` reports SDK availability and live escrow gate state.
- `GET /api/v3/escrow/pda/derive` derives a PDA without an RPC write.
- All `POST /api/v3/escrow/*` routes are guarded by `sendLiveEscrowGateResponse` before transaction builder execution.
- Frontend funding and release paths call both Solana/Irys and live-escrow write assertions before wallet signing.
- Public shell copy states that escrow live-funds writes remain gated pending security re-review.

## Production Readback

Read-only probes against `https://agentfolio.bot` at 2026-07-03 15:13 UTC:

```text
GET /api/v3/escrow/health -> 200
network: devnet
sdkAvailable: true
liveEscrow.enabled: false
liveEscrow.killSwitchActive: false
liveEscrow.status: live_funds_gated_pending_security_review
liveEscrow.liveFundsCleared: false
liveEscrow.verifiedRuntime.network: devnet
liveEscrow.verifiedRuntime.pdaDerive: verified
liveEscrow.runtimeNetwork: devnet
liveEscrow.mainnetLiveFundsCleared: false
enableWith: AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES
killSwitchEnv: AGENTFOLIO_ESCROW_KILL_SWITCH
```

```text
GET /api/v3/escrow/pda/derive?clientWallet=FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be&description=launch-gate-readback&nonce=0 -> 200
escrowPDA: 3RkwPKyYioQgzxghhsBnEBSsaJnZ2H8Uc4vL3ZvNK3aG
descriptionHash: 0c675dad333ae70cdfcce33db23d82b57fced552920d5633f894b5024351e133
bump: 255
network: devnet
```

```text
POST /api/v3/escrow/create with unsigned builder probe body -> 423
code: LIVE_ESCROW_WRITES_READ_ONLY
operation: SATP V3 escrow POST /create
liveEscrow.status: live_funds_gated_pending_security_review
liveEscrow.mainnetLiveFundsCleared: false
```

```text
GET /marketplace -> 200
release-gate copy present: true
"No completion banner is present": true
"Escrow live-funds writes": true
```

## Code Gap Closed In This PR

The frontend `deriveV3EscrowPDA` helper did not exactly match the server response contract. The server returns `escrowPDA`, but the helper returned `data.pda`; the helper also used the backward-compatible `client` query alias instead of the primary `clientWallet` parameter. This PR switches the helper to `clientWallet` and returns `data.escrowPDA`, with a narrow source-contract test.

## Remaining Launch Gaps

1. Production is intentionally not live-funds cleared: `/api/v3/escrow/health` reports `liveEscrow.status=live_funds_gated_pending_security_review` and `mainnetLiveFundsCleared=false`.
2. Production escrow runtime is still devnet-scoped: `/api/v3/escrow/health` reports `network=devnet` and `runtimeNetwork=devnet`.
3. Mainnet live-funds enablement remains outside this PR because it requires the security re-review and environment gate decision named by `AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES`.
4. Legacy escrow documentation/code still exists alongside the V3 gated route surface, so any public launch copy must continue pointing to the V3 gated status until that legacy surface is retired or clearly marked non-live.

## Commands Run

```text
npm ci
node --test tests/escrow-v3-pda-query.test.js tests/escrow-v3-selected-agent.test.js tests/release-gate-truth.test.js
node --test tests/escrow-v3-pda-query.test.js
node --test tests/escrow-v3-selected-agent.test.js
node --test tests/release-gate-truth.test.js tests/v3-escrow-helper-contract.test.js
```

The first targeted test run before dependency install failed with `MODULE_NOT_FOUND: express`. After `npm ci`, one combined run exposed a `SQLITE_BUSY` lock between route tests; the same tests passed when run in isolated commands as listed above.
