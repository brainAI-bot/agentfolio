# Makings Shops R1 threat model and adversarial QA map

Status: pre-launch security packet

Task: `TASK-3a177b31`

Evidence pin: `brainAI-bot/agentfolio` `origin/main` at
`4074aa252b128b9f32839cceecd3733b9c7a6cfd`

Security method: `manuals/MANUAL-SECURITY.md` at
`a33f7acb616d2e8c2cb236162fa831a20972ec73` (`security · v2`)

## 1. Purpose, authority, and exclusions

This document models the security properties that later Makings Shops packets must implement
and test. It reads the current `shops/` contracts, ADRs, Option 3 IaC, and
`shops/docs/PLAN-R1-TO-LAUNCH.md`. It is a finite pre-implementation risk register, not a claim
that the future service is safe to launch.

This packet authorizes no merge, deploy, infrastructure plan/apply, spend, DNS or public
exposure, production credential use, SSM value read, wallet/address output, signing, payment,
purchase, or production mutation. It does not probe a live system. Production `payTo` values
and derived addresses must never enter source, tests, logs, receipts, CI, task evidence, or
operator readback. Only the approved parameter **names** may appear here.

Out of scope:

- legacy AgentFolio marketplace, SATP, token, escrow, and wallet changes;
- product names, prices, licences, legal text, refund policy, and business-risk acceptance;
- penetration testing against any public or production endpoint;
- choosing or provisioning production recipients, keys, certificates, accounts, or DNS;
- accepting a residual release risk on the principal's behalf.

## 2. Security objectives and assets

The release must preserve these invariants:

1. **Pinned sale:** an order binds one immutable product version, artifact digest and size,
   licence version, network, asset, amount, facilitator policy, fee recipient class, and product
   recipient class. No mutable `latest` pointer can change an accepted quote.
2. **Two-exchange safety:** fee settlement is attempted before product settlement; ambiguity
   never triggers automatic resubmission; every dispatch and observation is durable and
   idempotent across crashes and retries.
3. **Finality before delivery:** no entitlement, receipt, or artifact download becomes available
   until both payment legs are bound to the order and independently meet the configured finality
   policy.
4. **Artifact integrity:** seller bytes remain untrusted in quarantine. Only a scanned byte
   sequence whose digest, size, type, and scan evidence match the pinned version may be promoted
   and delivered.
5. **Recipient confidentiality and integrity:** runtime reads exactly two approved SSM paths with
   least privilege, never outputs values, validates the two bindings in memory, and fails closed
   on absence, equality, malformed configuration, or wrong environment.
6. **First-party separation:** platform-fee and product revenue have distinct recipients,
   immutable ledger legs, reconciliation, and accounting evidence; neither is silently
   substituted for the payer or the other recipient.
7. **Constrained delivery:** Option 3 remains isolated from the existing AgentFolio/HQ-box
   deploy paths. Only immutable reviewed images may reach the protected environment after the
   principal gate.
8. **Recoverability without replay:** recovery restores authoritative rows, append-only events,
   outbox/dispatch state, object evidence, and idempotency claims before workers resume.
9. **No standalone receipt trust:** a digest over attacker-controlled receipt fields is not an
   authenticity proof. Verification must bind a receipt to trusted order/payment state or a
   server-authenticated proof.

Primary assets are product artifacts, catalogue versions, licences, quotes, orders, payment
authorizations and fingerprints, settlement/finality observations, recipient bindings,
entitlements, receipts, scan evidence, append-only events, database backups, object versions,
container provenance, CI/OIDC policy, audit logs, and principal approvals.

## 3. Actors and trust boundaries

