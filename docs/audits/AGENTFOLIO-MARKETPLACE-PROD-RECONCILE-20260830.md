# Marketplace production delta reconciliation

HQ task: `AGENTFOLIO-MARKETPLACE-PROD-RECONCILE-20260830`

## Verdict

There is no production-only marketplace delta to forward-port from the locked
production worktree. The locked worktree and `origin/main` resolve to the same
commit and tree, and every tracked marketplace path is byte-identical.

The reported `248` lines are a directionality error from comparing the older
legacy checkout at `/home/ubuntu/agentfolio` with current `origin/main`:
`src/marketplace.js` has 374 additions and 126 deletions on current main, a net
increase of 248 lines. Those lines are repo-side hardening already reviewed and
merged. They are not production-only logic and must not be copied from the
legacy checkout over current main.

No production file, process, deployment, or keypair was changed during this
reconciliation.

## Compared states

| State | Commit | Tree | Result |
| --- | --- | --- | --- |
| Locked production `/home/ubuntu/agentfolio-prod-locked` | `5c81e864c762aa39880eac8c8de555fb75452e43` | `d0ad687687a42055e76ab7cf0028112d1ecb0756` | comparison authority |
| Fetched `origin/main` | `5c81e864c762aa39880eac8c8de555fb75452e43` | `d0ad687687a42055e76ab7cf0028112d1ecb0756` | exact match |
| Legacy checkout `/home/ubuntu/agentfolio` | `19b4657413337d4b62dc49db7cd77eb1734fcd75` | `c62610d8a25d43cddbbe6e1f1435b06059d371fe` | older ancestor; diagnostic only |

The locked worktree had only an unrelated untracked `reports/` directory.
`git diff --stat` was empty, so the exact prod-only tracked hunk inventory is
empty.

## Coupled marketplace file inventory

The two hashes shown for each path were produced independently from the locked
filesystem (`git hash-object <path>`) and its checked-out commit
(`git rev-parse HEAD:<path>`). Matching hashes prove that no tracked marketplace
file contains a worktree-only edit.

| Path | Locked file hash | Locked `HEAD` hash | Classification |
| --- | --- | --- | --- |
| `frontend/src/app/marketplace/job/[id]/page.tsx` | `1a40863ddd27ae2daf4e4da4c1188164da7f2f92` | `1a40863ddd27ae2daf4e4da4c1188164da7f2f92` | identical; no delta |
| `frontend/src/app/marketplace/page.tsx` | `29b5d2e368d9a5f427968d0fc41110f451750ff9` | `29b5d2e368d9a5f427968d0fc41110f451750ff9` | identical; no delta |
| `public/v2/marketplace.html` | `0bc1d4c287467ae2a9c9e0dbc7a042e01174847e` | `0bc1d4c287467ae2a9c9e0dbc7a042e01174847e` | identical; no delta |
| `src/lib/marketplace.js` | `41b23a18605d0376b7d10365badcc88d928d643d` | `41b23a18605d0376b7d10365badcc88d928d643d` | identical; no delta |
| `src/marketplace.js` | `f7e773ce79b2ab40f8ed7bc81551fcaaf915265b` | `f7e773ce79b2ab40f8ed7bc81551fcaaf915265b` | identical; no delta |
| `src/marketplace.js.pre-v3-escrow-wiring` | `22617d1afa5569586a2e38916a3b858529baf19b` | `22617d1afa5569586a2e38916a3b858529baf19b` | identical; no delta |
| `tests/marketplace-surface-regression.test.js` | `64a37b3842b85c24ccf957875d0955151b121f1a` | `64a37b3842b85c24ccf957875d0955151b121f1a` | identical; no delta |
| `tests/marketplace-wallet-challenge.test.js` | `e53881a52e11300dc414c6b4cc6a84f8acb663c7` | `e53881a52e11300dc414c6b4cc6a84f8acb663c7` | identical; no delta |

## Classification of the reported net 248 lines

This section records why the legacy-checkout comparison must not be treated as
a source for forward-porting. The exact diagnostic command is:

```text
git diff --numstat 19b4657413337d4b62dc49db7cd77eb1734fcd75..5c81e864c762aa39880eac8c8de555fb75452e43 -- src/marketplace.js
374  126  src/marketplace.js
```

All hunk ranges below are old-legacy to current-main ranges. Together they
cover every hunk behind the 374/126, net-248 result.

