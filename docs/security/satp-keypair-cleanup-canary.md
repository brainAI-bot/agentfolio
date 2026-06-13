# SATP Keypair Cleanup Canary

Task: `TASK-51a49704`

Scope: read-only inventory and source guardrails for SATP keypair cleanup relevant to the AgentFolio deploy gate. This branch does not rotate keys, change keypairs, send Solana transactions, deploy, publish, or mutate production.

## Inventory categories

The canary script `scripts/satp-keypair-inventory.js` scans tracked source only. It redacts by design because it reports paths and category counts, not key material.

| Category | Risk shape | Cleanup direction |
| --- | --- | --- |
| `trackedSecretPaths` | Real keypair-style JSON paths accidentally committed. | Must stay empty; test fails if a matching tracked path appears. |
| `env-configured-signer` | Runtime can be pointed at signer files through environment variables. | Keep, but document the required secret manager or host path owner before deploy. |
| `hardcoded-mainnet-deployer-path` | Code assumes `/home/ubuntu/.config/solana/mainnet-deployer.json`. | Replace runtime defaults with explicit env configuration in a later approved implementation task. |
| `hardcoded-devnet-deployer-path` | Code assumes `/home/ubuntu/.config/solana/devnet-deployer.json`. | Remove from production paths; confine to tests or local-only fixtures. |
| `platform-key-filename` | Known SATP platform key filenames appear in source. | Keep filenames ignored and migrate runtime docs to non-repo secret storage. |
| `legacy-authority-pubkey` | Public deployer/legacy signer addresses are embedded as assumptions. | Separate display/reference usage from signer-authority logic before deploy gate close. |
| `secret-key-loader` | Source loads local secret-key arrays into Solana/UMI signers. | Require explicit env, read-only dry-run tests, and owner approval before changing signer behavior. |

## Guardrails added

- `.gitignore` now covers known SATP key filenames beyond generic `*keypair*.json`.
- `tests/satp-keypair-cleanup-canary.test.js` fails on tracked keypair-style JSON paths.
- `scripts/satp-keypair-inventory.js` provides repeatable inventory output for review.

## Read-only verification

```bash
node scripts/satp-keypair-inventory.js --fail-on-tracked-secret
node --test tests/satp-keypair-cleanup-canary.test.js
```
