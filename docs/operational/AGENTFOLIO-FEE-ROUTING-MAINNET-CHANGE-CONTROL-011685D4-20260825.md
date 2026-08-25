# AgentFolio fee-routing mainnet change-control packet [#011685d4]

Status: **NO-GO for execution; audited preparation only.** This packet does not
authorize or perform a program upgrade, IDL write, transaction, keypair action,
fee-payer funding, production mutation, live-write enablement, or roadmap flip.
It prepares the exact gates for a later Owner-approved mainnet window.

Prepared by: brainChain

Date: 2026-08-25

AgentFolio review base: `dce3a4994968ec942480fdc2a354120534865db5`

Live proof dependency: AgentFolio PR
[#277](https://github.com/brainAI-bot/agentfolio/pull/277), commit
`dce3a4994968ec942480fdc2a354120534865db5`

## Executive decision

Do **not** deploy the fee-routing program currently tracked at
`onchain/escrow_v3`. Although its SOL `release` and `partial_release` paths bind
the fixed treasury and calculate a 5% fee, it is not a delta from the certified
live source:

| Surface | Certified live packet | AgentFolio tracked candidate | Verdict |
| --- | --- | --- | --- |
| Source lineage | SATP `93fc6c0d86302cfe8b0d8c798ba2817d7eeace44` | AgentFolio `814b8ed797d82cecbdad07766f5d946181105850` | Different implementations |
| Instruction count | 14 | 9 | **NO-GO** |
| SOL release accounts | `[escrow, client, agent]` | `[escrow, client, agent, treasury]` | Intended change, not yet deployed |
| SOL partial-release accounts | `[escrow, client, agent]` | `[escrow, client, agent, treasury]` | Intended change, not yet deployed |
| USDC surfaces | Five instructions present | All five absent | **Breaking deletion** |
| Source SHA-256 | `f4696cc27c5e2ff6163a90f877fd4431efa8809d2f6ae4c792c3c7cd18193c4d` | `a713fb25815f724bde8bc0ed9eec0c104826fc0fb26bd3f608a6ed46096efd4c` | Not interchangeable |
| IDL SHA-256 | `e8c142f27e225d8edc2f8f41e6fb698ebbb73f69d2fc078d5bf963234ebc8fa9` | `19ab1ae26b274499d1d014b69b318a49467189085c35cd51ef52b10dbece1262` | Not interchangeable |

The five missing instructions are `create_usdc_escrow`, `release_usdc`,
`partial_release_usdc`, `cancel_usdc`, and `resolve_dispute_usdc`. The two
sources also differ in identity parsing, arbiter restrictions, account layout,
event layout, deadline enforcement, and error definitions. A mainnet upgrade
from the AgentFolio tree would therefore be a broad program replacement, not a
fee-routing patch.

SATP PR [#160](https://github.com/brainAI-bot/satp/pull/160), exact head
`fd654ce5a33c68fee5ff8120040b607684f22246`, is now the authoritative
delta-only candidate. It was built from the certified SATP lineage and preserves
all 14 instruction names and discriminators, the `EscrowV3` account layout,
existing error numbers, existing authority checks, and all five USDC routes.
All ten exact-head GitHub checks are green and an independent review is recorded
as approved. It nevertheless remains **NO-GO**: the candidate is `3448` bytes
larger than the deployed ProgramData allocation, no bounded extension decision
or exact-command localnet receipt exists, full handler/LiteSVM coverage is not
claimed, and Hani has not given an explicit Owner approval in HQ. The rejected
AgentFolio-local artifact remains reference-only and is not an upgrade candidate.

## Certified live baseline

PR #277 recorded this finalized read-only baseline on 2026-08-25. The values
must be re-read immediately before any later write; any mismatch aborts the
window.

| Item | Certified value |
| --- | --- |
| Cluster / genesis | `mainnet-beta` / Solana mainnet |
| Program | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` |
| ProgramData | `Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk` |
| Upgrade authority | `Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc` |
| Certified upgrade slot / transaction | `441423817` / `21jwie1FpQGvjV5yFQ6ofgcKPzp3hrM2DKtLGeyQ4XVr2DQg5LYg7fqira9XSsUTTbfJBM9V8yY8Pe1fchDimkVx` |
| Allocated runtime | `346856` bytes / `4f21da13659cbe99a606b408a5f1d3523c0e41de20538028939bbb1b54c3cc0d` |
| Trimmed runtime | `346841` bytes / `2f3bb05486f39d3f61a454905048b6e5732b798643405836b62a6d9795a20a6d` |
| Published IDL account | `4zNAR5DGuWuUnEbwGb7FzEVUUCx2xKca2bmHCeVpjQCJ` |
| Published IDL SHA-256 | `e8c142f27e225d8edc2f8f41e6fb698ebbb73f69d2fc078d5bf963234ebc8fa9` |
| Published instruction count | 14 |

The certified `release` and `partial_release` instructions have no treasury
account and transfer the gross amount to the agent. No successful instance of
either instruction exists in the complete 35-signature program history sampled
by PR #277, so there is no pre-change treasury-delta evidence to preserve.

## Candidate audit evidence

The tracked AgentFolio candidate was assessed only as implementation reference,
not as deployable provenance:

| Check | Result |
| --- | --- |
| Strict source/IDL verifier | PASS: `status: verified` for repo-local program ID and IDL consistency |
| Fee and authority test slice | PASS on Node `v22.23.2`: 44 passed, 0 failed |
| SBF toolchain | `cargo 1.86.0`, `anchor-cli 0.31.1` |
| Rebuilt candidate | `289216` bytes / `21dda9b5b0f95aba7f2560d58f2085de7ef8d0c9f1e3ac79f8ee506dcb9c6cf4` |
| Source / tracked IDL | `a713fb25...efd4c` / `19ab1ae2...e1262` |
| Compatibility audit | FAIL: 9 instructions versus 14 live; five USDC instructions removed |

The local SBF build is deterministic against the previously recorded
AgentFolio candidate hash, but reproducibility does not make the candidate
compatible with the live program.

The authoritative SATP candidate has these independently reviewable inputs and
outputs:

| Item | SATP PR #160 exact candidate |
| --- | --- |
| PR head | `fd654ce5a33c68fee5ff8120040b607684f22246` |
| Build-source commit | `a35568bc3926bd44d73680813bda0e8d5371705f` |
| Source SHA-256 | `380b20d36f18253a5c382ec1abc4a1147a08092a9a42cdae25e5d954f41acd0a` |
| Cargo.lock SHA-256 | `d98db19e0d86ca3248376d4857b150b240be05c4bc3a409d7cb638ce4d5d2237` |
| Candidate SBF | `350304` bytes / `27395415b6dc3d069d8a0a974613e647af1494590cbaff0a2658945a2bc4784a` |
| Existing allocation | `346856` bytes; candidate exceeds it by `3448` bytes |
| Capacity status | `extension_required_before_buffer_write`; no padded candidate hash exists |
| Generated IDL | `9bb7e2a441af653108b21360a8aa14daa9bd8d54eebbc5eef88e7f3de881ba10` |
| Generated IDL compressed size | `3254` bytes within the recorded `6764`-byte payload capacity |
| Immutable treasury | `FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be` |
| Toolchain | `solana-cli 2.1.21`; `cargo-build-sbf 2.1.21`; platform tools `v1.52` |
| Local verification | Rust unit tests: 5 passed; SATP offline CI: green; immutable SBF rebuild reproduced exact hash |

The locked SATP packet is
`docs/escrow-v3-fee-routing-change-control-011685d4.md` in PR #160. Its rollback
payload is the current `346856`-byte allocated runtime with SHA-256
`4f21da13659cbe99a606b408a5f1d3523c0e41de20538028939bbb1b54c3cc0d`;
its rollback IDL SHA-256 is
`e8c142f27e225d8edc2f8f41e6fb698ebbb73f69d2fc078d5bf963234ebc8fa9`.

## Implemented delta-only target

SATP PR #160 implements the admissible delta against the certified SATP source;
the AgentFolio-local program is not copied over it. The audited scope is:

1. Add an immutable 500-basis-point platform fee and bind the recipient to
   `FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be`.
2. Add the writable treasury account to SOL `release` and `partial_release`
   without changing their instruction discriminators.
3. Preserve all five USDC instructions unchanged. This packet does not certify or
   charge a USDC platform fee; adding one requires a separate product decision and
   separately reviewed change.
4. Preserve gross accounting: `platform_fee = floor(gross * 500 / 10000)`,
   `agent_amount = gross - platform_fee`, and
   `agent_amount + platform_fee == gross` for every accepted amount.
5. Preserve `EscrowV3` serialized size and field order, every existing account
   constraint and signer requirement, all 14 instruction names and
   discriminators, and every existing error number. New errors must be appended.
6. Generate an IDL from that exact source tree and test old-client rejection,
   new-client account order, wrong-treasury failure, overflow, rounding, dust,
   full release, partial release, disputes, cancellation, and all USDC paths.

PR #160 records the immutable source commit, source hash, Cargo lock hash,
generated IDL hash, SBF hash and length, local test receipt, capacity proof,
and rollback hashes. Exact-head checks and independent review are complete for
`fd654ce5...`. The remaining hard gates are a separate bounded ProgramData
extension decision with an exact-command localnet receipt, full handler/LiteSVM
coverage required by this packet, and explicit Owner approval. Any new commit
invalidates the review request and approval packet.

## Approval matrix and hard stops

| Gate | Required evidence | Approver |
| --- | --- | --- |
| Delta audit | Exact PR #160 head `fd654ce5...`; no unrelated logic or interface deletions | brainShield, independent of builder |
| Reproducible build | Two clean hosts produce the same trimmed SBF and IDL hashes | brainChain plus independent verifier |
| Capacity | Candidate byte length is at most the current `346856` allocation | **FAIL:** `350304` bytes; abort and request a separate extension decision |
| Authority | Finalized readback still reports ProgramData `Fg1D...` and upgrade authority `Bq1ni...` | brainChain read-only evidence |
| Change window | Exact source/SBF/IDL hashes, signer public identities, fee cap, validation cap, time window, and rollback hashes | Owner/Hani in HQ |
| App freeze | Live escrow writes disabled before the program write and kept disabled through both canaries | AgentFolio operator |
| Roadmap | Remains pending until both bounded routes and source/deployed/IDL equality are independently verified | Independent reviewer |

Abort before signing if any field is blank, any hash differs, the working tree
is dirty, the candidate exceeds the current allocation, the signer public key
does not match the approved role, a required approval is stale or ambiguous, or
the rollback artifact is not locally readable and hash-verified. No agent may
discover, copy, print, generate, rotate, or take custody of an Owner key.

## Read-only preflight and unresolved command proof

Only this read-only subset is admissible from the current packet. Values in
angle brackets are deliberate hard stops, not defaults. The build and proposed
deployment toolchain is pinned to `solana-cli 2.1.21`; using another version
invalidates the command review.

```sh
export PROGRAM_ID=HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C
export PROGRAM_DATA=Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk
export EXPECTED_AUTHORITY=Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc
export TREASURY=FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be
export RPC_URL=https://api.mainnet-beta.solana.com
export CANDIDATE_SO=<absolute-reviewed-candidate-so>
export CANDIDATE_IDL=<absolute-reviewed-candidate-idl>
export ROLLBACK_SO=<absolute-prechange-program-dump>
export ROLLBACK_IDL=<absolute-certified-prechange-idl>

test "$(solana --version | awk '{print $2}')" = "2.1.21"
solana program show --url "$RPC_URL" "$PROGRAM_ID" --output json
solana program dump --url "$RPC_URL" "$PROGRAM_ID" "$ROLLBACK_SO"
shasum -a 256 "$ROLLBACK_SO" "$CANDIDATE_SO" "$CANDIDATE_IDL"
wc -c "$ROLLBACK_SO" "$CANDIDATE_SO"
```

Required pre-write results:

- rollback allocated payload is `346856` bytes with SHA-256
  `4f21da13659cbe99a606b408a5f1d3523c0e41de20538028939bbb1b54c3cc0d`;
- candidate is exactly `350304` bytes with SHA-256
  `27395415b6dc3d069d8a0a974613e647af1494590cbaff0a2658945a2bc4784a`;
- the candidate is `3448` bytes larger than the current allocation, so this
  preflight must stop before any buffer write, signer access, or fee-payer use;
- the final candidate source/SBF/IDL hashes equal the exact HQ approval; and
- local/LiteSVM tests cover all 14 instructions and both fee paths without RPC
  writes.

## No write window is admitted by this packet

There is no deploy or IDL-write command template in this packet. The current
candidate cannot upgrade in place without extending ProgramData, and no
`solana-cli 2.1.21` localnet receipt exists for an exact bounded extension plus
upgrade sequence. Keeping an unverified command beside a no-improvisation rule
would be unsafe.

A future, separately reviewed extension packet must first define the exact new
allocation and rent cost, pin every `solana-cli 2.1.21` argument, and attach a
localnet dry-run receipt proving that exact sequence extends by only the
approved amount, upgrades the existing ProgramData in place, preserves program
and authority addresses, and produces the expected runtime/IDL readbacks. Only
after that evidence exists may Hani consider one Owner approval covering the
extension, buffer write, program upgrade, IDL write, two canaries, and rollback.

Until then: do not load a signer, fund a fee payer, create a buffer, extend
ProgramData, deploy, or write an IDL.

## Bounded validation plan

The Owner approval must name two dedicated canary escrows, their client signer
owners, the agent recipient, a total lamport cap, and the exact gross amount.
The gross amount must be large enough for a non-zero 5% fee. No existing user
escrow may be used.

1. Capture finalized pre-balances for both escrow PDAs, agent, and treasury.
2. Invoke `release` against one canary for its full gross amount.
3. Invoke `partial_release` against the second canary with an amount equal to
   that canary's full gross amount, so no residual user value remains.
4. Neither canary transaction may call `close_escrow`; both escrow accounts
   remain open, so rent closure is neither expected nor subtracted. For each
   finalized signature, the merged PR #277 verifier must prove the raw balance
   deltas exactly:
   `treasury_delta = floor(gross * 500 / 10000)`,
   `agent_delta = gross - treasury_delta`, and
   `escrow_delta = -gross`. The required verifier gates are
   `grossMeetsNonZeroFeeMinimum`, `treasuryDeltaPositive`,
   `escrowRemainedOpenWithoutRentClosure`, `escrowRawDeltaMatchesGross`,
   `treasuryDeltaMatchesFee`, and
   `agentDeltaMatchesNet`; every gate must be `true`.
5. Record instruction account order, program logs, signature, slot, block time,
   and pre/post balances in a GitHub/HQ-visible receipt.
6. Keep writes disabled until an independent reviewer verifies both receipts
   and the source == deployed binary == published IDL binding.

If USDC fee routing is selected, repeat the same proof with dedicated token
accounts and token deltas under a separately stated token cap. SOL canaries do
not certify USDC behavior.

## Rollback and containment

Rollback triggers are: candidate runtime hash mismatch, authority drift, IDL
publication failure, instruction/discriminator drift, either canary failure,
any wrong recipient or delta, unexpected program error, or inability to produce
finalized evidence within the approved window.

Containment is immediate: keep app writes disabled, stop canaries, preserve all
signatures/logs, and read finalized state. If the upgrade is confirmed and a
rollback trigger remains, redeploy the pre-verified rollback SBF with the same
bounded authority/fee-payer controls, republish the certified rollback IDL, and
verify the original runtime and IDL hashes. The future extension packet must
also pin and locally prove the exact rollback invocation. A rollback is itself
a mainnet write and must be included in the original Owner approval; otherwise
remain frozen and request emergency authority.

Do not roll back an unconfirmed transaction, do not improvise a new build, do
not extend ProgramData, and do not rotate authority during this window.

## Post-change evidence required to close [#011685d4]

- exact approved source commit and clean diff from SATP `93fc6c0d`;
- finalized **trimmed** runtime must equal the approved candidate exactly:
  `350304` bytes and SHA-256
  `27395415b6dc3d069d8a0a974613e647af1494590cbaff0a2658945a2bc4784a`;
- finalized allocated payload length and SHA-256 must equal the exact values in
  the future approved extension packet; merely recording different values does
  not pass and this packet intentionally cannot supply them yet;
- published IDL must equal SHA-256
  `9bb7e2a441af653108b21360a8aa14daa9bd8d54eebbc5eef88e7f3de881ba10`,
  contain the same 14 instructions, and include its account, transaction, and
  finalized readback;
- unchanged ProgramData address and upgrade authority readback;
- one finalized, bounded SOL `release` receipt with exact deltas;
- one finalized, bounded SOL `partial_release` receipt with exact deltas;
- USDC receipts if USDC fee routing is selected;
- independent brainShield audit and independent evidence review;
- app-write enablement decision made only after all gates pass; and
- a later roadmap PR referencing the evidence document. No evidence means the
  roadmap item remains pending.

## Current-task safety readback

```text
program-upgrade: not performed
idl-write: not performed
transaction-submit: not performed
keypair-access-or-change: not performed
fee-payer-funding: not performed
money-movement: not performed
production-mutation: not performed
live-write-enablement: not performed
roadmap-change: not performed
current-agentfolio-candidate: REJECTED-NONAUTHORITATIVE
satp-pr-160-candidate: NO-GO-CAPACITY-EXTENSION-DRY-RUN-LITESVM-OWNER
```
