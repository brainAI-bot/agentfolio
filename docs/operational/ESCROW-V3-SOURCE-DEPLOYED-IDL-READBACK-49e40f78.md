# Escrow V3 Source/Deployed/IDL Readback [#49e40f78]

Date: 2026-07-06
Agent: brainForge
Scope: read-only verification; no production deploy, no keypair change, no mainnet action, no paid action, no Solana write.

## 2026-08-05 HQ Correction

The certifiable target for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`
is mainnet, not devnet. The settled read-only chain readback is:

| Network | Result |
| --- | --- |
| mainnet `HXCUWKR2...` | executable program; ProgramData `Fg1DJyKX...`; ProgramData account hash `c946a0f40fb819290b3961922aaaba8e3c674d0a10eba5d765d5626fb43d5e20`; ELF hash `b70a7a7ea55f43da7bd3fc4f666e1374436bb9c8aeaa83cb2f0a2a970b603094`; ELF length `290680` |
| devnet `HXCUWKR2...` | program account exists, but ProgramData `Fg1DJyKX...` returns null; no devnet bytecode is deployed for the canonical id |

The canonical source for `HXCUWKR2...` is the AgentFolio source tree:

| Source tree | Path | SHA-256 | Program id | Canonical status |
| --- | --- | --- | --- | --- |
| AgentFolio | `onchain/escrow_v3/programs/escrow_v3/src/lib.rs` | `a713fb25815f724bde8bc0ed9eec0c104826fc0fb26bd3f608a6ed46096efd4c` | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` | canonical for Owner Option A / HXCU |
| clawd-brainchain | `satp-v3/programs/escrow_v3/src/lib.rs` | `4ff60eacc9fc0b5e2b527a4b1aa62992b6863883dc16a9cf305911682853dd23` | `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg` | not canonical for HXCU; do not call this the audited HXCU source |

Reason: the Owner's 2026-07-28 Option A selected `HXCUWKR2...`. Rebuilding
from the clawd-brainchain B1 source would reproduce the split-brain instead of
certifying the selected mainnet program.

Pinned canonical toolchain:

| File / command | Value |
| --- | --- |
| `onchain/escrow_v3/Anchor.toml` | `anchor_version = "0.31.1"` |
| `onchain/escrow_v3/programs/escrow_v3/Cargo.toml` | `anchor-lang = "0.31.1"` |
| `onchain/escrow_v3/rust-toolchain.toml` | `channel = "1.86.0"` |
| `cargo --version` | `cargo 1.86.0 (adf9b6ad1 2025-02-28)` |
| `anchor --version` | `anchor-cli 0.31.1` |

Source build comparison:

| Command | Result |
| --- | --- |
| `cargo build-sbf --manifest-path programs/escrow_v3/Cargo.toml --sbf-out-dir target/deploy` from `onchain/escrow_v3` | built `target/deploy/escrow_v3.so`, `sha256 21dda9b5b0f95aba7f2560d58f2085de7ef8d0c9f1e3ac79f8ee506dcb9c6cf4`, size `289216` bytes |
| comparison target | mainnet ELF `sha256 b70a7a7ea55f43da7bd3fc4f666e1374436bb9c8aeaa83cb2f0a2a970b603094`, length `290680` bytes |

Reproducible read-only evidence captured on 2026-08-05:

