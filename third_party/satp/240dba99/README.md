# SATP 240dba99 escrow IDL fallback

Byte-for-byte copy of SATP `idls/v3/escrow_v3.json` from commit
`240dba99dc4e555e9dd221d93f76f2726bd8159e`.

- Git blob sha: `d616b30414c9e718a4da39cc51c473a84136ff9b`
- Size: 20504 bytes
- Used only when the packaged file
  `node_modules/@brainai/satp-client/idls/v3/escrow_v3.json` is missing
  (host git-pin install does not ship that file).
- Authority still prefers the packaged satp-client path when present.
- This is a copy of the satp-client package IDL, not AgentFolio onchain.
- `authoritativeSource` remains `satp-client-package`.
