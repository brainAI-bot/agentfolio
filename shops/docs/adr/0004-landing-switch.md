# ADR 0004: Landing switch for paid trust-score x402 endpoints

Status: mechanism defined; switch not activated

## Goal

When the reviewed Shops landing release is ready, paid trust-score x402 endpoints must stop accepting new paid requests without silently changing SATP or marketplace reads.

## Mechanism

Introduce a server-side allowlisted setting named `PAID_TRUST_X402_MODE` for the three existing metered contracts:

- `GET /api/score?id=<profileId>`;
- `GET /api/profile/:id/trust-score`;
- `GET /api/leaderboard/scores`.

The setting has these values:

- `enabled` (or absent) — current behavior;
- `drain` — reject requests without a payment authorization with HTTP 503 and a stable `PAID_TRUST_DRAINING` code, while passing supplied authorizations to the existing verifier so proven receipts remain idempotent;
- `disabled` — return HTTP 410 and stable `PAID_TRUST_RETIRED` before payment middleware, omit all three routes from the pricing catalogue, and initiate no payment challenge or transfer;
- any other value — fail closed with HTTP 503 and stable `PAID_TRUST_MODE_INVALID` before payment middleware.

`src/server.js` is the canonical runtime. The unused `src/x402-payments.js` compatibility installer imports the same allowlist, gate, and pricing filter so it cannot drift open.

The setting is read only by the shared paid trust-score route adapter, defaults to `enabled` until an independently reviewed release changes it, and must not expose credential or payment values in logs or metrics. It must not alter unpaid profile, marketplace, SATP, or receipt-read paths. Activation requires exact-head review, rollback instructions, proof that unpaid trust/SATP reads remain reachable, and canonical live readback. Wave 0 adds no setting to production and disables nothing.

## Follow-on carriers (do not duplicate automatically)

1. Facilitator qualification: supported chains/assets, settlement/error semantics, webhook authenticity, replay/idempotency, sandbox evidence.
2. First-party catalogue: product ownership, price/version source, entitlement lifecycle, refund/dispute semantics.
3. Artifact threat model: untrusted uploads, MIME/content validation, malware scanning, tenant isolation, signed URLs, retention/deletion, abuse response.
