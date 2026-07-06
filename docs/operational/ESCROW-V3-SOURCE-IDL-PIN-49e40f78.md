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
| Program source | `onchain/escrow_v3/programs/escrow_v3/src/lib.rs` | `d36a4c165b11dad18767741a727b386eb31de5ae088163bef6aca7e8b34788bf` |
| Tracked IDL | `onchain/escrow_v3/target/idl/escrow_v3.json` | `10f07341c03679f8bc32dcadb8b2f7d4280095ef79e5a94d960b2194b4a159ba` |

Verification:

```sh
node scripts/verify-escrow-v3-source-idl.mjs --strict
node --test tests/escrow-v3-authority.test.js tests/escrow-v3-pda-query.test.js tests/satp-client-dependency-boundary.test.js
cd onchain/escrow_v3 && cargo check
```

Observed verification results:

| Command | Result |
| --- | --- |
| `node scripts/verify-escrow-v3-source-idl.mjs --strict` | Pass; `status: verified`; Anchor.toml, `declare_id!`, and IDL address all match `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`. |
| `node --test tests/escrow-v3-authority.test.js tests/escrow-v3-pda-query.test.js tests/satp-client-dependency-boundary.test.js` | Pass; 14 tests passed. |
| `cd onchain/escrow_v3 && cargo check` | Pass with existing Anchor/Solana cfg/deprecation warnings. |

Read-only devnet RPC readback for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` returned `exists: true`, `executable: true`, owner `BPFLoaderUpgradeab1e11111111111111111111111`, lamports `1141440`, and data length `36`.

Safety readback: this change does not deploy, upgrade, publish, mutate keypairs, change mainnet state, spend funds, or enable live escrow writes. The broader authority readback remains fail-closed because the packaged SATP escrow IDL still reports `UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22`; the SATP V3 runtime constants now match the selected `HXCU...` program ID.