| Current-main hunk ranges | Behavior on current main | Disposition |
| --- | --- | --- |
| `+11..20`, `+24..25`, `+27..34` | Adds rate limiting, Solana signature dependencies, shared reputation/write gates, configurable data directory, SATP program identity, and one shared mutation limiter. | Required hardening already on main; legacy absence is unsafe/obsolete. |
| `+64..77`, `+79..85`, `+88`, `+90..94` | Adds tolerant JSON/signature decoding and Solana-address validation; removes local score/count helpers superseded by shared surfaces. | Required compatibility and validation already on main; old helpers are obsolete. |
| `+98..135`, `+137..222`, `+224..233`, `+236` | Resolves wallet/SATP identity authority, builds deterministic challenges, verifies detached signatures, and emits bounded authentication failures. | Required authorization already on main; unsigned legacy mutations are unsafe. |
| `+257..288`, `+307..309`, `+311`, `+328`, `+332..346`, removal at old `166..170`, `+353..376` | Replaces duplicated reputation calculations with the shared reputation surface and attaches poster/assignee reputation to responses. | Required consistency already on main; duplicated legacy calculations are obsolete. |
| `+385`, `+464`, `+480` | Uses bounded atomic JSON writes and enriches list/detail reads with the shared reputation surface. | Required durability/response parity already on main; direct writes are unsafe. |
| `+527`, `+539..550` | Applies the shared limiter and signed poster authority to application acceptance. | Required authorization already on main; legacy unsigned accept is unsafe. |
| `+584` | Fails closed on legacy custodial escrow funding. | Required gate already on main; legacy custodial funding is unsafe. |
| `+627`, `+635..642` | Applies the shared limiter and signed worker authority to delivery submission. | Required authorization already on main; legacy unsigned delivery is unsafe. |
| `+665..676`, `+682` | Applies the limiter/signature check and fail-closed custodial gate to release. | Required gate already on main; legacy release path is unsafe. |
| `+721..731`, `+737..745`, `+752..754` | Applies limiter/signature/poster ownership checks and fail-closed custodial gating to refunds while retaining the bounded state transition. | Required authorization already on main; legacy unsigned refund is unsafe. |
| `+761`, `+768..781` | Applies limiter/signature/poster ownership checks to completion/release approval. | Required authorization already on main; legacy unsigned approval is unsafe. |
| `+800..803` (replacing old `540..585`) | Removes local JSON review mutation and redirects callers to the signed released-escrow review flow. | Required single write path already on main; legacy review mutation is obsolete/unsafe. |
| `+840`, `+850`, `+852..864`, `+869` | Applies limiter/signature/poster ownership and live-escrow gates to deposit confirmation. | Required gate already on main; legacy confirmation is unsafe. |
| `+876`, `+885..896` | Applies limiter/signature/poster ownership and live-escrow gates to V3 funding records. | Required gate already on main; legacy unsigned funding record is unsafe. |
| `+957..962` | Exports challenge helpers for focused regression coverage. | Required testability already on main. |

For machine-verifiable completeness, these are the exact zero-context hunk
headers classified by the table above:

```text
@@ -10,0 +11,10 @@
@@ -14 +24,2 @@
@@ -15,0 +27,8 @@
@@ -44,0 +64,14 @@
@@ -46,4 +79,7 @@
@@ -52 +88 @@
@@ -54,3 +90,5 @@
@@ -60 +98,38 @@
@@ -62,3 +137,86 @@
@@ -65,0 +224,10 @@
@@ -67,0 +236 @@
@@ -87,0 +257,32 @@
@@ -106,11 +307,3 @@
@@ -118,2 +311 @@
@@ -136,23 +328 @@
@@ -162,3 +332,15 @@
@@ -166,5 +347,0 @@
@@ -175,0 +353,24 @@
@@ -184 +385 @@
@@ -263 +464 @@
@@ -279 +480 @@
@@ -326 +527 @@
@@ -338 +539,12 @@
@@ -371,0 +584 @@
@@ -414 +627 @@
@@ -421,0 +635,8 @@
@@ -444 +665,12 @@
@@ -450 +682 @@
@@ -489 +721,11 @@
@@ -495 +737,9 @@
@@ -502,7 +752,3 @@
@@ -515 +761 @@
@@ -521,0 +768,14 @@
@@ -540,46 +800,4 @@
@@ -622 +840 @@
@@ -632 +850 @@
@@ -633,0 +852,13 @@
@@ -638 +869 @@
@@ -645 +876 @@
@@ -653,0 +885,12 @@
@@ -714 +957,6 @@
```

The coupled diagnostic delta from the older legacy checkout is also repo-side:
`src/lib/marketplace.js` is `+11/-29`,
`tests/marketplace-surface-regression.test.js` is `+2/-2`, and
`tests/marketplace-wallet-challenge.test.js` is a current-main-only 400-line
test file. None is a locked-production-only change.

## Forward action

There is no required production-only code to preserve, so this evidence-only
PR is the clean forward reconciliation artifact. The legacy JSON mutation
module may be changed or retired only by a separate reviewed change; this
inventory does not alter runtime behavior and does not authorize deployment.