| Boundary | Untrusted side | Trusted side | Mandatory crossing control |
| --- | --- | --- | --- |
| B1 Browser/API | anonymous or authenticated caller | Shops web/API | schema and size limits, authorization, rate limit, request ID, idempotency |
| B2 Catalogue administration | operator input and uploaded metadata | immutable product version | role separation, exact version ID, canonical encoding, append-only audit |
| B3 Upload | arbitrary archive/bytes | quarantine bucket | bounded streaming upload, digest while streaming, no execution, quarantine-only writer |
| B4 Scanner | hostile parser input | promotion decision | isolated non-root worker, CPU/memory/time/file limits, no network, fail-closed evidence |
| B5 Promotion | quarantined object and scan record | content-addressed artifact namespace | digest/size re-read, conditional immutable write, scanner cannot publish catalogue rows |
| B6 Quote/order | client-supplied identifiers and hashes | durable order state | trusted catalogue lookup, quote expiry, unique claim, canonical request fingerprint |
| B7 Facilitator | remote response, timeout, reorg, replay | payment state machine | pinned terms, bounded time, durable attempt row, no automatic retry after ambiguity |
| B8 Finality RPC | stale, split, or malicious observations | finality decision | multiple observations, configured confirmations, canonical block identity, reorg handling |
| B9 Delivery | bearer/session request | entitlement and artifact | subject/order binding, expiry/revocation, one authorized digest, range and abuse limits |
| B10 Runtime config | ECS task and SDK/error surfaces | two SSM recipient values in memory | exact-path IAM, value-free errors, redaction, no telemetry attributes or crash dumps |
| B11 CI/OIDC | pull request, branch, dependency, workflow input | image registry and deploy role | protected environment, exact OIDC subject, immutable digest, no PR-code deploy credentials |
| B12 Option 3 | Shops tasks, ALB, database, buckets | existing AgentFolio and HQ runtimes | separate target groups, roles, state, routes, logs, and rollback; no competing deploy path |
| B13 Recovery | backups and operator commands | restored service | isolated restore, integrity/readability test, dispatch disabled until reconciliation |
| B14 Principal gates | engineering evidence | spend, production, public and money authority | explicit contemporaneous approval; merge or green CI never implies approval |

### Data-flow summary

1. Catalogue administration creates a new immutable version; it never mutates a version already
   referenced by a quote or order.
2. Upload streams to `quarantine/`; scanner evidence and a second digest/size check authorize a
   conditional copy to `artifacts/sha256/<digest>`.
3. Quote creation copies all sale terms into an immutable snapshot with a bounded expiry.
4. Order creation claims the quote and client idempotency key in one transaction.
5. Verification binds two independent authorizations to the immutable pair. A durable outbox
   dispatches fee first and product only after the required fee result/evidence.
6. The finality watcher stores observations and reconciliation evidence; unknown is a stable
   state, not a retry instruction.
7. Both legs final creates an entitlement. Delivery re-hashes bytes and returns a receipt bound
   to trusted state and the accepted licence version.

## 4. Existing controls at the evidence pin

The current contracts already provide useful fail-closed properties, but they are in-memory and
pre-production:

- `payment-contract.mjs` hashes canonical quote terms, rejects Base mainnet in the qualification
  profile, binds facilitator terms, rejects payment replay, freezes settlement unknown against
  automatic resubmit, and binds delivery bytes to the quoted digest.
- `two-exchange-slice.mjs` binds a pair, caps the quote window and aggregate amount, verifies both
  authorizations before settlement, dispatches fee before product, records unknown outcomes, and
  requires both legs' finality before receipt readiness.
- focused tests cover term tampering, mainnet substitution, wrong asset/facilitator, duplicate
  fingerprints, partial/unknown settlement, malformed timestamps,
  recovery of finality evidence, receipt mutation, and artifact mismatch.
- The current contracts have no payer/recipient or fee/product recipient-distinctness check, so
  R04 starts from zero.
- ADRs keep Shops routes, data, runtime, and landing changes isolated. Option 3 defines separate
  web/scanner roles, PostgreSQL, S3, ALB, and bootstrap boundaries, but no apply is authorized.

These are contract evidence only. Maps and object snapshots do not provide durable concurrency,
restart, backup, or multi-worker guarantees. An unkeyed receipt hash proves consistency, not
issuer authenticity. Future packets must not mistake the current tests for release evidence.

## 5. Finite risk register

Severity uses release impact: **critical** can misdirect or duplicate money or deliver untrusted
bytes; **high** can bypass a core trust boundary or destroy reliable recovery; **medium** can
cause bounded abuse, evidence loss, or policy drift.

