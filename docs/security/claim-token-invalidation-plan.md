# One-time claim-token invalidation proposal

Status: proposal only. Do not run from this PR or from a developer workstation.

## Why invalidation is required

Source review shows that a valid claim token is a bearer capability for an unclaimed profile. `GET /claim/:id` accepts it in the query string and `POST /api/claim/:id` accepts it in the JSON body. The wallet branch currently records a caller-supplied wallet without verifying the supplied signature, while the GitHub branch compares only a caller-supplied username to the stored link. A successful claim marks the profile claimed, records the claimant, clears the token, and can update the profile wallet. Later general profile edits require the existing API key or a signed wallet challenge; the claim token itself is not accepted by `PATCH /api/profile/:id`.

Because tokens were included in public profile serializers, every token for an unclaimed profile must be treated as compromised even after serializers stop returning it.

## Preconditions

1. Merge and deploy the serializer fix first.
2. Verify that both `GET /api/profiles` and `GET /api/profile/:id` omit all claim/API capability keys without logging any values.
3. Pause outbound claim-link distribution for the migration window.
4. Take the standard restricted production database backup and record only its path, size, checksum, and permissions in the operator receipt.

## Proposed one-time transaction

Run on the production host through the existing controlled migration lane, not through an HTTP route:

```sql
BEGIN IMMEDIATE;
UPDATE profiles
SET claim_token = lower(hex(randomblob(24)))
WHERE (claimed = 0 OR claimed IS NULL)
  AND claim_token IS NOT NULL;
COMMIT;
```

Afterward, report only the affected-row count. Never print, export, or log token values. Reissue claim links solely through the existing admin-authenticated claim-link workflow.

## Verification

- Confirm every unclaimed row has a non-empty token using counts only.
- Confirm claimed rows still have a null token using counts only.
- Confirm the two public profile endpoints omit `claim_token`, `claimToken`, `claim_code`, `claimCode`, `api_key`, and `apiKey`.
- Confirm an old distributed link is rejected only with a controlled, non-production fixture or an approved operator-owned test profile; do not replay scraped/live token values.

## Rollback

The safe rollback is operational, not restoration of compromised tokens:

1. Stop claim-link distribution and temporarily disable the claim endpoints through the established production configuration/change lane.
2. Restore the restricted pre-migration database backup only if the rotation caused data corruption or availability loss.
3. Before re-enabling claims, rerun the rotation transaction so no previously exposed token is reinstated, then repeat the key-absence and count-only checks.

Never treat restoration of the old token set as a completed rollback; those values remain compromised.
