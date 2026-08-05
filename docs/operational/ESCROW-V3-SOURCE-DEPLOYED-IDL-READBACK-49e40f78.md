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
Owner/signing gate: `REQ-6480e7c6`.

This follow-up preserves the current split-brain as a fail-closed planning state,
not as a deploy decision:

- `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`: AgentFolio local Anchor config, `declare_id!`, tracked IDL address, and app/runtime references.
- `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg`: SATP current locked devnet escrow V3 source/config/runtime identity.
- `UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22`: SATP legacy V2 escrow identity and packaged legacy IDL lineage.

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
write behavior, and do not publish an IDL until Hani approves `REQ-6480e7c6` or
supplies the authoritative audited source tree and IDL for the selected program
id. The one remaining Hani action is to approve `REQ-6480e7c6` for
`ESCROW_DEVNET_DEPLOY_AUTHORITY` to sign the selected devnet deploy/upgrade plus
Anchor IDL publish command class, or to provide the missing authoritative
audited source/IDL for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`.
