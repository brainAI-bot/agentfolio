# Escrow V3 provenance mismatch remediation [#ef7e4581]

Read-only observation: `2026-08-24T09:56:55.096Z`.

This packet continues from the pinned PR #270 receipt at merge commit
`b4f3b0c020ee06743245db6e756270f3777d85e4` and receipt timestamp
`2026-08-24T07:47:44.921Z`. It narrows the mismatch without changing
`ROADMAP.md` and without a deploy, Solana write, IDL publication, authority
change, keypair action, credential action, production restart, or feature
flag change.

## Pinned source, inputs, and toolchain

| Input | Commit, version, or SHA-256 |
| --- | --- |
| SATP source commit | `0bf088e5618f173dff7e0fba622bc2911212c52e` |
| `programs/escrow_v3/src/lib.rs` | `f4696cc27c5e2ff6163a90f877fd4431efa8809d2f6ae4c792c3c7cd18193c4d` |
| `Cargo.lock` | `d98db19e0d86ca3248376d4857b150b240be05c4bc3a409d7cb638ce4d5d2237` |
| `rust-toolchain.toml` | `615e131a336708d73f4b69a4a4a5a6f96b10f4399a1a075408e0616cda21544b` |
| `Anchor.toml` | `785c886cbd5a583171293a268319f76e462f6c05b13d354f245dd853cf34e45c` |
| Rust / Solana CLI / SBF platform-tools | `1.86.0` / `2.1.21` / `v1.52` |
| Build profile | `cargo build-sbf --force-tools-install --tools-version v1.52 --manifest-path programs/escrow_v3/Cargo.toml --features mainnet` |

The clean mainnet rebuild remains 346,856 bytes with SHA-256
`4f21da13659cbe99a606b408a5f1d3523c0e41de20538028939bbb1b54c3cc0d`.
The immediately preceding source state, SATP commit
`181622990281c29d74c81724b90e3f46a7875837`, has source SHA-256
`7183fb37394624c0dc039eeb6a766238536119c757988abab712663a4d1f7583`
and produces SHA-256
`958ae3b2933fab1a0af87fbe5094b6e64b91932a95742b9362b9f4f6b5d6274c`
under the same mainnet toolchain. Neither candidate matches the live bytes.

## Binary forensics

| Binding | Result |
| --- | --- |
| Rebuild vs allocated ProgramData payload | `4f21da13... != 53e922d8...` |
| Rebuild vs trimmed deployed ELF | `4f21da13... != 88058f43...` |
| Candidate/live allocated length | `346856 == 346856` |
| Differing byte positions | `2633` |
| ELF section layout | equal |
| Live allocated payload | 346,856 bytes; `53e922d8792d3ec2d447c497f37dfe8e4ffd1d9bde0f9d6edc0bb3578e67c17f` |
| Live trimmed ELF | 346,841 bytes; `88058f4322bb8cbb9227b6f35ae3c78baf2be9c01a3bd70523f803f9bfa7f078` |

Both ELFs have the same `.text`, `.rodata`, `.data.rel.ro`, `.dynamic`,
`.dynsym`, `.dynstr`, `.rel.dyn`, and `.shstrtab` offsets and sizes. This is
useful narrowing evidence, but equal layout is not byte equality and is not a
source certification.

The August 19 SATP Actions run `32251029537` retained no artifact. Its only
escrow build used `--features devnet`; it is not an authoritative receipt for
the later mainnet upgrade transaction. No repository or Actions artifact
found in the safe readback supplies the exact mainnet deployment source/build
packet.

## Published IDL mismatch

| Surface | SHA-256 | Instructions |
| --- | --- | --- |
| Source IDL at `0bf088e` | `3d7e7a14788449f65c1a187a96543f7677bf08937e61638734ed3886dcf60a5a` | 14 |
| Published inflated IDL | `864e8af057c1b196156222ecda5853936bf4c6e0f3ae9f5c1e2ca2e53ed6c768` | 9 |

The published IDL omits `create_usdc_escrow`, `release_usdc`,
`partial_release_usdc`, `cancel_usdc`, and `resolve_dispute_usdc`. The live
ELF contains the compiled Anchor instruction labels for all five omitted
instructions. This demonstrates that the published IDL understates the live
runtime instruction surface. It does not prove the rest of the candidate
source is byte-identical to the deployed program.

The verifier now emits:

- exact byte-difference count and both ELF section layouts;
- compiled-label presence for the five source instructions missing from the
  published IDL;
- the existing independent source-build and source-IDL equality verdicts.

The new metrics are forensic evidence only. They cannot turn a mismatch into
a passing `sourceBuildVerified` or `sourceDeployedIdlEqual` result.

## Commands and results

```sh
node --test tests/escrow-v3-runtime-recert.test.js
# 5 tests passed

node scripts/verify-escrow-v3-runtime-recert.mjs \
  --artifact satp/target/deploy/escrow_v3.so \
  --source satp/programs/escrow_v3/src/lib.rs \
  --source-idl satp/idls/v3/escrow_v3.json \
  --source-commit 0bf088e5618f173dff7e0fba622bc2911212c52e
# runtimeVerified=true
# sourcePacketVerified=true
# sourceBuildVerified=false
# sourceDeployedIdlEqual=false
# byteDifferenceCount=2633
# elfSectionLayoutMatches=true
# publishedIdlGapInstructionLabelsPresentInDeployed=true

git diff --check
# clean
```

## Verdict and exact residual gate

Every safe, read-only slice is complete. Full provenance is not certified.
The exact residual gate is **Owner authorization for one coordinated mainnet
remediation window**, after brainForge review, that binds the reviewed source
and locked toolchain to the replacement artifact and publishes the matching
14-instruction IDL. The authorization must name the reviewed source commit,
artifact SHA-256, IDL SHA-256, upgrade authority, rollback plan, and execution
owner before any signer is loaded or any transaction is constructed.

If the original August 19 deployment packet is recovered first and reproduces
`53e922d8...` / `88058f43...`, the program-upgrade portion of that window is
unnecessary; only the separately approved IDL resolution remains. Until one
of those conditions is met, live escrow writes remain gated and this packet
does not authorize a deploy or publication.
