# Escrow V3 Runtime Provenance Re-certification [#ef7e4581]

Evidence observed: `2026-08-31T17:31:46.888Z`.

This packet re-certifies the source/build boundary and records the published-IDL
boundary for the escrow V3 runtime installed on `2026-08-30`. It is read-only:
no runtime redeploy, Solana write, signer or keypair action, IDL/package
publication, production mutation, or public launch action was performed.
`ROADMAP.md` is intentionally unchanged.

PR #273 and allocated receipt `4f21da13...` apply only to the superseded
`2026-08-24` runtime. They are historical evidence and are not used to certify
the current deployment.

## Current allocated runtime

| Field | Current value |
| --- | --- |
| Program | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` |
| ProgramData | `Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk` |
| Upgrade transaction | `3RBnKDDQuMv3VkUTSC4FHT8Qyk87xBJXUebkYCDenc1ApfTZP5PeFS32rRBsCLgQQLitBX9tYHhXprNw1C5KZd7y` |
| Upgrade slot / UTC | `442907465` / `2026-08-30T14:57:41Z` |
| Upgrade authority | `Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc` |
| ProgramData account | `357141` bytes |
| Allocated payload | `357096` bytes / SHA-256 `7672bd30bf01134bc56e088013a5cafd65ff850c402a56e532be3e28a3d5b4c9` |
| Last-nonzero diagnostic | `350289` bytes / SHA-256 `85e71adf087b268b199c933918a1b8bb2b0a5f67f9e71b1467b3ca8357b8458a` |

The `85e71adf...` digest is a last-nonzero diagnostic, not the source-artifact
identity: the reproducible SBF itself contains 15 trailing zero bytes.

## Source candidate and reproducible build packet

The verified source candidate is
[`brainAI-bot/satp@3f8188bec89db0d4a081931f35272e10185d1c0d`](https://github.com/brainAI-bot/satp/commit/3f8188bec89db0d4a081931f35272e10185d1c0d).
SATP PR #169 records the independently checked deployed-truth packet used by
this AgentFolio receipt.

| Input | Pinned value |
| --- | --- |
| `programs/escrow_v3/src/lib.rs` | SHA-256 `380b20d36f18253a5c382ec1abc4a1147a08092a9a42cdae25e5d954f41acd0a` |
| `Cargo.lock` | SHA-256 `d98db19e0d86ca3248376d4857b150b240be05c4bc3a409d7cb638ce4d5d2237` |
| `programs/escrow_v3/Cargo.toml` | SHA-256 `74f99640be90d76a6d1c78bc217e0178c62fa6c80a10455b4c650eef8c18d464` |
| `rust-toolchain.toml` | SHA-256 `615e131a336708d73f4b69a4a4a5a6f96b10f4399a1a075408e0616cda21544b` |
| `Anchor.toml` | SHA-256 `785c886cbd5a583171293a268319f76e462f6c05b13d354f245dd853cf34e45c` |
| Rust | `1.86.0` |
| Solana CLI | `2.1.21` |
| SBF platform-tools | `v1.52` |
| Build feature | `mainnet` |

Reproduction command:

```sh
cargo clean --manifest-path programs/escrow_v3/Cargo.toml
cargo build-sbf --tools-version v1.52 \
  --manifest-path programs/escrow_v3/Cargo.toml --features mainnet
shasum -a 256 target/deploy/escrow_v3.so
wc -c target/deploy/escrow_v3.so
```

The clean build produces `350304` bytes with SHA-256
`27395415b6dc3d069d8a0a974613e647af1494590cbaff0a2658945a2bc4784a`.
Those bytes equal the exact prefix of the allocated ProgramData payload. The
remaining `6792` bytes are all-zero loader padding with SHA-256
`04f30102940f974daa462466fc5aa08ecb36622da73eb8162834e768c984b61f`.

**Source/build verdict:** `MATCH_ALLOCATED_PREFIX_WITH_ZERO_PADDING`.
The source commit and locked build inputs reproduce the currently deployed
binary; trimming at the last nonzero byte is not used as the identity test.

## Source and published IDL binding

The source-generated canonical IDL at the pinned SATP commit is `20704` bytes,
contains 14 instructions, and has SHA-256
`9bb7e2a441af653108b21360a8aa14daa9bd8d54eebbc5eef88e7f3de881ba10`.
It includes writable `treasury` accounts on `release` and `partial_release`.

Two published surfaces were read independently:

| Published surface | Hash / instructions | Binding result |
| --- | --- | --- |
| Program Metadata `4zNAR5DGuWuUnEbwGb7FzEVUUCx2xKca2bmHCeVpjQCJ` | account SHA-256 `99f0e57bb32d6fa8661052ed2297923ac2cf7e5924e705922bba9827aad23fff`; canonical JSON SHA-256 `d4d00143fdb5e755c68b484a428fc02bdf5d0a0000c7a8d7ea2712bff2da92ce`; 14 instructions | **MISMATCH**: `treasury` is missing from both SOL release routes |
| Legacy Anchor IDL `D2TVCWarEDQ3w3YFMpackzymm9MGQKeWd1p1pCeZmBcn` | inflated SHA-256 `864e8af057c1b196156222ecda5853936bf4c6e0f3ae9f5c1e2ca2e53ed6c768`; 9 instructions | **MISMATCH**: five source instructions are absent |

**Published-IDL verdict:** `MISMATCH_STALE_NOT_CANONICAL`.

## Final binding verdict

- source commit == reproducible build == deployed binary: **CERTIFIED**;
- source-generated IDL == Program Metadata IDL: **NOT CERTIFIED**;
- source-generated IDL == legacy Anchor IDL: **NOT CERTIFIED**;
- source == deployed binary == published IDL: **NOT CERTIFIED**.

The machine receipt therefore carries
`status=source_build_verified_published_idl_mismatch`. Consumer and live-write
surfaces remain fail-closed until a separately authorized canonical IDL
publication is completed and independently verified.

## Verification

Runtime and published-surface readback:

```sh
node scripts/verify-escrow-v3-runtime-recert.mjs
```

Full source/build/IDL comparison after a clean build of the pinned SATP commit:

```sh
node scripts/verify-escrow-v3-runtime-recert.mjs \
  --artifact satp/target/deploy/escrow_v3.so \
  --source satp/programs/escrow_v3/src/lib.rs \
  --source-idl satp/idls/v3/escrow_v3.json \
  --source-commit 3f8188bec89db0d4a081931f35272e10185d1c0d
```

The ordinary comparison exits successfully when the runtime and source/build
packet verify and the known IDL mismatch is reproduced. `--strict-source`
returns exit code 3 while either published surface remains stale.