| ID | Sev | Reachable threat and impact | Required control and closure evidence | Owner packet |
| --- | --- | --- | --- | --- |
| R01 | critical | Catalogue/version mutation after quote changes artifact, price, licence, network, or recipient terms. | Immutable version rows; quote copies all terms; no `latest` in order path; mutation and stale-cache tests. | Pinned-version catalogue; PostgreSQL model |
| R02 | critical | Upload parser escape, malware, archive bomb, symlink/path traversal, decompression or file-count bomb compromises scanner or publishes hostile bytes. | Quarantine-only upload; isolated scanner with no network, non-root/read-only root, byte/file/depth/time limits; malicious corpus; fail closed. | Upload and scan; container images |
| R03 | critical | Scan/promotion TOCTOU swaps bytes after scan or accepts mismatched metadata. | Re-read digest/size from immutable object version; conditional content-addressed promotion; store scanner/version evidence; mismatch test. | Upload and scan; PostgreSQL model |
| R04 | critical | Recipient substitution, payer self-payment, equal recipients, wrong environment, or SSM value leakage redirects funds or exposes wallet data. | Exact two-path IAM; in-memory distinctness/environment checks; value-free errors/logs; dispatch disabled on any mismatch; redaction tests. | Read-only SSM binding; production profile |
| R05 | critical | Crash/retry or concurrent workers duplicate fee/product dispatch. | Transactional unique attempt and idempotency rows; outbox leasing/fencing; compare-and-set states; crash at every boundary; duplicate worker tests. | Durable order and dispatch rows |
| R06 | critical | Timeout/unknown response is treated as failure and automatically resubmitted, producing duplicate payment. | Stable `SETTLEMENT_UNKNOWN`; no automatic resubmit; lookup/reconciliation by original fingerprint; operator action only after structured terminal evidence. | Durable order; finality/reconciliation |
| R07 | critical | Product leg dispatches when fee is rejected, unknown, stale, or belongs to another pair. | Pair hash and fingerprint binding; durable fee gate; product dispatch only from an allowed committed fee state; wrong-pair and partial-state tests. | Durable order; facilitator profile |
| R08 | high | Quote expiry/replay or predictable/colliding identifiers let one client claim another quote or order. | Unpredictable unique IDs; transactional quote claim; expiry at the boundary instant; scoped idempotency; same-time/concurrency and replay tests. | Service/API; PostgreSQL model |
| R09 | high | Stale or malicious RPC reports false finality; a reorg invalidates a delivered payment. | Pinned chain/profile; canonical block hash/height observations; minimum confirmation policy; reorg rollback before delivery; independent readback and stale-node tests. | Finality watcher; production profile |
| R10 | high | Receipt fields are attacker-rehashed and accepted as issuer-authentic. | Verify against trusted order/payment rows or a server-authenticated proof; bind both legs, licence, artifact, subject, and policy version; forged self-hash test. | Delivery, licence and receipts |
| R11 | high | Entitlement IDOR, token replay, subject swap, expired/revoked access, or object URL leakage exposes paid artifacts. | Subject/order/digest binding; short-lived single-purpose grant; no public bucket; deny expired/revoked/wrong-subject/range abuse; audit download. | Delivery; Service/API |
| R12 | high | Scanner/web confused deputy: scanner can alter catalogue, API can promote unscanned objects, or either can read both buckets broadly. | Separate identities and DB roles; prefix/action IAM; scanner writes evidence only; promotion service verifies evidence; IAM negative tests. | PostgreSQL model; upload/scan; Option 3 |
| R13 | high | Fee and product revenue are commingled or reconciled as one amount, hiding partial settlement and accounting errors. | Separate immutable legs, recipients, fingerprints, transaction IDs, ledgers, and reconciliation; total is presentation only; partial-leg reports. | Durable order; reconciliation; receipts |
| R14 | high | OIDC subject/environment bypass or pull-request-controlled workflow obtains registry/deploy capability. | `makings-production` environment, principal review, exact repo/environment subject, minimal role, base-controlled workflow, immutable digest, wrong-subject tests. | Build/ship workflow |
| R15 | high | Competing or confused deploy path modifies AgentFolio/HQ box, wrong target group, database, bucket, or environment. | One reviewed Option 3 path; separate state/resources/routes; target and account assertions; value-free preflight; rollback to prior image digest. | Build/ship; Option 3 readiness |
| R16 | high | Recovery replays an outbox or loses idempotency/settlement evidence, duplicating payment or delivery. | Restore DB and object evidence together; dispatch disabled; reconcile every nonterminal attempt before workers start; isolated PITR and replay tests. | Recovery/monitoring; durable order |
| R17 | high | Dependency, action, base image, package, or build runner compromise alters service or artifact. | Lockfiles; pinned action/image digests; SBOM/provenance; reproducible build; vulnerability policy; artifact signature/attestation verification. | Container images; build/ship |
| R18 | high | Operator selects Base mainnet, enables dispatch, changes recipient paths, or bypasses a principal gate in staging. | Environment-typed immutable config; production-only profile behind protected gate; dispatch-disabled default; four-eyes value-free readback; rollback. | Production profile; Option 3; launch gate |
| R19 | medium | Oversized requests, catalogue scraping, quote/order floods, scan starvation, range abuse, or expensive reconciliation causes denial of service. | Endpoint and tenant quotas; streaming limits; bounded queues; backpressure; circuit breakers; cost alarms; deterministic 429/503 behavior. | Service/API; upload/scan; monitoring |
| R20 | medium | Logs, metrics, traces, errors, receipts, crash dumps, or support exports leak recipients, authorizations, signed URLs, upload content, or personal data. | Allowlisted structured events; field-level redaction; no body/env dumps; 30-day log retention; canary-secret and recipient-value negative scans. | Every packet; log-retention; Privacy |
| R21 | medium | Licence or legal version is changed after purchase, omitted from entitlement, or not reproducible. | Immutable approved version IDs and content digests; visible pre-purchase binding; receipt/entitlement linkage; historical retrieval tests. | Catalogue; delivery/licence; Terms |
| R22 | medium | Backup is present but unreadable, cross-environment, incomplete, or lacks object/ledger consistency. | Source/target identity; encrypted atomic backup; hash/readability sample; PITR measurement; object manifest; wrong-target failure fixture. | Recovery and monitoring |

