# AgentFolio complete PR test tree

The pull-request check named **AgentFolio complete test tree** runs
`npm run test:ci`. The runner discovers and executes every top-level
`tests/*.test.js` file, including all eight `marketplace-*.test.js` files.

The quarantine inventory is `config/ci-test-quarantine.json`. Every entry must
name an existing test file, state a specific reason, and carry an ISO expiry.
The check fails when a quarantine expires, a quarantined test starts passing,
an unlisted file fails, or an inventory entry no longer points to a discovered
test. This keeps known debt visible without restoring the former six-file gate.

## Baseline inventory (2026-09-19, Node 20)

| File | Current cause | Disposition |
| --- | --- | --- |
| `tests/escrow-v3-live-fee-routing-surface.test.js` | Stale pre-recertification capability assertion. | Quarantined through 2026-10-03. |
| `tests/escrow-v3-runtime-recert.test.js` | Stale source-IDL hash and published-IDL status assertion. | Quarantined through 2026-10-03. |
| `tests/explorer-agentid-deeplink-parity.test.js` | Express mock lacks the current `app.set` initialization seam. | Quarantined through 2026-10-03. |
| `tests/fee-routing-mainnet-change-control-packet.test.js` | Historical no-go packet pins superseded source hashes/text. | Quarantined through 2026-10-03. |
| `tests/homepage-public-stats.test.js` | Node 20 has no direct TypeScript module transform for the imported frontend helpers. | Quarantined through 2026-10-03. |
| `tests/satp-client-dependency-boundary.test.js` | One V3 route still bypasses the AgentFolio SATP adapter boundary. | Quarantined through 2026-10-03. |

Quarantine is a temporary CI disposition, not a declaration that these failures
are acceptable product behavior. Remove each entry in the same change that
repairs its test or bound runtime contract.