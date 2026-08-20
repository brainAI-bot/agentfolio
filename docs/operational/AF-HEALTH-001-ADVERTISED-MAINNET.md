# AF-HEALTH-001 — Advertise mainnet HXCU next to leftover escrow health network

Date: 2026-08-20

## Live split

`GET /api/v3/escrow/health` on the leftover host reports:

- top-level `network=devnet`
- `liveEscrow.runtimeNetwork=devnet`
- provenance `runtimeProgramId=B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg`
- expected / `escrowProgramId=HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`
- mismatches includes `devnet_runtime_program_id_mismatch`
- `authoritativeSource=satp-client-package`

`GET /api/satp/programs` advertises `network=mainnet-beta` and escrow `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`.

## Classification

HXCU-vs-B1Se is a **host env split**, not a missing IDL.

- Advertised SATP programs surface: `advertisedNetwork=mainnet-beta`, `advertisedEscrowProgramId=HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`
- Leftover host runtime inventory stays: `runtimeNetwork=devnet`, leftover runtime program `B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg`
- Repo-checked SATP IDL fallback stays labeled (`source=repo-checked-fallback` when packaged `idls/v3/escrow_v3.json` is absent)
- AgentFolio `onchain/escrow_v3` remains leftover non-authoritative inventory

This change does **not** ungate writes, POST create, set env flags, or touch `AGENTFOLIO_ESCROW_KILL_SWITCH` / `AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES`.