Release posture: **R01–R18 are release-blocking until their owner packet supplies the stated
negative tests at an immutable reviewed head.** R19–R22 require measured controls or an explicit
principal decision only where the residual is business risk; engineering defects are not
approval candidates.

## 6. Required control map for later packets

| Packet | Mandatory security output before its review can PASS |
| --- | --- |
| Service/API baseline | route/auth matrix; body/header/identifier limits; unique quote/order IDs; idempotency scope; negative route, collision, expiry, and subject tests |
| Pinned catalogue | immutable schema and canonical encoding; no mutable latest order path; licence/artifact/price/network binding; cache invalidation tests |
| PostgreSQL model | constraints for unique claims and append-only evidence; separate roles; migration rollback/recovery notes; cross-tenant denial tests |
| Durable order/dispatch | transactional outbox; fencing and attempt state; crash/restart matrix; original-fingerprint reconciliation; no automatic ambiguous retry |
| Upload/scan | quarantine and promotion state machine; object version/digest binding; isolated scanner; malicious archive corpus; scanner-unavailable failure |
| Finality/reconciliation | canonical observation schema; confirmation/reorg policy; stale/malformed/split RPC tests; structured terminal evidence |
| Delivery/licence/receipts | entitlement authorization; issuer-authentic receipt verification; artifact re-hash; licence/legal version binding; replay and IDOR tests |
| SSM binding | exact parameter-name allowlist and task-role policy; no value output; missing/equal/wrong-path tests; `credential_value_logged=false` |
| Production profile | environment/network/asset/facilitator/limit pin; staging cannot enable mainnet; dispatch-disabled default; wrong-profile tests |
| First-party products | four independently pinned artifacts/licences/prices; revenue-leg separation; no shared mutable bundle; offline fixture purchases |
| Container images | non-root/read-only controls; no scanner network; SBOM/provenance; pinned base; critical/high vulnerability disposition |
| Build/ship workflow | exact OIDC subject and protected environment; base-controlled workflow; immutable digest deploy; wrong branch/repo/environment denial |
| Option 3 readiness | account/region/state/target assertions; least privilege; private DB/buckets; backup/rollback; cost and exposure alarms |
| Recovery/monitoring | dispatch-disabled restore; PITR/object/outbox reconciliation; RPO/RTO measurement; value-free alerts; 30-day logs |

## 7. Adversarial QA map

