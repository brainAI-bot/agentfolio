# SATP Keypair Cleanup Canary

Tasks: `TASK-51a49704`, `TASK-c628f54f`

Scope: read-only inventory and source guardrails for SATP keypair cleanup relevant to the AgentFolio deploy gate. This branch does not rotate keys, change keypairs, send Solana transactions, deploy, publish, or mutate production.

## Inventory categories

The canary script `scripts/satp-keypair-inventory.js` scans tracked source only. It redacts by design because it reports paths and category counts, not key material.

| Category | Risk shape | Cleanup direction |
| --- | --- | --- |
| `trackedSecretPaths` | Real keypair-style JSON paths accidentally committed. | Must stay empty; test fails if a matching tracked path appears. |
| `env-configured-signer` | Runtime can be pointed at signer files through environment variables. | Keep, but document the required secret manager or host path owner before deploy. |
| `hardcoded-mainnet-deployer-path` | Code assumes the legacy host mainnet deployer JSON path. | Must stay empty; PM2 and score-sync now require owner-provided secret configuration instead of built-in host paths. |
| `hardcoded-devnet-deployer-path` | Code assumes the legacy host devnet deployer JSON path. | Must stay empty; historical docs should describe owner-provided signer configuration without naming legacy host paths. |
| `platform-key-filename` | Known SATP platform key filenames appear in source. | Keep filenames ignored and migrate runtime docs to non-repo secret storage. |
| `legacy-authority-pubkey` | Public deployer/legacy signer addresses are embedded as assumptions. | Separate display/reference usage from signer-authority logic before deploy gate close. |
| `secret-key-loader` | Source loads local secret-key arrays into Solana/UMI signers. | Require explicit env, read-only dry-run tests, and owner approval before changing signer behavior. |

## Guardrails added

- `.gitignore` now covers known SATP key filenames beyond generic `*keypair*.json`.
- `tests/satp-keypair-cleanup-canary.test.js` fails on tracked keypair-style JSON paths.
- `scripts/satp-keypair-inventory.js` provides repeatable inventory output for review.

## `TASK-c628f54f` cleanup classification

Safe cleanup completed:

- SATP/BOA runtime write modules now use explicit `SATP_PLATFORM_KEYPAIR`, `DEPLOYER_KEY_PATH`, or `REVIEWS_WALLET_PATH` configuration instead of built-in signer file paths.
- Write-gated one-off scripts that previously embedded deployer paths now require `DEPLOYER_KEY_PATH`.

Not-safe / owner-gated in this task:

- `platform-key-filename`, `legacy-authority-pubkey`, and `secret-key-loader`: tracked as follow-up inventory categories; this task only removed default local path assumptions where safe.

`TASK-0302a173` final residual cleanup:

- `ecosystem.config.js`: production PM2 startup now fails closed unless `production.env` provides `SATP_PLATFORM_KEYPAIR`; no built-in deployer path remains.
- `tools/score-sync.js`: authority key paths now come from `SCORE_SYNC_AUTHORITY_KEYS_JSON`, keyed by authority public key; no built-in deployer path remains.
- `docs/ONCHAIN-WIRING-PLAN.md`: historical keypair references now describe owner-approved secret configuration without naming legacy host paths.

## Read-only verification

```bash
node scripts/satp-keypair-inventory.js --fail-on-tracked-secret
node --test tests/satp-keypair-cleanup-canary.test.js
```
