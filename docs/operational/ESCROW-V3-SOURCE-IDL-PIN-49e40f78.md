# Escrow V3 Source/IDL Pin [#49e40f78]

Date: 2026-07-05

This packet pins the repo-visible `escrow_v3` Anchor source and tracked IDL to the existing HQ-selected authority target:

```text
escrow_v3 program id: 4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a
```

Tracked artifacts:

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| Anchor workspace config | `onchain/escrow_v3/Anchor.toml` | `033433c344adea41bb79c49c90b1ac79b8b3587abfd333ad684606ff04a0116d` |
| Program source | `onchain/escrow_v3/programs/escrow_v3/src/lib.rs` | `070d250b8f61cd4e8cde54e4f5fe9bb03fc700ffb3b2223e8afb96f12604dbaf` |
| Tracked IDL | `onchain/escrow_v3/target/idl/escrow_v3.json` | `78e01367688c11d93df828dba09a35aed75e211ce77303e0808e3aedd3199fa2` |

Verification:

```sh
node scripts/verify-escrow-v3-source-idl.mjs --strict
node --test tests/escrow-v3-authority.test.js tests/escrow-v3-pda-query.test.js tests/satp-client-dependency-boundary.test.js
cd onchain/escrow_v3 && cargo check
```

Read-only devnet RPC readback for `4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a` returned `exists: true`, `executable: true`, owner `BPFLoaderUpgradeab1e11111111111111111111111`, lamports `1141440`, and data length `36`.

Safety readback: this change does not deploy, upgrade, publish, mutate keypairs, change mainnet state, spend funds, or enable live escrow writes. The broader authority readback remains fail-closed until the packaged SATP runtime and packaged escrow IDL are separately reconciled with this selected program ID.
