# ADR 0004: Landing switch for paid trust-score x402 endpoints

Status: mechanism defined; switch not activated

## Goal

When the reviewed Shops landing release is ready, paid trust-score x402 endpoints must stop accepting new paid requests without silently changing SATP or marketplace reads.

## Mechanism

Introduce a future server-side allowlisted setting named `PAID_TRUST_X402_MODE` for the two existing metered contracts:

- `GET /api/score?id=<profileId>`;
- `GET /api/profile/:id/trust-score`.

The setting has these values:

- `enabled` — current behavior;
- `drain` — reject new payment challenges with HTTP 503 and a stable `PAID_TRUST_DRAINING` code while allowing already-authorized receipts to complete idempotently;
- `disabled` — return HTTP 410 and stable `PAID_TRUST_RETIRED`, with no payment challenge or transfer initiation.

The setting must be read only by the shared paid trust-score route adapter, default to `enabled` until an independently reviewed release changes it, and emit value-free state/metrics. It must not alter unpaid profile, marketplace, SATP, pricing-catalogue, or receipt-read paths. Activation requires exact-head review, rollback instructions, proof that unpaid trust/SATP reads remain reachable, and canonical live readback. Wave 0 adds no setting to production and disables nothing.

## Follow-on carriers (do not duplicate automatically)

1. Facilitator qualification: supported chains/assets, settlement/error semantics, webhook authenticity, replay/idempotency, sandbox evidence.
2. First-party catalogue: product ownership, price/version source, entitlement lifecycle, refund/dispute semantics.
3. Artifact threat model: untrusted uploads, MIME/content validation, malware scanning, tenant isolation, signed URLs, retention/deletion, abuse response.
