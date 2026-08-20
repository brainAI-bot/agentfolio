# Escrow V3 Runtime Re-certification [#ef7e4581]

Read-only observation: `2026-08-20T15:29:23Z`.

This packet re-certifies the replacement mainnet runtime after upgrade
transaction
`3dKQibtuBon7f8dL9DSjsjCwLr1N9pw6pbgR1Kg69wTAnfwkA8RbKn4e7sqH39yhwwWEHkpWhhDxSG62DeBEsy1E`.
It performs no deploy, IDL publish, authority change, keypair action, npm
publish, or Solana write. `ROADMAP.md` is intentionally unchanged.

## Runtime readback

| Field | Read-only mainnet-beta result |
| --- | --- |
| Program | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` |
| ProgramData | `Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk` |
| Upgrade authority | `Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc` |
| Upgrade slot / UTC | `440327121` / `2026-08-19T19:37:14Z` |
| ProgramData payload | `346856` bytes; 15 trailing allocation bytes |
| Trimmed deployed ELF | `346841` bytes; SHA-256 `88058f4322bb8cbb9227b6f35ae3c78baf2be9c01a3bd70523f803f9bfa7f078` |

The verifier follows the upgradeable-loader Program account to ProgramData,
decodes the slot and authority from the ProgramData header, fetches the upgrade
transaction, hashes the live bytes, and fails closed if any pinned runtime
field drifts.

## Candidate source and reproducible build result

The closest repository candidate source is pinned to `brainAI-bot/satp` commit
`0bf088e5618f173dff7e0fba622bc2911212c52e`, which merged before the upgrade.
Its `programs/escrow_v3/src/lib.rs` SHA-256 is
`f4696cc27c5e2ff6163a90f877fd4431efa8809d2f6ae4c792c3c7cd18193c4d`.

The workflow checks out that exact commit on `macos-latest`, pins Rust 1.86.0,
Solana CLI 2.1.21, and SBF platform-tools v1.52, performs a clean explicit
`mainnet`-feature `cargo build-sbf`, and byte-compares the fresh artifact with the live
ProgramData payload. This is the same source/toolchain family whose 2026-08-19
SATP main-branch CI run produced the devnet-feature artifact before the
upgrade; this packet adds the missing explicit-mainnet reproduction gate.

The comparison is not equal:

| Build profile | Fresh artifact | Deployed ProgramData payload | Verdict |
| --- | --- | --- | --- |
| default | `346856` bytes; SHA-256 `bba42f0b11ee1be4d1449176facdc7a83b0e491bfc246427091e1a62a02dc42f` | `346856` bytes; SHA-256 `53e922d8792d3ec2d447c497f37dfe8e4ffd1d9bde0f9d6edc0bb3578e67c17f` | DIFFER |
| `mainnet` feature | `346856` bytes; SHA-256 `4f21da13659cbe99a606b408a5f1d3523c0e41de20538028939bbb1b54c3cc0d` | `346856` bytes; SHA-256 `53e922d8792d3ec2d447c497f37dfe8e4ffd1d9bde0f9d6edc0bb3578e67c17f` | DIFFER |

The deployed payload has 15 trailing allocation zero bytes; removing them
produces the required `346841`-byte / `88058f...` runtime hash. Neither fresh
candidate build equals the allocated payload or the trimmed runtime bytes.
Therefore commit `0bf088e` is not reproducible provenance for this deployment.

## IDL readback

The pinned source-generated IDL is
`satp/idls/v3/escrow_v3.json`, SHA-256
`3d7e7a14788449f65c1a187a96543f7677bf08937e61638734ed3886dcf60a5a`.
The workflow runs `node scripts/generate-v3-idls.mjs --check` and
`python3 scripts/validate-idls.py` at the pinned source commit before building.

The mainnet published Anchor IDL account remains
`D2TVCWarEDQ3w3YFMpackzymm9MGQKeWd1p1pCeZmBcn`. Its inflated JSON is 12,172
bytes with SHA-256
`864e8af057c1b196156222ecda5853936bf4c6e0f3ae9f5c1e2ca2e53ed6c768`
and advertises nine SOL instructions. The generated source IDL advertises 14
instructions; the five absent from the published IDL are
`create_usdc_escrow`, `release_usdc`, `partial_release_usdc`, `cancel_usdc`,
and `resolve_dispute_usdc`.

## Verdict

The automated packet has three independent gates:

1. pinned source and toolchain reproduce the deployed ProgramData bytes;
2. the source IDL regeneration check passes;
3. the regenerated source IDL instruction surface equals the published
   mainnet Anchor IDL instruction surface.

The runtime identity gate passes. The source-build gate fails on the exact
hashes above, and the IDL comparison independently records the observed
five-instruction mismatch. Therefore
`source == deployed binary == published IDL` remains **not certified**.

The concrete unblock is the authoritative source commit plus complete locked
build inputs that reproduce deployed payload SHA-256 `53e922...` (trimmed
`88058f...`), together with a source-generated/published IDL resolution. A
separately authorized IDL publication may close the IDL gap only after the
binary provenance gap is closed; neither action is performed by this PR.

## Reproduction

Runtime-only readback:

```sh
node scripts/verify-escrow-v3-runtime-recert.mjs
```

Full CI comparison after the pinned SATP clean build:

```sh
node scripts/verify-escrow-v3-runtime-recert.mjs \
  --artifact satp/target/deploy/escrow_v3.so \
  --source satp/programs/escrow_v3/src/lib.rs \
  --source-idl satp/idls/v3/escrow_v3.json \
  --source-commit 0bf088e5618f173dff7e0fba622bc2911212c52e
```
