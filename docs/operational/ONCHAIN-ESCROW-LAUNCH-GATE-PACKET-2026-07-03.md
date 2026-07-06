# AgentFolio On-chain Escrow Launch-gate Packet

Date: 2026-07-03 15:20 UTC
Source commit: `ee7260f` (`origin/main`)
Production: `https://agentfolio.bot`

## Scope

This packet is a PR-first launch-gate readback for the AgentFolio SATP V3 escrow path. It does not deploy, restart, perform Solana writes, use keypairs, move funds, mutate credentials, perform admin/client actions, or launch publicly.

## Current Repo Readback

- V3 escrow API is mounted in `src/routes/escrow-v3-routes.js`.
- V3 escrow helper is present in `frontend/src/lib/v3-escrow.ts`.
- Server write gating is centralized in `src/lib/write-surface-gate.js`.
- Focused V3 escrow coverage exists in:
  - `tests/escrow-v3-pda-query.test.js`
  - `tests/escrow-v3-selected-agent.test.js`
- `origin/main` already includes selected-agent identity routing for job-backed escrow create requests in commit `ee7260f`.

## Production Readback

Read-only checks were run against production on 2026-07-03 15:19 UTC.

### Health

Command:

```sh
curl -sS -i https://agentfolio.bot/api/v3/escrow/health
```

Result:

- HTTP `200`
- `network`: `devnet`
- `sdkAvailable`: `true`
- `liveEscrow.enabled`: `false`
- `liveEscrow.killSwitchActive`: `false`
- `liveEscrow.status`: `live_funds_gated_pending_security_review`
- `liveEscrow.runtimeNetwork`: `devnet`
- `liveEscrow.mainnetLiveFundsCleared`: `false`
- `liveEscrow.enableWith`: `AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES`
- `liveEscrow.killSwitchEnv`: `AGENTFOLIO_ESCROW_KILL_SWITCH`

### PDA Derive

Command:

```sh
curl -sS -i 'https://agentfolio.bot/api/v3/escrow/pda/derive?clientWallet=FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be&description=gate-packet-readback&nonce=0'
```

Result:

- HTTP `200`
- `escrowPDA`: `2hjK2XBsfr6xrqtmhu9eDxJpie54KoP3jr8yBZe23Sbc`
- `descriptionHash`: `ca2134d339f9684733127854685a588fd020ad62ae8e0741eb6ce1902d7f52f5`
- `bump`: `252`
- `network`: `devnet`

### Gated Create POST

Command:

```sh
curl -sS -i https://agentfolio.bot/api/v3/escrow/create \
  -H 'Content-Type: application/json' \
  --data '{"clientWallet":"FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be","agentWallet":"11111111111111111111111111111112","agentId":"agent_gate_packet","amountLamports":1,"description":"gate packet readback","deadlineUnix":1793632765}'
```

Result:

- HTTP `423`
- `code`: `LIVE_ESCROW_WRITES_READ_ONLY`
- `operation`: `SATP V3 escrow POST /create`
- `liveEscrow.status`: `live_funds_gated_pending_security_review`
- `liveEscrow.mainnetLiveFundsCleared`: `false`

This confirms production fails closed before returning an unsigned live-funds transaction.

## Exact Gaps Before Public Escrow Launch

1. Runtime gap: production is still devnet/read-only for escrow funds. `AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES` is not enabled, and `mainnetLiveFundsCleared` is `false`.
2. Security gate gap: the live-funds security re-review has not cleared the mainnet escrow path.
3. Operator gate gap: after security clearance, the deployment operator must explicitly set `AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES` and keep `AGENTFOLIO_ESCROW_KILL_SWITCH` available for rollback.
4. Evidence gap: no mainnet live-funds smoke can be produced without an approved signing/funds/keypair action, which this task explicitly excludes.
5. Documentation gap closed by this PR: there was no dated launch-gate packet tying the repo state to production health, PDA derivation, gated POST behavior, and remaining owner/security gates.

## Launch Decision

Do not public-launch on-chain escrow yet. The repo exposes the V3 escrow route and selected-agent identity gate, and production read-only checks pass, but live-funds escrow remains intentionally blocked pending security re-review and an explicit operator-controlled environment change.

## Verification

Commands run for this packet:

```sh
curl -sS -i https://agentfolio.bot/api/v3/escrow/health
curl -sS -i 'https://agentfolio.bot/api/v3/escrow/pda/derive?clientWallet=FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be&description=gate-packet-readback&nonce=0'
curl -sS -i https://agentfolio.bot/api/v3/escrow/create -H 'Content-Type: application/json' --data '{"clientWallet":"FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be","agentWallet":"11111111111111111111111111111112","agentId":"agent_gate_packet","amountLamports":1,"description":"gate packet readback","deadlineUnix":1793632765}'
NODE_PATH=/Users/brainforge/clawd/agentfolio/node_modules node --test tests/escrow-v3-selected-agent.test.js
NODE_PATH=/Users/brainforge/clawd/agentfolio/node_modules node --test tests/escrow-v3-pda-query.test.js
```

The two focused escrow test files passed when run sequentially. A combined concurrent Node test invocation first hit `SQLITE_BUSY` on the test database; no code change was made for that existing test-process contention.

No deploy, restart, Solana write, keypair, money movement, credential mutation, admin/client action, Masthead action, or public launch was performed.
