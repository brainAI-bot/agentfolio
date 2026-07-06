# Escrow V3 Source/Deployed/IDL Readback [#49e40f78]

Date: 2026-07-06
Agent: brainForge
Scope: read-only verification; no production deploy, no keypair change, no mainnet action, no paid action, no Solana write.

## Selected Target

AgentFolio currently pins escrow V3 to:

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

The working tree has an unrelated dirty `satp-v3/yarn.lock`; the audited source paths below were read directly.

| Artifact | Path | SHA-256 / value |
| --- | --- | --- |
| clawd-brainchain Anchor config | `satp-v3/Anchor.toml` | `7af3f288b27ec7a2f931cb89ed2e645d0d809a12c7ca333d461388c4f34ac426` |
| clawd-brainchain escrow source | `satp-v3/programs/escrow_v3/src/lib.rs` | `4ff60eacc9fc0b5e2b527a4b1aa62992b6863883dc16a9cf305911682853dd23` |
| clawd-brainchain devnet program id | `satp-v3/Anchor.toml` | `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg` |
| clawd-brainchain source `declare_id!` | `satp-v3/programs/escrow_v3/src/lib.rs` | `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg` |
| clawd-brainchain mainnet program id | `satp-v3/Anchor.toml` | `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` |

Comparison result:

- AgentFolio source, AgentFolio tracked IDL, SATP runtime constant, and read-only devnet account readback agree on `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`.
- The audited `clawd-brainchain` source at commit `94a1d309dcc692228c357f6e28ab679196235ad2` does not match the AgentFolio pinned source hash and declares `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg`.
- `diff -q onchain/escrow_v3/programs/escrow_v3/src/lib.rs /Users/brainforge/clawd/tmp-clawd-brainchain-49e40f78/satp-v3/programs/escrow_v3/src/lib.rs` reports that the files differ.
- `diff -q onchain/escrow_v3/Anchor.toml /Users/brainforge/clawd/tmp-clawd-brainchain-49e40f78/satp-v3/Anchor.toml` reports that the files differ.

Conclusion: repo-local AgentFolio source/IDL/program-id consistency is verified, but the stricter audited-source-to-deployed alignment is not certified from the available `clawd-brainchain` source. Live escrow writes must remain gated until the authoritative audited source/IDL for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` is supplied and verified, or an authorized devnet replacement deploy is performed outside this read-only task.

## Commands Run

| Command | Result |
| --- | --- |
| `node scripts/verify-escrow-v3-source-idl.mjs --strict` | Pass; `status: verified`; Anchor config, source `declare_id!`, IDL address, and SATP identity enforcement checks all pass for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`. |
| `node --test tests/escrow-v3-authority.test.js tests/escrow-v3-dispute-recipient-binding.test.js tests/escrow-v3-pda-query.test.js tests/escrow-v3-selected-agent.test.js tests/satp-client-dependency-boundary.test.js` | Pass; 24 tests passed. |
| `anchor --version; solana --version` | Not available in this runner: `anchor: command not found`; `solana` was not reached by the chained shell after the missing `anchor`. |
| `cargo check` in `onchain/escrow_v3` | Not available in this runner: `cargo: command not found`. |
| Read-only devnet RPC account readback for `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C` | Pass; account exists and is executable; owner `BPFLoaderUpgradeab1e11111111111111111111111`; lamports `1141440`; data length `36`. |

## Safety Readback

No production deploy, no keypair change, no mainnet action, no paid action, no Solana write, no live escrow enablement, and no ROADMAP.md edit were performed.
