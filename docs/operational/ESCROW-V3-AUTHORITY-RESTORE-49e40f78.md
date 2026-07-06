# Escrow V3 Authority Restore [#49e40f78]

Date: 2026-07-05

## Scope

This packet restores the AgentFolio-side authority readback for `escrow_v3` without Solana writes, keypair actions, credential mutation, production deploys, public launch steps, or `ROADMAP.md` edits.

The HQ-selected authority target is:

```text
escrow_v3 program id: 4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a
```

## Tracked Authority Paths

The source and IDL authority path is intentionally explicit and machine-checkable:

| Artifact | Required tracked path | Policy |
| --- | --- | --- |
| Anchor workspace | `onchain/escrow_v3/Anchor.toml` | Must declare the `escrow_v3` program and the same `4qx9...` id before release. |
| Program source | `onchain/escrow_v3/programs/escrow_v3/src/lib.rs` | Must be the audited source used for the rebuild. |
| Regenerated IDL | `onchain/escrow_v3/target/idl/escrow_v3.json` | Must be regenerated from the tracked source; its `address` must equal `4qx9...`. |
| SATP client artifact | `@brainai/satp-client` commit pinned in `package-lock.json` | Its V3 runtime `ESCROW` and packaged escrow IDL address must equal `4qx9...`. |
| AgentFolio health readback | `GET /api/v3/escrow/health` | Must expose `escrowAuthority` and fail closed while any source/IDL/runtime address diverges. |

Current readback on this PR shows the authority path is not yet fully reconstructed: the repo lacks the tracked `onchain/escrow_v3` source/IDL workspace, the SATP V3 client reports `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`, and the packaged legacy escrow IDL reports `UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22`. Therefore live escrow writes stay gated.

## Read-only Verification

Local readback:

```sh
npm ci
node scripts/verify-escrow-v3-authority.js
node scripts/verify-escrow-v3-authority.js --strict
node --test tests/escrow-v3-authority.test.js tests/escrow-v3-pda-query.test.js tests/satp-client-dependency-boundary.test.js
```

The non-strict command prints JSON evidence and exits zero for PR review. The strict command exits non-zero until source, IDL, packaged SATP metadata, and runtime constants all agree on `4qx9...`.

Optional deployed read-only comparison, when the Solana CLI is available:

```sh
solana program show 4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a --url devnet
solana program show 4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a --url mainnet-beta
```

These are read-only. Do not run deploy, upgrade, keypair, airdrop, or transaction submission commands as part of this authority packet.

## Rebuild Policy

When the authoritative escrow source is restored or reconstructed, the rebuild must happen from the tracked workspace only:

```sh
cd onchain/escrow_v3
anchor build
```

Then commit the regenerated IDL and capture:

- Anchor version and Solana CLI version.
- Source commit.
- Program binary SHA-256.
- IDL SHA-256.
- `solana program show` readback for `4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a`.

Do not publish launch claims or enable `AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES` until `node scripts/verify-escrow-v3-authority.js --strict` passes and the operator/security gates explicitly clear live-funds escrow.