Every case must name the immutable service head, fixture version, expected code/state, observed
code/state, and evidence location. A timeout in the test harness is not a product PASS.

### Catalogue, quote, and order

| QA | Risks | Adversarial case | Required result |
| --- | --- | --- | --- |
| Q01 | R01 | Change price, digest, licence, network, asset, facilitator, or recipient after quote. | Stored quote/order remains byte-for-byte pinned; mutation is rejected and audited. |
| Q02 | R01,R08 | Replace explicit version with `latest`, deleted, unavailable, or unknown version. | No silent fallback; deterministic 404/409 and no order. |
| Q03 | R08 | Create two identical quotes in one timestamp tick and concurrently claim them. | Unique quote IDs and independent order claims; no overwrite or cross-client 409. |
| Q04 | R08 | Replay idempotency key with different body, subject, path, or quote. | 409 conflict; original response unchanged; no second effect. |
| Q05 | R08 | Submit exactly at, just before, and just after expiry. | One documented boundary; expired path never verifies or dispatches. |
| Q06 | R19 | Huge identifiers, deep JSON, duplicate keys, malformed percent/UTF-8, header flood. | Bounded 4xx; no crash, expensive parse, log injection, or partial row. |

### Upload, scan, and artifact promotion

| QA | Risks | Adversarial case | Required result |
| --- | --- | --- | --- |
| Q07 | R02 | Zip/tar bomb, nested archive, huge file count, sparse file, compression-ratio bomb. | Scanner terminates within limits; quarantine retained; no promotion. |
| Q08 | R02 | Symlink/hardlink/device entry, `../`, absolute path, Unicode-confusable path. | Entry rejected; nothing written outside isolated scratch space. |
| Q09 | R02,R20 | Executable/polyglot/MIME mismatch and parser-crash corpus. | No execution/network; explicit failed evidence; content absent from logs. |
| Q10 | R03 | Swap or mutate object after scan; lie about size/digest/type/version. | Conditional promotion fails; no catalogue version points to bytes. |
| Q11 | R12 | Scanner tries catalogue write or API tries direct artifact promotion. | IAM/DB deny with value-free audit event. |
| Q12 | R02,R19 | Scanner unavailable, timeout, queue flood, repeated poison object. | Backpressure and terminal/quarantined state; no fail-open retry storm. |

### Two-exchange payment and finality

| QA | Risks | Adversarial case | Required result |
| --- | --- | --- | --- |
| Q13 | R04,R07 | Wrong/equal/self recipient, wrong asset/network/facilitator, cross-pair terms. | Rejected before external dispatch; no recipient value logged. |
| Q14 | R05 | Crash before/after reserving and before/after each external call/response/commit. | One durable attempt per leg; restart never duplicates dispatch. |
| Q15 | R06 | Timeout/5xx/disconnect after facilitator may have accepted a leg. | Stable unknown; no automatic resubmit; reconcile original fingerprint only. |
| Q16 | R07,R13 | Fee rejected/unknown/final while product is queued; product called first. | Product remains blocked except the one documented committed fee state. |
| Q17 | R05,R06 | Two workers lease same outbox row; lease expires mid-call; stale worker returns. | Fencing rejects stale commit; one effect; evidence retained. |
| Q18 | R09 | Stale RPC, malformed height/time, split providers, delayed observation, reorg. | No premature finality/delivery; canonical state rolls back or freezes safely. |
| Q19 | R06,R09 | Reconciliation says terminal but evidence predates unknown or names another fingerprint. | Rejection evidence refused; unknown remains. |
| Q20 | R18 | Staging process receives mainnet chain/profile or production path names. | Boot/dispatch fails closed before any external call. |

### Delivery, receipt, licence, and abuse

| QA | Risks | Adversarial case | Required result |
| --- | --- | --- | --- |
| Q21 | R10 | Alter receipt then recompute its public hash. | Standalone forged receipt is not issuer-authentic; trusted-state/signature check fails. |
| Q22 | R10,R13 | Swap fee/product transaction, pair hash, fingerprint, order, artifact, or finality proof. | Verification fails; no entitlement/download. |
| Q23 | R11 | Wrong subject/order, guessed entitlement, replayed grant, expired/revoked grant. | 401/403 without existence oracle; audited; artifact not read. |
| Q24 | R03,R11 | Object bytes differ from pinned digest/size at download. | Fail closed, quarantine alert, no partial success response. |
| Q25 | R19 | Parallel range/download flood and disconnect/retry abuse. | Quotas and bounded work; integrity headers remain correct. |
| Q26 | R21 | Replace licence/Terms/Privacy after purchase or omit historical version. | Original approved versions remain retrievable and receipt-bound. |

