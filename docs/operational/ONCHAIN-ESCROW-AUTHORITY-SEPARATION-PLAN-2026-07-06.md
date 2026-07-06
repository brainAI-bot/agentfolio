# AgentFolio On-chain Escrow Authority-Separation Plan [#eb6ea3d2]

Date: 2026-07-06
Scope: Phase 4 Marketplace And Escrow Owner-provisioning plan

## Purpose

This plan names the escrow authority roles Owner must provision before devnet verification and before any later mainnet signing packet. It does not deploy, upgrade, rotate, export, store, or request key material.

The Phase 4 roadmap item is to split deploy/upgrade authority from operational signers. The rule for this repo and HQ is fingerprints only: public docs may name role labels and non-secret fingerprints, but no seed phrases, private keys, keypair JSON, raw secret bytes, encrypted private keys, or recovery material belong in GitHub, HQ, logs, screenshots, or PR comments.

## Authority Model

The escrow program must use separate authorities for program lifecycle, live-funds operations, fee payment, and dispute operations.

| Owner-provisioned role | Required separation | Allowed purpose | Must not be used for |
| --- | --- | --- | --- |
| `ESCROW_DEVNET_DEPLOY_AUTHORITY` | Separate from upgrade, fee payer, release, refund, dispute, pause/freeze, treasury, and app runtime identities. | Deploy or redeploy the devnet escrow program artifact for verification only. | Mainnet launch, runtime escrow operations, user signing, treasury movement, app server env secrets, or dispute actions. |
| `ESCROW_PROGRAM_UPGRADE_AUTHORITY` | Separate from deploy authority and all operational signers. Prefer multisig or hardware-backed custody. | Approve, deny, or freeze audited program upgrades after review. | Fee payment, release/refund/dispute instructions, route cranks, RPC access, treasury movement, or custodial fallback operations. |
| `ESCROW_DEVNET_FEE_PAYER` | Separate from deploy and upgrade authority. May be low-balance and environment-specific. | Pay devnet transaction fees for verification, test cranks, and readback transactions. | Program authority, mainnet funds, treasury receipt, release/refund/dispute authority, or app user identity. |
| `ESCROW_MAINNET_FEE_PAYER` | Separate from deploy and upgrade authority; distinct from the devnet fee payer. | Pay bounded mainnet launch and operational transaction fees after Owner approval. | Program authority, escrow settlement authority, treasury custody, or user identity. |
| `ESCROW_OPERATIONAL_RELEASE_SIGNER` | Separate from deploy/upgrade authority, fee payers, refund/dispute signer, treasury, and app runtime identity. | Submit allowed release or auto-release instructions only when the on-chain escrow state permits that role. | Program deploys/upgrades, refunds, dispute resolution, treasury movement, client approvals, or bypassing job-state checks. |
| `ESCROW_REFUND_DISPUTE_SIGNER` | Separate from deploy/upgrade authority, fee payers, release signer, treasury, and app runtime identity. | Submit refund or dispute-resolution instructions only for states that nominate this role or an approved arbiter path. | Program deploys/upgrades, ordinary releases, treasury movement, app runtime signing, or non-disputed settlement. |
| `ESCROW_PAUSE_FREEZE_AUTHORITY` | Separate from deploy, upgrade, fee payer, release, refund/dispute, and treasury roles. If the audited program has no pause/freeze control, the Owner packet must mark this role `N/A - no program control exposed`. | Pause, freeze, or resume escrow writes only if the program exposes that authority and the release gate approves its use. | Deploys/upgrades, settlement, dispute decisions, fee payment, treasury custody, or routine app operations. |
| `ESCROW_TREASURY_FEE_RECEIVER` | Non-signing receiver identity where possible; separate from all operational signers. | Receive configured AgentFolio protocol fees. | Program authority, settlement authority, fee payment, dispute operations, or app server signing. |
| `ESCROW_MONITORING_READBACK_IDENTITY` | Read-only identity or API credential, not a wallet authority. | Read program, IDL, transaction, and escrow-state evidence for health checks. | Any signing, program authority, settlement, fee payment, or treasury action. |

## Owner Provisioning Packet

Before devnet verification, Owner should provide a private packet outside this repo with:

- Role label from the table above.
- Network scope: `devnet`, `mainnet`, or `both`.
- Public key fingerprint or multisig address fingerprint.
- Custody mode: hardware, multisig, offline, or low-balance hot fee payer.
- Rotation owner and emergency contact path.
- Explicit non-use constraints for each role.

The repo and HQ evidence may record only the role label, network scope, and fingerprint. Any keypair file path, exported secret, recovery phrase, encrypted key blob, or credential handoff must stay outside GitHub and HQ.

## Enforcement Requirements

- Devnet deploy must be signed only by `ESCROW_DEVNET_DEPLOY_AUTHORITY`.
- Program upgrades must require `ESCROW_PROGRAM_UPGRADE_AUTHORITY`; no operational signer may satisfy an upgrade account constraint.
- AgentFolio app routes must fail closed if a release/refund/dispute caller does not match the selected job, escrow state, and nominated signer role.
- Fee-payer configuration must not grant settlement or upgrade authority.
- Release and refund/dispute signers must be independently rotatable without changing deploy or upgrade authority.
- Pause/freeze authority, if exposed by the program, must be independently rotatable and must not be the upgrade authority by default.
- Health/readback surfaces may expose non-sensitive fingerprints and hashes only.

## Devnet Verification Readback

The devnet authority readback evidence should include:

- Source commit, IDL hash, program binary hash, and deployed program ID.
- `solana program show` authority fingerprint.
- SATP client artifact commit and escrow IDL address fingerprint.
- AgentFolio runtime escrow program readback.
- Public fingerprints for the deploy, upgrade, fee payer, operational release, refund/dispute, and pause/freeze roles, or an explicit `N/A` for pause/freeze when the program lacks that control.

## Mainnet Gate

Do not include mainnet secrets in the repository or HQ. The later mainnet Owner signing packet should reference this plan, the devnet verification readback, and the security re-review closure for payment replay, unauthorized release/refund paths, and identity binding. Mainnet live-funds writes remain disabled until Owner approves the final signing packet and the application gate intentionally enables live escrow writes.