| Check | Command | Evidence |
| --- | --- | --- |
| Source/IDL verifier | `node scripts/verify-escrow-v3-source-idl.mjs --strict` | `status: verified`; `anchorProgramIdMatches`, `declareIdMatches`, `idlAddressMatches`, and `idlNameMatches` are all `true`; runtime identity checks are all `true`. |
| Tracked IDL comparison | same verifier output | Anchor program id, source `declare_id!`, and tracked IDL `address` all equal `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`; tracked IDL hash is `19ab1ae26b274499d1d014b69b318a49467189085c35cd51ef52b10dbece1262`. |
| Mainnet program readback | read-only `@solana/web3.js` `getAccountInfo` for `HXCUWKR2...`, then extracted the ProgramData address from the upgradeable-loader program account | Program exists, executable `true`, owner `BPFLoaderUpgradeab1e11111111111111111111111`, lamports `1141440`, program account data length `36`, program account hash `ab59bd58932f39aa15943888b0d1d05e7b438dbe9564ea7af0ca2a2578e22937`, ProgramData `Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk`. |
| Mainnet ProgramData/ELF extraction | same script; fetched ProgramData and located ELF magic bytes `0x7f454c46` at offset `45` | ProgramData exists, owner `BPFLoaderUpgradeab1e11111111111111111111111`, executable `false`, lamports `2024336880`, data length `290725`, ProgramData account hash `c946a0f40fb819290b3961922aaaba8e3c674d0a10eba5d765d5626fb43d5e20`, extracted ELF length `290680`, ELF hash `b70a7a7ea55f43da7bd3fc4f666e1374436bb9c8aeaa83cb2f0a2a970b603094`. |
| Devnet negative readback | read-only `@solana/web3.js` `getAccountInfo` for the same program id and derived ProgramData address | Program account exists with the same loader owner, executable `true`, lamports `1141440`, data length `36`, and ProgramData `Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk`, but the ProgramData account returns `null`; no devnet ELF bytes are available for this id. |
| Local SBF build | `cd onchain/escrow_v3 && cargo --version && anchor --version && cargo build-sbf --manifest-path programs/escrow_v3/Cargo.toml --sbf-out-dir target/deploy && shasum -a 256 target/deploy/escrow_v3.so && wc -c target/deploy/escrow_v3.so` | `cargo 1.86.0 (adf9b6ad1 2025-02-28)`, `anchor-cli 0.31.1`; build finished with two deprecation warnings and produced `sha256 21dda9b5b0f95aba7f2560d58f2085de7ef8d0c9f1e3ac79f8ee506dcb9c6cf4`, size `289216` bytes. |

Conclusion: `source == deployed` is not certified. The milestone remains
`[blocked]` because the canonical AgentFolio source builds to
`21dda9b5...`, not the deployed mainnet ELF `b70a7a7e...`. The exact next step
is to locate the deployed source/toolchain provenance that reproduces
`b70a7a7e...`, or update the canonical source through a separate authorized
program-deploy process. Do not mark this line `[shipped]` until the bytes match.

`anchor build --program-name escrow_v3` was intentionally not used as the
certification command: without a canonical `target/deploy/escrow_v3-keypair.json`
for `HXCUWKR2...`, Anchor rewrites the source and `Anchor.toml` to the local
generated keypair `CpzKavMT86fN6ei72sbAvavSuEyzwZhRuJ17c2LTUXx9`, which is not
the deployed program id.

## Current Network Scope

As of the 2026-07-29 PR #207 repair, the installed AgentFolio SATP client
keeps `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg` as the current locked
devnet SDK identity. The 2026-07-28 owner decision selects
`HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` as canonical mainnet. Do not
describe the devnet B1 identity as historical or superseded unless the
dependency or deployment evidence changes.

## Selected 2026-07-06 Target

The original 2026-07-06 readback selected:

```text
HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C
```

Readbacks:

| Source | Path / command | Result |
| --- | --- | --- |
| AgentFolio Anchor config | `onchain/escrow_v3/Anchor.toml` | `[programs.devnet].escrow_v3 = "HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C"` |
| AgentFolio source | `onchain/escrow_v3/programs/escrow_v3/src/lib.rs` | `declare_id!("HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C")` |
| AgentFolio tracked IDL | `onchain/escrow_v3/target/idl/escrow_v3.json` | `address = "HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C"` |
| SATP client runtime constants | `node -e "require('@brainai/satp-client').PROGRAM_IDS.ESCROW.toBase58()"` | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` |
| Read-only devnet RPC | `Connection('https://api.devnet.solana.com').getAccountInfo(HXCU...)` | `exists: true`, `executable: true`, owner `BPFLoaderUpgradeab1e11111111111111111111111`, lamports `1141440`, data length `36` |

## Artifact Hashes

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| AgentFolio Anchor config | `onchain/escrow_v3/Anchor.toml` | `a296f41760a1a703e84f6e9a7a90eabec5fd03146d354ea45dfe4c0ad0783f5a` |
| AgentFolio program source | `onchain/escrow_v3/programs/escrow_v3/src/lib.rs` | `a713fb25815f724bde8bc0ed9eec0c104826fc0fb26bd3f608a6ed46096efd4c` |
| AgentFolio tracked IDL | `onchain/escrow_v3/target/idl/escrow_v3.json` | `19ab1ae26b274499d1d014b69b318a49467189085c35cd51ef52b10dbece1262` |
| Extracted SATP package legacy escrow IDL | `node_modules/@brainai/satp-client/idls/satp_escrow.json` | `b803727bf12351dc88aa169d030f2595df23f224df9224c736ef1f5b80701260`; address `UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22` |

## clawd-brainchain Audited Source Readback

Local source workspace:

```text
/Users/brainforge/clawd/tmp-clawd-brainchain-49e40f78
commit 94a1d309dcc692228c357f6e28ab679196235ad2
```

The working tree had an unrelated dirty `satp-v3/yarn.lock`; the audited
source paths below were read directly. The `B1Se8SP...` values in this section
remain the current locked devnet SDK identity for the installed SATP client and
must not be described as superseded until dependency or deployment evidence
changes. The 2026-07-28 owner decision selected
`HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` as canonical mainnet.

| Artifact | Path | SHA-256 / value |
| --- | --- | --- |
| clawd-brainchain Anchor config | `satp-v3/Anchor.toml` | `7af3f288b27ec7a2f931cb89ed2e645d0d809a12c7ca333d461388c4f34ac426` |
| clawd-brainchain escrow source | `satp-v3/programs/escrow_v3/src/lib.rs` | `4ff60eacc9fc0b5e2b527a4b1aa62992b6863883dc16a9cf305911682853dd23` |
| clawd-brainchain current locked devnet program id | `satp-v3/Anchor.toml` | `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg` |
| clawd-brainchain current locked devnet source `declare_id!` | `satp-v3/programs/escrow_v3/src/lib.rs` | `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg` |
| clawd-brainchain mainnet program id | `satp-v3/Anchor.toml` | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` |

Comparison result:

- In the original 2026-07-06 repo-local readback, AgentFolio source, AgentFolio tracked IDL, SATP runtime constant, and read-only devnet account readback agreed on `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`; the current locked SATP client still scopes B1 as devnet and HXCUWKR2 as mainnet.
- The audited `clawd-brainchain` source at commit `94a1d309dcc692228c357f6e28ab679196235ad2` did not match the AgentFolio pinned source hash and declared the current locked devnet SDK identity `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg`.
- `diff -q onchain/escrow_v3/programs/escrow_v3/src/lib.rs /Users/brainforge/clawd/tmp-clawd-brainchain-49e40f78/satp-v3/programs/escrow_v3/src/lib.rs` reports that the files differ.
- `diff -q onchain/escrow_v3/Anchor.toml /Users/brainforge/clawd/tmp-clawd-brainchain-49e40f78/satp-v3/Anchor.toml` reports that the files differ.

