# Base Sepolia x402 two-exchange test-payment runbook

Status: bounded R1 test procedure. **Repository tests are inert; network execution is permitted only by a task that names the exact UTC window, amount cap, wallet boundary, and facilitator.**

## Fixed P13 contract

| Field | Required value |
| --- | --- |
| Network | Base Sepolia, CAIP-2 `eip155:84532` |
| Forbidden network | Base mainnet, CAIP-2 `eip155:8453` |
| Asset | Circle Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Decimals | 6 |
| Facilitator | `https://x402.org/facilitator` for this isolated test only |
| Quote TTL | 600 seconds |
| Authorization maximum | 300 seconds |
| Pair-admission margin | at least 60 seconds remaining on both authorizations |
| Settlement-dispatch floor | at least 30 seconds remaining on the dispatched leg |
| Order | verify both concurrently; settle fee first; dispatch product only after fee settlement success |
| Per order | at most 20,000 minor units: 10,000 fee + 10,000 product (0.02 test USDC total) |
| Aggregate | at most 200,000 minor units and 10 pairs |

The facilitator is an untrusted settlement adapter. Shops owns the immutable quote, amount, asset, network, recipient, product, artifact hash, pair order, payment state, receipt, and entitlement decision. No production network, real USDC, production/legacy AgentFolio wallet, SATP wallet, HQ-box runtime, production mount, deploy, paid hosting, public launch, credential disclosure, admin/DNS/org mutation, or mainnet write is part of this runbook.

## Fresh-wallet handling

Use one fresh EVM wallet created for this Base Sepolia test. Store its private material outside Git in a mode-`0600` file or an approved secret store. Record only the public address. Never paste a private key, mnemonic, seed phrase, wallet JSON, RPC token, or environment file into Git, HQ, logs, messages, screenshots, shell arguments, or evidence. Do not reuse the wallet on Base mainnet or for legacy AgentFolio/SATP.

The public Circle faucet may fund the fresh address with test USDC. Confirm the balance with a read-only `eth_call` before signing. The x402 facilitator sponsors settlement gas for the EIP-3009 path; the buyer wallet does not require Base Sepolia ETH for this test.

Value-free balance readback, with the public address ABI-padded in `data`:

```bash
curl -sS https://sepolia.base.org \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","data":"0x70a08231<PADDED_PUBLIC_ADDRESS>"},"latest"],"id":1}'
```

A zero balance, unavailable faucet, faucet rejection, or absent secure wallet file is an exact capability blocker. Do not substitute a production wallet or request a private key in chat.

## Two-exchange HTTP flow

1. Create one immutable order snapshot containing fee and product requirements. Both use the same issue time and 600-second quote expiry, but distinct quote IDs, resource URLs, payment identifiers, EIP-3009 nonces, and `(order_id, leg)` fingerprints.
2. Calling the unpaid fee resource returns a fee-specific `402 Payment Required` with exactly one `accepts[]` requirement. After fee staging, calling the unpaid product resource returns a product-specific `402` with exactly one requirement. In x402 v2, entries within one `accepts[]` array are alternatives, so cumulative legs must never share one challenge.
3. Sign both EIP-3009 authorizations with `maxTimeoutSeconds=300`.
4. Call facilitator `/verify` for fee and product concurrently. Pair admission fails unless both verify and each has at least 60 seconds remaining.
5. Before every settlement dispatch, require at least 30 seconds remaining on that leg.
6. Call `/settle` for the fee leg first.
7. Dispatch the product `/settle` only after the fee response is a settlement success with a transaction reference.
8. Track each leg independently through verified, dispatched, settlement success, L2 receipt, safe/L1-posted, and finalized. Product dispatch follows fee settlement success, not fee finality. Entitlement waits for the later leg finality required by the selected test policy.
9. Bind the receipt to both quote hashes, both payment fingerprints, both settlement/transaction identities, the network, asset, amounts, recipients, timestamps, and artifact metadata.
10. Download only from the Shops-owned entitlement snapshot, recompute SHA-256 independently, and compare it with the immutable receipt.

## Unknown settlement rule

`settlement_pending`, timeout, connection loss, malformed response, or facilitator 5xx is non-terminal.

- Freeze the affected leg and retain the original authorization, nonce, payment fingerprint, settlement ID, and transaction hash when present.
- Set `automaticResubmitAllowed=false`.
- Reconcile the original transaction/authorization. Never create a replacement payment.
- Fee unknown means product is never dispatched until the original fee is reconciled as settled.
- Product unknown after fee success is the defined split outcome; reconcile only the original product payment.
- A terminal rejection requires structured evidence that the original authorization cannot settle and no matching successful transfer exists. Missing receipt or failed HTTP alone is insufficient.

## Bounded execution cases

Run only inside the task-authorized UTC window and stop when the first exact capability blocker prevents safe continuation.

1. Capture the unpaid `402` and both immutable requirements.
2. Sign two distinct authorizations.
3. Verify both concurrently and record start/end UTC and facilitator results.
4. Settle fee, then product after fee settlement success; record transaction hashes and per-leg receipt/finality timestamps.
5. Read the Shops payment state and prove both legs remain separately visible.
6. Build the bound receipt, download the artifact, compute SHA-256 independently, and compare it with the receipt.
7. Run one cutoff case with 60 seconds remaining: exactly 60 seconds may admit; less than 60 seconds must fail before settlement.
8. Run one `settlement_pending`/reconciliation case using the original transaction only. If the public facilitator cannot deterministically produce pending state without an unsafe replacement or unbounded transfer, run the isolated adapter harness and report the live capability gap separately.
9. Run at most 10 pairs and 0.20 test USDC aggregate. Capture latency and any 429 response. Stop at either bound.

## Repository harness

The pure, dependency-injected pair contract is in `shops/src/two-exchange-slice.mjs`; its focused harness is `shops/tests/two-exchange-slice.test.mjs`.

```bash
npm --prefix shops test
npm --prefix shops run check:boundary
```

The harness proves:

- separate fee and product `402` responses with one requirement each;
- rejection of duplicate authorization IDs or payment fingerprints across legs;
- Base mainnet, wrong asset, wrong facilitator, and amount-cap rejection;
- concurrent verification;
- fee-first then product settlement order;
- exact 60-second admission and 30-second dispatch boundaries, including a fresh clock read after slow fee settlement;
- fee/product unknown-state freeze and original-payment reconciliation without replacement;
- payment-state readback;
- a bounded 10-pair probe;
- receipt binding and downloaded-file SHA-256.

Passing repository tests prove the orchestration contract only. They do not prove a facilitator call, transaction submission, receipt, finality, balance change, or live download.

## Evidence format

Report these states separately:

- `repository_tested`
- `wallet_funded`
- `authorization_signed`
- `facilitator_verified`
- `fee_transaction_submitted`
- `fee_transaction_confirmed`
- `product_transaction_submitted`
- `product_transaction_confirmed`
- `receipt_ready`
- `download_verified`

Evidence may include the public test wallet address, UTC, raw value-free commands, public transaction hashes, receipt/finality timestamps, PR/head/checks, and downloaded-file SHA-256. It must not contain private wallet material or secret-bearing environment/process output. If execution cannot proceed, return one exact blocker naming the endpoint or capability, observed result, and the owner/action needed to unblock it.
