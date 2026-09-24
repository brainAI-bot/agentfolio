# Base Sepolia x402 test-payment runbook (inert qualification)

Status: qualification only. **This repository change executes no payment and authorizes no network command.**

## Boundary

- Allowed qualification network: Base Sepolia, CAIP-2 `eip155:84532`.
- Forbidden network: Base mainnet, CAIP-2 `eip155:8453`.
- Live USDC, production wallets, AgentFolio legacy wallets, SATP wallets, credentials, private keys, seed phrases, RPC tokens, and funded addresses must not be committed or reused.
- The facilitator is an untrusted settlement adapter. Shops owns the immutable quote, amount, asset, network, recipient, product, artifact hash, receipt, and entitlement decision.
- Existing AgentFolio/SATP routes and `liveEscrowWritesAllowed=false` remain unchanged. Shops stays under `shops/**`, `/shops/**`, and `/api/shops/**` with its own future store and runtime.

## Owner-gated prerequisites

Do not perform a test payment until Hani separately selects and records all of the following through an authorized carrier:

1. Shops hosting option and isolated runtime.
2. Facilitator and the expected facilitator identity/configuration.
3. Base Sepolia test asset contract and decimal interpretation.
4. A securely provisioned Base Sepolia receiving wallet. Use `<OWNER_PROVISIONED_BASE_SEPOLIA_RECEIVER>` in documentation until then.
5. A separately authorized network execution window and exact maximum test amount.

Hosting selection, wallet provisioning, credential delivery, funding, and any payment are outside this qualification slice.

## Proposed future HTTP flow (not mounted by this change)

1. `POST /api/shops/v1/quotes` returns an immutable quote bound to product version, artifact SHA-256/length/media type, `eip155:84532`, asset, integer minor-unit amount, recipient, and expiry.
2. `POST /api/shops/v1/purchases` without valid payment proof returns the quote as an x402 `402 Payment Required` challenge.
3. A paid retry uses the same quote and a required `Idempotency-Key`. The key is bound to the canonical request hash before facilitator activity.
4. Shops derives the payment fingerprint from the submitted payment envelope; it never accepts a caller-supplied fingerprint. Shops independently checks the facilitator result against quote id/hash, network, asset, amount, recipient, expiry, that derived payment fingerprint, expected facilitator, settlement id, and transaction hash.
5. A timeout, connection loss, malformed response, or facilitator 5xx becomes `SETTLEMENT_UNKNOWN` and returns an in-progress response. It must never trigger an automatic resubmission.
6. Reconciliation may resolve the same payment fingerprint exactly once to `PAID` or `REJECTED`. `PAID` requires a settlement for the original derived fingerprint. `REJECTED` requires stored terminal evidence that the original authorization cannot settle and no successful matching transfer exists; timeout, missing receipt, or failed HTTP alone is insufficient. Reuse on another quote is rejected as `PAYMENT_REPLAY`.
7. Only `PAID` may mint an immutable receipt. Only a receipt bound to the server-side paid purchase record plus matching artifact bytes may become `READY` for download.

## Receipt and download verification

A receipt binds the quote hash, payment fingerprint, settlement/transaction identity, network, asset, amount, recipient, paid time, and artifact metadata. The receipt hash is SHA-256 over canonical JSON excluding the receipt hash itself, which detects mutation but does not prove Shops issued the receipt. The server-side purchase/entitlement record is authoritative.

Before a future download response:

1. Look up the Shops-owned purchase/entitlement snapshot by the authenticated request's server-side identifier; never accept that snapshot from the request.
2. Require the snapshot to be `PAID` or `READY`, and bind every receipt commerce, payment, settlement, and artifact field to that snapshot. A self-hashed receipt without this record is refused.
3. Verify the receipt hash.
4. Read the artifact from the Shops-owned isolated object prefix.
5. Verify exact byte length and SHA-256 before sending any bytes.
6. Return explicit `Content-Length`, `Content-Type`, immutable SHA-256 `ETag`, and `Content-Digest` headers.
7. Do not expose object-store keys or accept artifact metadata/download locations from the facilitator.
8. On snapshot/receipt mismatch, refuse entitlement; on byte mismatch, return `ARTIFACT_INTEGRITY_FAILED` without partial content.

Operator verification for downloaded test artifacts must independently calculate SHA-256 and compare it with the immutable receipt. A receipt or generated packet proves repository behavior only; it does not prove a chain transaction or payment occurred.

## Future authorized test checklist

When a later task explicitly authorizes network execution:

- record the exact tested commit and isolated environment;
- prove the configured chain is `eip155:84532`, never `eip155:8453`;
- prove the receiver and asset came from the Owner-approved secure configuration without printing either credential material or private keys;
- use the bounded approved test amount only;
- capture unpaid `402`, paid retry, payment-state readback, facilitator result, receipt verification, and downloaded-file SHA-256;
- if settlement is ambiguous, stop and reconcile; do not retry the transfer;
- report repository-tested, transaction-submitted, transaction-confirmed, receipt-ready, and download-verified as separate states.

Until those gates are met, the executable scope is limited to the pure contract and local tests in `shops/src/payment-contract.mjs` and `shops/tests/payment-contract.test.mjs`.