Conclusion: repo-local AgentFolio source/IDL/program-id consistency is verified, but the stricter audited-source-to-deployed alignment is not certified from the available `clawd-brainchain` source. Live escrow writes must remain gated until the authoritative audited source/IDL for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` is supplied and verified, or an authorized devnet replacement deploy is performed outside this read-only task.

## 2026-08-02 Roadmap Re-Flip Fence [#011685d4]

Scope: read-only source comparison for the roadmap money-path claim; no
production deploy, no keypair use, no Solana write, no authority change, no
mainnet/devnet deploy.

The roadmap item for on-chain fee collection must remain pending. A shipped
flip requires GitHub/HQ-visible executed transfer evidence for both
`release` and `partial_release`, plus certified source/deployed/IDL alignment.
Lint, gitleaks, docs-only text, or an HXCU program-id declaration by itself is
not sufficient proof of executed treasury movement.

Current cross-host source readback:

| Source tree | Commit | Source hash / result |
| --- | --- | --- |
| AgentFolio `onchain/escrow_v3` | current PR branch source | `Anchor.toml`, `declare_id!`, and tracked IDL all name `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`; source hash `a713fb25815f724bde8bc0ed9eec0c104826fc0fb26bd3f608a6ed46096efd4c`; IDL hash `19ab1ae26b274499d1d014b69b318a49467189085c35cd51ef52b10dbece1262`. |
| local SATP canonical workspace `/Users/brainchain/clawd/satp-canonical-escrow-hxcuwkr2-20260728` | `353f7e6e7f00e131aebbbe1708d51ad4d990e3ef` | `Anchor.toml` and `declare_id!` also name `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`, but source hash is `cf2f4fe575332ff0004fac866f8fb33ac165297015c311fbe0371d675d4e601e`, which differs from AgentFolio. |

Deployed-source truth: neither the AgentFolio `onchain/escrow_v3` tree nor the
local SATP canonical `programs/escrow_v3` tree is certified here as the source
that produced the deployed HXCU binary. Both can name the HXCU program ID while
still disagreeing on source content. The re-flip lane must therefore require
either an owner-approved replacement deploy from the audited source, or an
auditable source/deployed/IDL packet that binds one source tree to the deployed
program binary and includes executed treasury-delta proof for both money paths.

## Commands Run

| Command | Result |
| --- | --- |
| `node scripts/verify-escrow-v3-source-idl.mjs --strict` | Pass; `status: verified`; Anchor config, source `declare_id!`, IDL address, and SATP identity enforcement checks all pass for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`. |
| `node --test tests/escrow-v3-authority.test.js tests/escrow-v3-dispute-recipient-binding.test.js tests/escrow-v3-pda-query.test.js tests/escrow-v3-selected-agent.test.js tests/satp-client-dependency-boundary.test.js` | Pass; 24 tests passed. |
| Read-only mainnet/devnet RPC account and ProgramData readback for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` | Pass; mainnet ProgramData exists and ELF hash is `b70a7a7ea55f43da7bd3fc4f666e1374436bb9c8aeaa83cb2f0a2a970b603094`; devnet ProgramData returns `null`. |
| `cd onchain/escrow_v3 && cargo --version && anchor --version && cargo build-sbf --manifest-path programs/escrow_v3/Cargo.toml --sbf-out-dir target/deploy && shasum -a 256 target/deploy/escrow_v3.so && wc -c target/deploy/escrow_v3.so` | Pass with warnings; `cargo 1.86.0`, `anchor-cli 0.31.1`; built `target/deploy/escrow_v3.so`, `sha256 21dda9b5b0f95aba7f2560d58f2085de7ef8d0c9f1e3ac79f8ee506dcb9c6cf4`, size `289216` bytes. |

## Safety Readback

No production deploy, no keypair change, no mainnet action, no paid action, no Solana write, no live escrow enablement, and no ROADMAP.md edit were performed.

## 2026-08-05 No-Write Alignment Path [#3258f2a8]

HQ parent: `AGENTFOLIO-3258F2A8-ESCROW-SPLITBRAIN-NOWRITE-PREP-20260805-0451Z`.
This note does not include an authoritative owner-request readback and does not
treat any request id as signing authority for deploy, upgrade, IDL publish,
keypair, or other Solana-write work.

This follow-up preserves the current split-brain as a fail-closed planning state,
not as a deploy decision:

- `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`: AgentFolio local Anchor config, `declare_id!`, tracked IDL address, and app/runtime references.
- `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg`: SATP current locked devnet escrow V3 source/config/runtime identity.
- `UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22`: SATP legacy V2 escrow identity and packaged legacy IDL lineage.

Authority request reconciliation is intentionally deferred until an
authoritative request-status and approval-scope readback is attached. Until then,
remaining work is per-network alignment evidence: preserve B1 as the current
locked devnet identity, preserve HXCUWKR2 as the candidate canonical mainnet id,
and produce reproducible-build proof before any `source == deployed == IDL`
claim advances.

Reviewer/author separation is not self-certified by this note. This PR must
receive an independent HQ/GitHub review from the assigned reviewer before any
approval or merge routing.

Exact files that must be aligned after owner authority selection:

| Repo | File | Required alignment |
| --- | --- | --- |
| AgentFolio | `onchain/escrow_v3/Anchor.toml` | Anchor `[programs.devnet].escrow_v3` names the selected escrow V3 program id. |
| AgentFolio | `onchain/escrow_v3/programs/escrow_v3/src/lib.rs` | `declare_id!` names the same selected program id and source hash is recorded. |
| AgentFolio | `onchain/escrow_v3/target/idl/escrow_v3.json` | Tracked IDL `address` names the same selected program id and IDL hash is recorded. |
| AgentFolio | `scripts/verify-escrow-v3-source-idl.mjs` | Strict verifier expects the same selected program id and fails closed on drift. |
| AgentFolio | `src/lib/escrow-v3-authority.js` | Runtime authority readback expects the same selected program id. |
| AgentFolio | `frontend/src/lib/satp-mainnet-programs.ts` | Frontend registry names the same selected program id for the matching network scope. |
| AgentFolio | `src/lib/escrow-onchain.js` | Escrow runtime constant names the same selected program id before writes are enabled. |
| AgentFolio | `ROADMAP.md` and `docs/planning/ROADMAP.md` | Roadmap remains blocked until source == deployed program == IDL is certified. |
| SATP | `Anchor.toml` | `[programs.devnet].escrow_v3` and any matching network section name the selected escrow V3 program id. |
| SATP | `programs/escrow_v3/src/lib.rs` | Active `declare_id!` for the selected build target names the selected program id. |
| SATP | `idls/v3/escrow_v3.json` | IDL metadata gains or preserves the selected program id address, if this repo is the IDL source of truth. |
| SATP | `packages/satp-client/src/v3-pda.js` | V3 runtime constants name the selected program id for the matching network scope. |
| SATP | `packages/satp-client/src/constants.js` | Legacy V2 escrow identity remains explicitly fenced or documented; it must not be mistaken for V3. |
| SATP | `packages/satp-client/test-v3.js` and `packages/satp-client/test-release-safety.js` | Tests assert the selected program id and keep legacy V2/mainnet fences explicit. |
| SATP | `docs/escrow-v3-build-proof-reference.json` and `docs/escrow-v3-build-proof.md` | Build-proof docs record the selected source/deployed/IDL hashes and any remaining mismatch. |
| SATP | `docs/v3-program-source-verification.md` | Verification instructions and network matrix name one selected escrow V3 program id per network scope. |

Safe PR scope for this no-write cycle: documentation only. Do not update SATP
devnet constants from `B1Se...` to `HXCU...`, do not change AgentFolio runtime
write behavior, do not publish an IDL, and do not perform Solana writes or
keypair actions. The remaining unblock must be a separate owner-authorized
per-network repair/proof path: either preserve B1 for devnet with reproducible
source/deployed/IDL evidence, authorize and prove any devnet repair/redeploy
through a separately recorded approval scope, or provide the missing
authoritative source/toolchain provenance that reproduces the deployed HXCUWKR2
mainnet ELF.

## 2026-08-08 Mainnet Source Certification [#ef7e4581]

Read-only observation time: `2026-08-08T11:09:05Z`. The certification source
is `github.com/brainAI-bot/agentfolio` commit
`f25b9c23d886d6adb0ebb57defd52689b5dc9990`, path
`onchain/escrow_v3/programs/escrow_v3/src/lib.rs` (sha256
`a713fb25815f724bde8bc0ed9eec0c104826fc0fb26bd3f608a6ed46096efd4c`).

The host toolchain is Cargo `1.86.0`, rustc `1.86.0`, Anchor CLI `0.31.1`,
and Solana CLI / `solana-cargo-build-sbf` `2.1.21`. From
`onchain/escrow_v3`, these clean SBF builds were reproduced:

```text
cargo build-sbf --manifest-path programs/escrow_v3/Cargo.toml --sbf-out-dir target/deploy
cargo build-sbf --force-tools-install --tools-version v1.52 --manifest-path programs/escrow_v3/Cargo.toml --sbf-out-dir target/deploy
```

The default platform-tools `v1.43` / SBF rustc `1.79.0` build produced sha256
`21dda9b5b0f95aba7f2560d58f2085de7ef8d0c9f1e3ac79f8ee506dcb9c6cf4`,
length `289216`, and ELF machine `EM_BPF (0xF7)`. The pinned
platform-tools `v1.52` / SBF rustc `1.89.0` build produced sha256
`60f7fee84d640a0ff339011962bab3d866c5c27d6a1dad574798999838183d67`,
length `292336`, and ELF machine `EM_SBF (0x107)`. Neither build reproduced
the deployed artifact.

Read-only `solana program show`, `solana program dump`, and `anchor idl fetch`
against mainnet-beta returned program
`HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`, ProgramData
`Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk`, deployed ELF sha256
`b70a7a7ea55f43da7bd3fc4f666e1374436bb9c8aeaa83cb2f0a2a970b603094`,
deployed ELF length `290680`, and ELF machine `EM_SBF (0x107)`. The fetched
on-chain IDL sha256 is
`79b7fd4389dcd55738955de5dc61771bc4d5af997f21065318728a49aa53dd74`.

The tracked IDL source is
`onchain/escrow_v3/target/idl/escrow_v3.json`, sha256
`19ab1ae26b274499d1d014b69b318a49467189085c35cd51ef52b10dbece1262`.
The strict repository verifier passes its configured checks, but a complete
isolated `anchor idl build` schema comparison fails for source versus the
tracked IDL. All 9 instruction shapes, the 19 `EscrowV3` fields and account
discriminator, all 8 event names/discriminators, and all 20 error variants
match. The first missing semantic definition is the `DeadlineExtended` event
payload type, followed by the other 7 source event payload types; tracked
`types` contains only `EscrowStatus` and `EscrowV3`.

The deployed on-chain IDL also does not pass the semantic comparison:

- The first instruction divergence is instruction index 4,
  `partial_release`: the tracked IDL requires accounts
  `[escrow, client, agent, treasury]`, while the on-chain IDL requires only
  `[escrow, client, agent]`.
- `release` has the same interface split: the tracked IDL adds `treasury`,
  while the on-chain IDL does not.
- The tracked IDL has 20 error variants while the on-chain IDL has 25. The
  first semantic error divergence is code `6002`: tracked `NotActive` versus
  on-chain `AgentIdTooLong`.
- The 19 `EscrowV3` state fields remain semantically equal after ignoring
  documentation-only text.

| Gate | Result | Evidence |
| --- | --- | --- |
| source -> candidate ELF | PASS | v1.43 produces `21dda9b5...`; v1.52 produces `60f7fee8...` |
| source <-> tracked IDL | **FAIL** | configured strict checks pass, but all 8 event payload type definitions are absent from tracked `types` |
| IDL address == deployed program id | PASS | both name `HXCUWKR2...` |
| candidate ELF == deployed ELF | **FAIL** | neither candidate hash/length equals `b70a7a7e...` / 290680 |
| tracked IDL == on-chain IDL | **FAIL** | first interface divergence is `partial_release.treasury` |
| source == deployed == IDL | **FAIL** | source/tracked-IDL, binary, and deployed-IDL semantic gates diverge |

At source/IDL schema level, the first exact divergence is the missing
`DeadlineExtended` payload type in tracked `types`. At byte level, the v1.43
candidate first diverges from the deployed ELF at
1-based byte 19 (ELF `e_machine`: `0xF7` versus `0x107`). Pinned v1.52 fixes
that format difference, but first diverges at 1-based byte 25 (ELF entry point)
and remains different in size and hash. At interface level, the first exact
tracked/on-chain divergence is the `partial_release` account list described
above. The current
AgentFolio source and tracked IDL therefore represent a post-deployment
interface (including platform-fee treasury routing), not reproducible provenance
for the binary and IDL currently deployed at `HXCUWKR2...`.

This is not correctable by changing program-id metadata or trying more compiler
versions. The PR-first corrective path is to supply the authoritative deployed
source commit and locked build provenance that reproduces `b70a7a7e...`, then
regenerate a complete IDL (including event payload types) that semantically
matches the fetched on-chain IDL. An
owner-authorized replacement deployment from the audited current source is the
separate alternative and remains outside this read-only certification.

No Solana write, deploy/restart, existing or canonical keypair read/change,
money movement, npm publish, public launch, or `ROADMAP.md` edit was performed.
The standard build-generated local output keypair was never read, printed,
copied, used for signing, or used for any chain action.
