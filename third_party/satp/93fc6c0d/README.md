# SATP 93fc6c0d escrow IDL fallback

Byte-for-byte copy of SATP `idls/v3/escrow_v3.json` from commit
`93fc6c0d86302cfe8b0d8c798ba2817d7eeace44`.

- Git blob sha: `3d3d675926b6d4e8259adde5783a18827a7a946f`
- SHA-256: `e8c142f27e225d8edc2f8f41e6fb698ebbb73f69d2fc078d5bf963234ebc8fa9`
- Size: 20548 bytes
- Program: `HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C`
- Instructions: 14
- Used only when the packaged file
  `node_modules/@brainai/satp-client/idls/v3/escrow_v3.json` is missing
  (host git-pin install does not ship that file).
- Authority still prefers the packaged satp-client path when present.
- This is a copy of the satp-client package IDL, not AgentFolio onchain.
- `authoritativeSource` remains `satp-client-package`.
