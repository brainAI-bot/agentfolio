# AgentFolio SATP escrow v3 authoritative runtime refresh

Date: 2026-08-24

HQ task: `AGENTFOLIO-SATP-ESCROW-V3-AUTHORITATIVE-RUNTIME-REFRESH-20260824`

## Authoritative package and runtime

- SATP commit: `93fc6c0d86302cfe8b0d8c798ba2817d7eeace44`
- Mainnet escrow program: `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`
- Packaged IDL: `idls/v3/escrow_v3.json`
- IDL SHA-256: `e8c142f27e225d8edc2f8f41e6fb698ebbb73f69d2fc078d5bf963234ebc8fa9`
- IDL Git blob: `3d3d675926b6d4e8259adde5783a18827a7a946f`
- IDL size: 20,548 bytes
- IDL instruction count: 14

The package IDL explicitly names HXCU. The AgentFolio authority readback also
requires the expected SHA-256 and all 14 instructions before reporting
`status=verified`.

The SATP package continues to report the separate devnet escrow program
`B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg`. It remains visible as leftover
devnet inventory but does not invalidate finalized HXCU mainnet provenance.

## Finalized chain evidence

- Program upgrade transaction:
  `21jwie1FpQGvjV5yFQ6ofgcKPzp3hrM2DKtLGeyQ4XVr2DQg5LYg7fqira9XSsUTTbfJBM9V8yY8Pe1fchDimkVx`
- Published IDL transaction:
  `3nUp72KUkwtRbkKDjFBdg6X8qk85qJLwZLYn36xrwVmdNkbQ1RstQCaRzXHgFS58TE2nTacYimsscBTRJWbRgH1j`

Read-only RPC confirmed that both cited transactions succeeded. The finalized
IDL metadata account is
`4zNAR5DGuWuUnEbwGb7FzEVUUCx2xKca2bmHCeVpjQCJ`; its inflated payload has the
same SHA-256 as the packaged IDL and exposes all 14 instructions.

The package authority verifier checks the exact IDL hash, explicit HXCU address,
and instruction count. `scripts/verify-escrow-v3-runtime-recert.mjs` independently
checks the finalized program-data payload, upgrade transaction, IDL metadata
owner/account, IDL transaction, payload hash, and instruction count using
read-only Solana RPC calls.

## Release posture

This refresh deliberately removes `satpDevnetMatches` from the mainnet
`verified` predicate. The old term compared the separate B1Se devnet program
with HXCU and was structurally false, so it permanently blocked live mainnet
writes even when provenance, the release flag, the kill switch, and Owner
authorization all cleared. B1Se remains visible as leftover devnet inventory,
but it is no longer treated as a mainnet provenance gate.

The change does not turn writes on today. Live escrow writes remain false unless
the independent release flag, inactive kill switch, and explicit Owner
authorization all permit them. This refresh does not deploy or restart
AgentFolio, submit a Solana transaction, publish npm, alter keypairs, or enable
production writes. Health and PDA derivation remain read-only.
