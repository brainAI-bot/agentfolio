# Escrow V3 current-runtime provenance re-certification [#ef7e4581]

Captured: 2026-08-31 UTC. This receipt supersedes the source/build/IDL binding
recorded for the 2026-08-24 runtime by AgentFolio PR #273. It performs no
Solana write, deploy, IDL publication, signer access, authority change, or
production mutation.

## Evidence boundary

The current read-only mainnet identity is:

| Item | Current value |
| --- | --- |
| Program | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` |
| ProgramData | `Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk` |
| Upgrade slot | `442907465` |
| ProgramData account | `357141` bytes |
| Loader header | `45` bytes |
| Allocated payload | `357096` bytes; SHA-256 `7672bd30bf01134bc56e088013a5cafd65ff850c402a56e532be3e28a3d5b4c9` |
| Last-non-zero trim | `350289` bytes; SHA-256 `85e71adf087b268b199c933918a1b8bb2b0a5f67f9e71b1467b3ca8357b8458a` |

The `85e71adf...` value is a last-non-zero diagnostic, not the complete source
artifact hash. The reproducible source artifact contains 15 intrinsic trailing
zero bytes, so its exact size and hash are `350304` bytes and
`27395415b6dc3d069d8a0a974613e647af1494590cbaff0a2658945a2bc4784a`.
The remaining `6792` allocated bytes are loader padding; they are all zero and
have SHA-256
`04f30102940f974daa462466fc5aa08ecb36622da73eb8162834e768c984b61f`.
Thus `350304 + 6792 = 357096`, preserving the source artifact's intrinsic
trailing zeros rather than misclassifying them as loader padding.

## Exact source and reproducible build packet

The current source candidate is `brainAI-bot/satp` commit
`3f8188bec89db0d4a081931f35272e10185d1c0d`:

| Input | Pinned value |
| --- | --- |
| Rust source | `programs/escrow_v3/src/lib.rs` |
| Rust source SHA-256 | `380b20d36f18253a5c382ec1abc4a1147a08092a9a42cdae25e5d954f41acd0a` |
| `Cargo.lock` SHA-256 | `d98db19e0d86ca3248376d4857b150b240be05c4bc3a409d7cb638ce4d5d2237` |
| SBF tools version | `v1.52` |
| Cargo feature | `mainnet` |
| Artifact | `target/deploy/escrow_v3.so` |
| Artifact bytes / SHA-256 | `350304` / `27395415b6dc3d069d8a0a974613e647af1494590cbaff0a2658945a2bc4784a` |

Reproduction command:

```sh
cargo build-sbf --tools-version v1.52 \
  --manifest-path programs/escrow_v3/Cargo.toml \
  --features mainnet
```

The packet verifier is
`scripts/build-verify-escrow-v3-deployed-source.sh`. It archives the exact
source commit into a clean temporary tree, runs the pinned build command,
checks artifact size and SHA-256, and then runs
`scripts/verify-escrow-v3-deployed-truth.mjs --live` against finalized RPC.

## IDL binding

The source-generated canonical repository IDL is
`satp/idls/v3/escrow_v3.json` at the same source commit. It is `20704` bytes,
has 14 instructions, and has SHA-256
`9bb7e2a441af653108b21360a8aa14daa9bd8d54eebbc5eef88e7f3de881ba10`.

Neither published mainnet IDL surface matches that canonical source IDL:

| Published surface | Readback | Binding verdict |
| --- | --- | --- |
| Program Metadata account `4zNAR5DGuWuUnEbwGb7FzEVUUCx2xKca2bmHCeVpjQCJ` | account-data SHA-256 `99f0e57bb32d6fa8661052ed2297923ac2cf7e5924e705922bba9827aad23fff`; canonical-JSON SHA-256 `d4d00143fdb5e755c68b484a428fc02bdf5d0a0000c7a8d7ea2712bff2da92ce`; 14 instructions | `STALE_NOT_CANONICAL`: `release` and `partial_release` omit writable `treasury` |
| Legacy Anchor IDL account `D2TVCWarEDQ3w3YFMpackzymm9MGQKeWd1p1pCeZmBcn` | inflated-JSON SHA-256 `864e8af057c1b196156222ecda5853936bf4c6e0f3ae9f5c1e2ca2e53ed6c768`; 9 instructions | `STALE_NOT_CANONICAL`: missing all five USDC entrypoints and current fee-routing accounts |

## Binding verdict

- **Source to build:** `PASS`. The pinned source and build inputs reproduce the
  exact `350304`-byte artifact with SHA-256 `27395415...`.
- **Build to allocated runtime:** `PASS`. The artifact is the exact prefix of
  the allocated `7672bd30...` payload and the remaining `6792` bytes are proven
  zero loader padding. The last-non-zero diagnostic remains `85e71adf...`.
- **Source to canonical repository IDL:** `PASS`. The 14-instruction
  `9bb7e2a4...` IDL is generated and hash-pinned to source commit `3f8188be...`.
- **Published IDL to source/runtime:** `FAIL CLOSED`. Both published surfaces
  are stale and do not match the canonical IDL. Consumer escrow unpause is not
  ready until canonical publication is reconciled and independently verified.

The overall verdict is
`SOURCE_BINARY_VERIFIED_PUBLISHED_IDLS_STALE`. This certifies the current
source/build binding without overstating the callable consumer interface.

## Upstream exact-head verification

The authoritative build packet is open as
[`brainAI-bot/satp#169`](https://github.com/brainAI-bot/satp/pull/169) at exact
head `06327cefd7aafb5adba720e1fb9c6a6299f4799e`. At that head, GitHub reports:

- `Escrow V3 build proof` — success;
- `Rebuild and compare deployed escrow source` — success;
- `Fee-routing candidate reproducibility` — success;
- `Locked mainnet build` — success;
- `Validate generated V3 IDLs` — success;
- `SATP Release Gate` — success;
- CodeQL JavaScript/TypeScript, Python, Rust, and Actions analyses — success.

Focused packet commands:

```sh
scripts/build-verify-escrow-v3-deployed-source.sh
npm run ci:offline
python3 scripts/validate-idls.py
git diff --check
```

The SATP PR is the implementation/evidence source; this AgentFolio receipt is
the consumer-facing provenance record required by `[#ef7e4581]`. The changed
file set for this receipt intentionally excludes `ROADMAP.md`.
