# AgentFolio live fee-routing proof certification [#011685d4]

Observed read-only at `2026-08-25T19:15:10.068Z` against finalized
`mainnet-beta`. Repository base: AgentFolio
`814b8ed797d82cecbdad07766f5d946181105850`. This packet performs no deploy,
program upgrade, transaction submission, keypair action, credential mutation,
or money movement. `ROADMAP.md` is intentionally unchanged.

## Verdict

| Gate | Result |
| --- | --- |
| Exact deployed program/binary | **PASS** — HXCU runtime readback and hashes match the pinned receipt. |
| Source == deployed binary == published IDL | **PASS** — the complete pinned packet verifies. |
| Certified `release` routes 5% to treasury | **FAIL** — the certified instruction has only `[escrow, client, agent]`; no treasury account exists. |
| Certified `partial_release` routes 5% to treasury | **FAIL** — the certified instruction has only `[escrow, client, agent]`; no treasury account exists. |
| Existing public transaction proof | **UNAVAILABLE** — zero matching successful transactions for either route across the program's complete 35-signature history. |

The exact deployed source is reproducible, but it is not the fee-routing source
currently tracked under `onchain/escrow_v3`. The certified SATP implementation
transfers the full release amount from escrow to the agent. Therefore fresh
transactions against the current certified runtime cannot prove a treasury
delta: the runtime has no treasury account in either instruction.

## Deployed-source and IDL certification

| Artifact | Certified value |
| --- | --- |
| Program | [`HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`](https://explorer.solana.com/address/HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C?cluster=mainnet-beta) |
| ProgramData | `Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk` |
| Upgrade slot / transaction | `441423817` / [`21jwie1F...DimkVx`](https://explorer.solana.com/tx/21jwie1FpQGvjV5yFQ6ofgcKPzp3hrM2DKtLGeyQ4XVr2DQg5LYg7fqira9XSsUTTbfJBM9V8yY8Pe1fchDimkVx?cluster=mainnet-beta) |
| SATP source commit | [`93fc6c0d86302cfe8b0d8c798ba2817d7eeace44`](https://github.com/brainAI-bot/satp/commit/93fc6c0d86302cfe8b0d8c798ba2817d7eeace44) |
| Source path / SHA-256 | `programs/escrow_v3/src/lib.rs` / `f4696cc27c5e2ff6163a90f877fd4431efa8809d2f6ae4c792c3c7cd18193c4d` |
| Allocated runtime | `346856` bytes / `4f21da13659cbe99a606b408a5f1d3523c0e41de20538028939bbb1b54c3cc0d` |
| Trimmed runtime | `346841` bytes / `2f3bb05486f39d3f61a454905048b6e5732b798643405836b62a6d9795a20a6d` |
| Published IDL account | `4zNAR5DGuWuUnEbwGb7FzEVUUCx2xKca2bmHCeVpjQCJ` |
| Published IDL transaction | [`3nUp72KU...bRgH1j`](https://explorer.solana.com/tx/3nUp72KUkwtRbkKDjFBdg6X8qk85qJLwZLYn36xrwVmdNkbQ1RstQCaRzXHgFS58TE2nTacYimsscBTRJWbRgH1j?cluster=mainnet-beta) |
| Source/published IDL SHA-256 | `e8c142f27e225d8edc2f8f41e6fb698ebbb73f69d2fc078d5bf963234ebc8fa9` |
| IDL instruction count | `14` |

Read-only runtime and published-IDL reproduction:

```sh
node scripts/verify-escrow-v3-runtime-recert.mjs
```

Complete source/build/IDL binding after checking out the SATP commit and
running the receipt-pinned build:

```sh
cargo build-sbf --force-tools-install --tools-version v1.52 \
  --manifest-path programs/escrow_v3/Cargo.toml --features mainnet

SATP_CHECKOUT=/path/to/satp-at-93fc6c0d
node scripts/verify-escrow-v3-runtime-recert.mjs \
  --artifact "$SATP_CHECKOUT/target/deploy/escrow_v3.so" \
  --source "$SATP_CHECKOUT/programs/escrow_v3/src/lib.rs" \
  --source-idl "$SATP_CHECKOUT/idls/v3/escrow_v3.json" \
  --source-commit 93fc6c0d86302cfe8b0d8c798ba2817d7eeace44
```

The complete invocation passed every runtime and packet check and returned
`status: source_deployed_idl_equal`, `sourcePacketVerified: true`,
`sourceBuildVerified: true`, and `sourceDeployedIdlEqual: true` at
`2026-08-25T19:12:25.835Z`.

## Certified interface versus undeployed fee-routing interface

| Surface | `release` accounts | `partial_release` accounts | SHA-256 / status |
| --- | --- | --- | --- |
| Certified SATP and published IDL | `[escrow, client, agent]` | `[escrow, client, agent]` | `e8c142f2...c8fa9`; deployed |
| AgentFolio tracked IDL | `[escrow, client, agent, treasury]` | `[escrow, client, agent, treasury]` | `19ab1ae2...1262`; **not deployed** |
| AgentFolio tracked source | fee split + treasury | fee split + treasury | `a713fb25...fd4c`; **not the certified source** |

The tracked source and IDL are useful implementation candidates, but neither
hash equals the certified source/IDL packet. They cannot be cited as deployed
fee-routing evidence.

Cross-host interface and transaction-history verifier:

```sh
node scripts/verify-escrow-v3-live-fee-proof.mjs \
  --include-pre-upgrade --summary-only
```

The verifier exits `2` for a proof gap (and `1` only for RPC infrastructure
failure). At `2026-08-25T19:15:10.068Z` it recorded:

- 35 total program-address signatures, covering all available history;
- 19 successful transactions;
- two successful transactions at or after certified upgrade slot `441423817`;
- zero matching `release` transactions;
- zero matching `partial_release` transactions;
- zero certified-runtime treasury proof transactions for both routes; and
- structural status `certified_runtime_lacks_treasury_account` for both routes.

Consequently there are no release signatures, escrow deltas, agent deltas, or
treasury deltas to report. The two post-upgrade signatures are the program
upgrade and IDL publication cited above; neither invokes an HXCU release route.

## Exact Owner gate

Approve one separately audited mainnet change-control packet that:

1. deploys fee-routing `release` and `partial_release` instructions whose
   published IDL binds a writable treasury account;
2. re-runs the source == deployed binary == published IDL certification; and
3. submits one bounded validation transaction for each route, after which this
   read-only verifier records the escrow, agent, and treasury deltas.

That approval is not implied by this evidence PR. This task does not perform
the upgrade, enable live writes, sign a transaction, or move funds.

## Checks

```sh
node --check scripts/verify-escrow-v3-live-fee-proof.mjs
node --test tests/escrow-v3-live-fee-proof.test.js \
  tests/escrow-v3-platform-fee.test.js \
  tests/escrow-v3-authority.test.js
node scripts/verify-escrow-v3-source-idl.mjs --strict
git diff --exit-code origin/main -- ROADMAP.md
```

These checks passed on Node `v22.23.2`: 37 tests passed, zero failed; the
strict source/IDL verifier returned `status: verified`; and the roadmap diff
was empty.
