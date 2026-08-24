# Escrow V3 Runtime Provenance Re-certification [#ef7e4581]

Read-only observation: `2026-08-24T07:47:44.921Z`.

This receipt re-certifies the deployed SATP escrow V3 runtime identity on
`mainnet-beta` and records the currently checkable source, build-input,
toolchain, artifact, and published-IDL chain. It performs no deploy, program
upgrade, IDL publication, authority change, keypair action, or Solana write.
`ROADMAP.md` is intentionally unchanged.

## Deployed runtime

| Field | Pinned value |
| --- | --- |
| Cluster | `mainnet-beta` |
| Program ID | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` |
| ProgramData account | `Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk` |
| Upgrade authority | `Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc` |
| Upgrade transaction | `3dKQibtuBon7f8dL9DSjsjCwLr1N9pw6pbgR1Kg69wTAnfwkA8RbKn4e7sqH39yhwwWEHkpWhhDxSG62DeBEsy1E` |
| Upgrade slot / UTC | `440327121` / `2026-08-19T19:37:14Z` |
| Allocated ProgramData payload | `346856` bytes; SHA-256 `53e922d8792d3ec2d447c497f37dfe8e4ffd1d9bde0f9d6edc0bb3578e67c17f` |
| Trimmed deployed ELF | `346841` bytes; SHA-256 `88058f4322bb8cbb9227b6f35ae3c78baf2be9c01a3bd70523f803f9bfa7f078` |

The live readback passed every pinned runtime check at the observation time.
Reviewers can independently inspect the
[program](https://explorer.solana.com/address/HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C?cluster=mainnet-beta)
and [upgrade transaction](https://explorer.solana.com/tx/3dKQibtuBon7f8dL9DSjsjCwLr1N9pw6pbgR1Kg69wTAnfwkA8RbKn4e7sqH39yhwwWEHkpWhhDxSG62DeBEsy1E?cluster=mainnet-beta),
or reproduce the complete RPC readback from this repository:

```sh
node scripts/verify-escrow-v3-runtime-recert.mjs
```

The verifier follows the upgradeable-loader Program account to ProgramData,
checks its owner, slot and authority, checks the upgrade transaction, hashes
both the allocated payload and its trailing-zero-trimmed ELF, and reads the
published Anchor IDL account.

## Source and locked build inputs

The closest source candidate remains
[`brainAI-bot/satp@0bf088e5618f173dff7e0fba622bc2911212c52e`](https://github.com/brainAI-bot/satp/commit/0bf088e5618f173dff7e0fba622bc2911212c52e).
The inputs used by the provenance workflow are pinned as follows:

| Input | SHA-256 or version |
| --- | --- |
| `programs/escrow_v3/src/lib.rs` | `f4696cc27c5e2ff6163a90f877fd4431efa8809d2f6ae4c792c3c7cd18193c4d` |
| `Cargo.lock` | `d98db19e0d86ca3248376d4857b150b240be05c4bc3a409d7cb638ce4d5d2237` |
| `rust-toolchain.toml` | `615e131a336708d73f4b69a4a4a5a6f96b10f4399a1a075408e0616cda21544b` |
| `Anchor.toml` | `785c886cbd5a583171293a268319f76e462f6c05b13d354f245dd853cf34e45c` |
| Rust | `1.86.0` |
| Solana CLI | `2.1.21` |
| SBF platform-tools | `v1.52` |
| Build runner | GitHub Actions `macos-latest` |

The clean explicit-mainnet build command is:

```sh
cargo clean --manifest-path programs/escrow_v3/Cargo.toml
cargo build-sbf --force-tools-install --tools-version v1.52 \
  --manifest-path programs/escrow_v3/Cargo.toml --features mainnet
shasum -a 256 target/deploy/escrow_v3.so
wc -c target/deploy/escrow_v3.so
```

The pinned candidate produces a `346856`-byte artifact with SHA-256
`4f21da13659cbe99a606b408a5f1d3523c0e41de20538028939bbb1b54c3cc0d`.
It does **not** equal the allocated deployed payload hash `53e922d8...` or the
normalized deployed hash `88058f43...`. The source candidate is therefore an
auditable negative result, not a certified source-to-runtime match. The
[merged provenance run](https://github.com/brainAI-bot/agentfolio/actions/runs/32424457173/job/96603379505)
records the same pinned toolchain and comparison.

## Published IDL

| Field | Pinned value |
| --- | --- |
| Source-generated IDL | [`satp/idls/v3/escrow_v3.json` at `0bf088e`](https://github.com/brainAI-bot/satp/blob/0bf088e5618f173dff7e0fba622bc2911212c52e/idls/v3/escrow_v3.json) |
| Source IDL SHA-256 | `3d7e7a14788449f65c1a187a96543f7677bf08937e61638734ed3886dcf60a5a` |
| Published Anchor IDL account | `D2TVCWarEDQ3w3YFMpackzymm9MGQKeWd1p1pCeZmBcn` |
| Published inflated JSON | `12172` bytes; SHA-256 `864e8af057c1b196156222ecda5853936bf4c6e0f3ae9f5c1e2ca2e53ed6c768` |

The source-generated IDL exposes 14 instructions; the published mainnet IDL
exposes nine. The published IDL omits `create_usdc_escrow`, `release_usdc`,
`partial_release_usdc`, `cancel_usdc`, and `resolve_dispute_usdc`.

## Verdict

Runtime identity is re-certified at trimmed SHA-256 `88058f43...`. The
available source candidate, deterministic build inputs and toolchain, fresh
artifact hashes, and published IDL are all pinned and independently
checkable. Full `source == deployed binary == published IDL` provenance is
**not certified** because both the rebuilt binary and IDL surfaces differ.
Closing that gap requires the authoritative deployed source/build packet and
a separately authorized IDL resolution; this receipt does not perform either
write action.
