# AgentFolio On-chain Escrow Program Gate Packet [#ed3999ac]

Date: 2026-07-05
Source commit: `15cfa1c`
Branch: `brainforge/escrow-program-gate-packet-ed3999ac-20260705`

## Scope

This is a PR-first fix plan for the AgentFolio escrow release gate. It does not deploy, sign transactions, move funds, rotate keys, restart services, enable live escrow writes, or perform a mainnet action.

The release gate remains closed until the production path is verified as genuine on-chain program escrow and is no longer described as custodial escrow.

## Program ID Split-brain Readback

| Source | Escrow program readback | Status |
| --- | --- | --- |
| HQ task source readback | `B1Se8SP...` | Candidate audited source identity from `clawd-brainchain`; full fingerprint belongs in HQ evidence only. |
| Runtime SATP V3 client | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` | Current AgentFolio V3 runtime program ID via `@brainai/satp-client` `getV3ProgramIds(...).ESCROW`. |
| Packaged legacy IDL metadata | `UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22` | Legacy `idls/satp_escrow.json` address in the SATP client package, not aligned with V3 runtime. |
| AgentFolio legacy wiring doc | `4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a` | Obsolete docs-only reference in `docs/ONCHAIN-WIRING-PLAN.md`; must not be used for launch claims. |

Resolution requirement: the next release-candidate path must make source, deploy artifact, IDL metadata, SDK constants, and AgentFolio runtime all name the same escrow program ID before live escrow writes can be enabled.

## Required PR Sequence

### PR 1: SATP escrow artifact truth

Owner: `brainChain`

Goal: make the escrow program artifact self-consistent before AgentFolio consumes it.

Required changes:

- Select the canonical escrow source tree for the deployed `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` program, or produce a replacement devnet deploy from the audited source.
- Regenerate the escrow IDL from the selected source.
- Update IDL address metadata so it matches the selected program ID.
- Add artifact verification output: source commit, Anchor/Solana toolchain versions, program binary hash, IDL hash, and `solana program show` readback for the deployed devnet program.
- Preserve the full source/deployed/IDL fingerprints in HQ evidence, not in public repo docs, if they are operationally sensitive.

Acceptance:

- `source program id == deployed devnet program id == IDL address == SATP V3 SDK ESCROW`.
- No mainnet deploy or signing.
- Existing `UpJ7...` and `B1Se8SP...` ambiguity is either removed or documented as superseded by the same verified artifact.

### PR 2: AgentFolio escrow runtime pin

Owner: `brainForge`

Goal: consume the verified SATP artifact and fail closed on mismatch.

Required changes:

- Bump `@brainai/satp-client` to the verified artifact commit.
- Add a runtime truth test asserting `getV3ProgramIds('mainnet').ESCROW` and `getV3ProgramIds('devnet').ESCROW` equal the verified escrow program ID.
- Add a route-level health field showing `escrowProgramId`, `artifactCommit`, and `idlHash` from the SATP client package.
- Keep `AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES` disabled until security review and operator approval are complete.

Acceptance:

- AgentFolio V3 escrow health and tests fail closed if SDK constants and packaged IDL metadata diverge.
- Production remains read-only for live funds.

### PR 3: Payment replay guard

Owner: `brainChain` for program logic, `brainForge` for AgentFolio route tests.

Goal: close the 2026-07-02 payment-replay race.

Required changes:

- Program enforces a unique escrow nonce or description hash tuple per client/job.
- Program rejects repeated release, partial release, refund, or dispute resolution after terminal settlement.
- AgentFolio tests prove duplicate create/release/refund requests cannot produce a second valid unsigned settlement path.

Acceptance:

- Replay attempts return a deterministic error before any second settlement path is built or submitted.

### PR 4: Authorized release/refund boundary

Owner: `brainChain` for program accounts, `brainForge` for API guardrails.

Goal: close unauthorized release/refund paths from the 2026-07-02 findings.

Required changes:

- Release requires the client signer or approved arbiter authority for the escrow PDA.
- Refund requires the client signer when deadline/no-agent conditions are met, or the approved arbiter for a disputed settlement.
- Auto-release authority is separated from deploy/upgrade authority and can only act after the on-chain deadline.
- AgentFolio route tests reject caller/client/arbiter mismatch before returning unsigned transactions.

Acceptance:

- No operational signer can unilaterally release or refund a live escrow unless the on-chain role and state machine allow it.

### PR 5: Identity binding hardening

Owner: `brainForge`

Goal: close identity binding drift in job-backed escrow creation.

Required changes:

- Keep `job.selected_agent_id` authoritative for V3 Genesis lookup.
- Reject request `agentId` values that differ from the selected job agent.
- Add a permanent regression test covering selected-agent lookup and mismatched request `agentId`.
- Include the selected Genesis PDA/program ID in non-sensitive health/readback evidence.

Acceptance:

- A poster cannot bind funds to one job worker while creating escrow against another identity.

## Key Separation Roles

No key material belongs in this repo or PR body. Fingerprints only belong in HQ evidence.

| Role | Purpose | Must not be reused for |
| --- | --- | --- |
| Program deploy authority | Deploy devnet escrow program and produce artifact readback. | Runtime escrow operations, fee payment, user signing, custody, or server env secrets. |
| Program upgrade authority | Approve or freeze program upgrades after audit. Prefer multisig or hardware-backed custody. | Day-to-day route operations, crank jobs, RPC access, or treasury movement. |
| Operational crank signer | Submit allowed auto-release or maintenance instructions after on-chain deadlines. | Program deploys/upgrades, client release, client refund, or arbiter dispute resolution. |
| Client signer | Create escrow, release funds, or request refund only for that client's escrow state. | Program upgrades, platform operations, or other clients' escrows. |
| Agent signer | Submit work and receive payout according to escrow state. | Client release/refund authority, program upgrades, or platform crank authority. |
| Arbiter signer | Resolve disputes only for escrows that nominate that arbiter. | Program deployment, global refund/release, or non-disputed escrow settlement. |
| Treasury fee receiver | Receive configured protocol fees. | Signing program instructions or operating upgrade/deploy roles. |
| RPC provider key | Network access only. | Any wallet, deploy, upgrade, escrow, treasury, or user-signing authority. |

## Devnet Deploy Plan

1. Build from the audited escrow source tree with a pinned Anchor and Solana toolchain.
2. Regenerate IDL from the same source commit.
3. Deploy to devnet with the program deploy authority only.
4. Immediately read back `solana program show <PROGRAM_ID>` and capture executable data length, authority fingerprint, and slot.
5. Hash the program artifact and IDL.
6. Publish SATP client artifact PR with `ESCROW` constant and IDL metadata set to the same program ID.
7. Consume the SATP client artifact in AgentFolio and run focused escrow route tests.
8. Keep AgentFolio production live-funds writes disabled until the security review signs off and the operator intentionally enables `AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES`.

## Verification Commands

These commands are read-only or local-test only:

```sh
NODE_PATH=/Users/brainforge/clawd/agentfolio/node_modules node -e "const c=require('@brainai/satp-client'); console.log(c.getV3ProgramIds('mainnet').ESCROW.toBase58())"
NODE_PATH=/Users/brainforge/clawd/agentfolio/node_modules node --test tests/escrow-v3-pda-query.test.js
NODE_PATH=/Users/brainforge/clawd/agentfolio/node_modules node --test tests/escrow-v3-selected-agent.test.js
```

## Gate Decision

Do not enable AgentFolio live escrow writes yet. The correct next step is the PR sequence above, beginning with SATP escrow artifact truth, then AgentFolio runtime pinning and route tests. Mainnet deploy/signing remains explicitly out of scope for this packet.
