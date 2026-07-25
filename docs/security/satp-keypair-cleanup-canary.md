# SATP Keypair Cleanup Canary

Tasks: `TASK-51a49704`, `TASK-c628f54f`, `TASK-0302a173`

Scope: read-only inventory and source guardrails for SATP keypair cleanup relevant to the AgentFolio deploy gate. This branch does not rotate keys, change keypairs, send Solana transactions, deploy, publish, or mutate production.

## Inventory categories

The canary script `scripts/satp-keypair-inventory.js` scans tracked source only. It redacts by design because it reports paths and category counts, not key material.

| Category | Risk shape | Cleanup direction |
| --- | --- | --- |
| `trackedSecretPaths` | Real keypair-style JSON paths accidentally committed. | Must stay empty; test fails if a matching tracked path appears. |
| `env-configured-signer` | Runtime can be pointed at signer files through environment variables. | Keep, but document the required secret manager or host path owner before deploy. |
| `hardcoded-mainnet-deployer-path` | Code assumes the legacy host mainnet deployer JSON path. | Must stay at zero; runtime signer paths come from owner-managed environment. |
| `hardcoded-devnet-deployer-path` | Code assumes the legacy host devnet deployer JSON path. | Must stay at zero; historical docs use non-path owner-managed wording. |
| `platform-key-filename` | Known SATP platform key filenames appear in source. | Runtime defaults were removed; remaining references are `.gitignore`, inventory patterns, and canary assertions only. |
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

- `ecosystem.config.js`: PM2 production config belongs to the HQ deploy-truth/keypair decision and should not be changed without owner approval.
- `tools/score-sync.js`: legacy public-authority-to-keypath map needs a signer-authority decision before changing behavior.
- `docs/ONCHAIN-WIRING-PLAN.md`: historical/deployment documentation, not runtime signer loading.
- `platform-key-filename`, `legacy-authority-pubkey`, and `secret-key-loader`: tracked as follow-up inventory categories; this task only removed default local path assumptions where safe.

## `TASK-0302a173` final residual cleanup classification

Safe cleanup completed:

- `ecosystem.config.js` no longer embeds a SATP platform signer path. It still requires `production.env`, and now fails closed when `SATP_PLATFORM_KEYPAIR` is absent from owner-managed runtime config.
- `tools/score-sync.js` no longer embeds public-authority-to-keypath mappings. Live writes must provide `SCORE_SYNC_AUTHORITY_KEY_PATHS` as a JSON object mapping authority pubkeys to owner-managed keypair paths.
- `docs/ONCHAIN-WIRING-PLAN.md` no longer names a concrete devnet deployer keypair path.
- SATP signer-loading scripts and runtime modules that previously fell back to local platform-key filenames now require `SATP_PLATFORM_KEYPAIR` explicitly.

Remaining classified residuals:

- `platform-key-filename`: intentionally limited to guardrails (`.gitignore`, inventory patterns, and the canary test). Removing those would weaken tracked-secret prevention.
- `legacy-authority-pubkey`: intentionally retained where public addresses are part of historical JSON state, demo/reference UI, docs, verification checks, or authority comparisons. Blocker for further cleanup: keypair/authority ownership decision is still closed, and changing those addresses could alter identity, BOA, burn, or verification behavior.
- `secret-key-loader`: intentionally retained because the loaders are the mechanisms that deserialize owner-provided signer files for gated write surfaces. Blocker for further cleanup: replacing them requires a broader signer abstraction or wallet-provider design and explicit owner approval; this task cannot change keypairs or write behavior.

## Read-only verification

```bash
node scripts/satp-keypair-inventory.js --fail-on-tracked-secret
node --test tests/satp-keypair-cleanup-canary.test.js
```