### SSM, IAM, OIDC, runtime, and recovery

| QA | Risks | Adversarial case | Required result |
| --- | --- | --- | --- |
| Q27 | R04,R20 | Missing, equal, malformed, wrong-prefix, or access-denied SSM parameter. | Value-free boot failure; no SDK response/body/address in logs. |
| Q28 | R04,R12 | Task role requests any parameter except the two environment-approved names. | IAM deny; no wildcard read/decrypt/list capability. |
| Q29 | R14 | OIDC from fork, pull request, branch, tag, other repo, or unreviewed environment. | Assume-role denied; no registry/deploy action. |
| Q30 | R14,R17 | PR changes workflow/action/image tag or attempts credential persistence. | Base/protected workflow and pinned digests prevail; token short-lived and scoped. |
| Q31 | R15 | Deploy points to AgentFolio/HQ box, wrong target group/state/account/region. | Preflight fails before mutation; one Option 3 route only. |
| Q32 | R16 | Restore at every dispatch state, including unknown and leased rows. | Workers remain disabled until reconciliation; no duplicate settlement/delivery. |
| Q33 | R22 | Missing/corrupt/wrong-environment DB backup or object manifest. | Restore fails isolated; no publication; alert names metadata only. |
| Q34 | R20 | Canary recipient-like value, authorization, signed URL, or upload secret reaches each error path. | Secret scan finds zero persisted/logged values; raw value never printed. |
| Q35 | R19 | Queue, DB, S3, RPC, facilitator, or scanner degradation. | Bounded 429/503/unknown states; no cascading retry or silent data loss. |
| Q36 | R18 | Operator attempts enable/deploy without principal approval evidence. | Gate refuses; merge/green CI cannot substitute for approval. |

## 8. Recovery and incident rules

1. **Freeze dispatch first.** On payment ambiguity, recipient/config drift, restore, suspected
   compromise, or finality inconsistency, stop new dispatch and delivery without deleting rows.
2. **Preserve originals.** Keep request fingerprints, authorizations, external IDs, observations,
   object versions, scan evidence, and append-only history. Never “repair” by overwriting the
   evidence that explains an unknown state.
3. **Reconcile before retry.** Query the original external identity and compare immutable terms.
   A retry is allowed only after structured evidence proves the original cannot settle and the
   state machine authorizes a new attempt.
4. **Restore isolated.** Validate source/target, hashes, schema, object manifest, and readability;
   measure RPO/RTO; keep workers and public routes disabled.
5. **Resume narrowly.** Re-enable read paths, then delivery, then new payment dispatch only after
   nonterminal rows are reconciled and the principal-controlled gates remain valid.
6. **Do not rotate or disclose by default.** A suspected credential leak is sev1 and requires
   escalation; this packet does not authorize credential access or rotation.

## 9. Release security gate

A release candidate is security-reviewable only when:

- every R01–R18 row has immutable closure evidence and its QA cases pass at the candidate head;
- current-head Mode 2 review is author-distinct and formal;
- CI, SBOM/provenance, image scans, staging adversarial QA, backup restore, and rollback evidence
  are complete;
- Option 3 cost and target readback remain within the principal-approved boundary;
- SSM checks report only value-free presence/distinctness/match outcomes;
- zero release-blocking findings remain;
- Terms, Privacy, product/licence, spend, production, public launch, recipient, and real-payment
  gates are separately approved by the principal where required.

Security PASS does not authorize merge, deploy, spend, launch, signing, or payment. A failed
engineering invariant cannot be converted into an accepted residual business risk.

## 10. Reproducibility commands for this packet

Run from a clean checkout of the evidence pin or this document's PR head:

```bash
git diff --check origin/main...HEAD
cd shops
npm test
npm run check:boundary
```

Reviewers should additionally verify that only this document changed, that it contains no
wallet/address-like value or credential, and that every risk ID is represented by at least one
QA case and one later owner packet.
