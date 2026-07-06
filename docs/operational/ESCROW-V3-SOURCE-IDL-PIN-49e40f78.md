# Escrow V3 Source/IDL Pin [#49e40f78]

Date: 2026-07-05

This packet pins the repo-visible `escrow_v3` Anchor source and tracked IDL to the deployed devnet V3 runtime target identified in the 2026-07-05 escrow program gate packet:

```text
escrow_v3 program id: HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C
```

Selection readback: `docs/operational/ONCHAIN-ESCROW-PROGRAM-GATE-PACKET-2026-07-05.md` marks `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` as the current AgentFolio V3 runtime program ID via `@brainai/satp-client` and marks `4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a` as an obsolete docs-only reference that must not be used for launch claims.

Tracked artifacts:

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| Anchor workspace config | `onchain/escrow_v3/Anchor.toml` | `a296f41760a1a703e84f6e9a7a90eabec5fd03146d354ea45dfe4c0ad0783f5a` |
| Program source | `onchain/escrow_v3/programs/escrow_v3/src/lib.rs` | `ef44769c02a1ebfb4d3b1438fd630d395d8547d35c4211e693b95623fc7c7484` |
| Tracked IDL | `onchain/escrow_v3/target/idl/escrow_v3.json` | `f0bbc14e762f8e6beb66ee8ae15d23e29a0bbc60a9a03716bdc5bcf714cf27e1` |

Security follow-up for PR #155 review [#580d4a47]:

- `resolve_dispute` now requires the supplied writable `agent` recipient to equal `escrow.agent` and the supplied writable `client` recipient to equal `escrow.client` before lamports are moved out of escrow.
- `create_escrow` now derives the canonical SATP V3 Genesis PDA from `["genesis", sha256(agent_id)]`, requires the supplied `agent_identity` account to match that PDA, requires the account owner to be the SATP V3 identity program `GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG`, parses the Genesis record, and enforces `min_verification_level` plus `require_born` before escrow funding and before recording those requirements.
- Live escrow writes remain gated closed until source/IDL/deployed provenance is certified and an owner-approved release gate opens.

Provenance correction:

The source hash above is a hash of this PR's repo-visible `escrow_v3` source
blob. It is not an audited SATP source-history match for the deployed devnet
program. A 2026-07-06 read-only provenance check compared the claim against
`github.com/brainAI-bot/satp` refs after fetch:

| Repo/ref searched | Commit or result | Finding |
| --- | --- | --- |
| `satp` `origin/main` | `58fa9bdf4e0f4abf7d69c54b88bcef47b2aad9c8` | Carries `programs/satp_escrow/src/lib.rs` sha256 `4dc5793316b30342b2d3af30a670803428f36e52f143d5f5ff8e861c203d16c9` and `idls/satp_escrow.json` sha256 `a1c8209e023137fd0147457f1fa10cc57a7b707e91da63565a7ff20d82951c1b`; program id is `UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22`, not `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`. |
| `satp` `master` | Remote branch absent | No searchable authoritative branch at `origin/master`. |
| `satp` `anchor-1.0-migration` | Remote branch absent | No searchable authoritative branch at `origin/anchor-1.0-migration`. |
| `satp` `feat/anchor-1.0-migration` | Remote branch absent | No searchable authoritative branch at `origin/feat/anchor-1.0-migration`. |
| `satp` 49e40f78 source-history commits | `3e6fceea3a54043d527d14ba4e347e2693d5e1ed`, `47379ef97629ea2cce70c816d3e4b75890c8cabb`, `761ae99f8b8ec7f4878e5972e1fbb8e1b423178e`, `58fa9bdf4e0f4abf7d69c54b88bcef47b2aad9c8` | No exact blob-content match for the pre-review source hash `d36a4c165b11dad18767741a727b386eb31de5ae088163bef6aca7e8b34788bf`; the current PR source hash `ef44769c02a1ebfb4d3b1438fd630d395d8547d35c4211e693b95623fc7c7484` is a PR-local security patch and remains non-deployable until provenance is certified. |

Classification: absence/mismatch. This PR can document that its local
`escrow_v3` source, `Anchor.toml`, and IDL agree with
`HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`, but it must not certify that the
source was recovered from audited SATP history or that it matches the deployed
program bytes.

Security-hardening delta: the current PR-local source validates the supplied
SATP V3 Genesis PDA against the selected agent-id hash, enforces minimum
verification and birth requirements from that Genesis account, and requires
dispute-resolution payout recipients to match the stored escrow client and
agent. The tracked IDL changed only to include the new validation error codes.

Safe next action for brainForge: review this absence/mismatch classification and
choose either an owner-approved replacement devnet deploy from the audited SATP
source, or provide the missing authoritative audited source commit/tree and IDL
for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`. Until one of those exists,
keep live escrow writes gated.

Verification:

```sh
node scripts/verify-escrow-v3-source-idl.mjs --strict
node --test tests/escrow-v3-authority.test.js tests/escrow-v3-pda-query.test.js tests/escrow-v3-selected-agent.test.js tests/satp-client-dependency-boundary.test.js
cd onchain/escrow_v3 && cargo check
```

Observed verification results:

| Command | Result |
| --- | --- |
| `node scripts/verify-escrow-v3-source-idl.mjs --strict` | Pass; `status: verified`; Anchor.toml, `declare_id!`, and IDL address all match `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`; strict evidence also confirms `create_escrow` validates SATP identity before funding/recording `min_verification_level` and `require_born`. |
| `node --test tests/escrow-v3-authority.test.js tests/escrow-v3-dispute-recipient-binding.test.js tests/escrow-v3-pda-query.test.js tests/escrow-v3-selected-agent.test.js tests/satp-client-dependency-boundary.test.js` | Pass; 24 tests passed. |
| `cd onchain/escrow_v3 && cargo check` | Pass with existing Anchor/Solana cfg/deprecation warnings. |

Read-only devnet RPC readback for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` returned `exists: true`, `executable: true`, owner `BPFLoaderUpgradeab1e11111111111111111111111`, lamports `1141440`, and data length `36`.

Safety readback: this change does not deploy, upgrade, publish, mutate keypairs, change mainnet state, spend funds, or enable live escrow writes. The broader authority readback remains fail-closed because the packaged SATP escrow IDL still reports `UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22`; the SATP V3 runtime constants now match the selected `HXCU...` program ID.
