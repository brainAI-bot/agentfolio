# Marketplace application v2 migration

Marketplace applications are JSON records, so this slice uses an additive, dual-write migration instead of an in-place rewrite.

New records write the specification fields `agentId`, `coverMessage`, `proposedBudget`, `proposedTimeline`, and `portfolioItems`. They also retain the legacy aliases `applicantId`, `proposal`, and `bidAmount` while the current frontend and stored records coexist.

Reads remain compatible with legacy records. The UI falls back from `coverMessage` to `proposal` and from `proposedBudget` to `bidAmount`. A missing legacy timeline is shown as absent; it is not invented as evidence.

The write path fails closed when a list contains a malformed application identifier, the signed wallet challenge does not match the applicant's SATP authority, a transition is not `pending -> withdrawn`, or a duplicate carries different terms. Identical retry payloads return the original record without creating another file.

Withdrawal authorization state is stored on the job before the application file is marked withdrawn. `applyChallengeRevisions` scopes replay invalidation to the withdrawing applicant, while `withdrawalTombstones` is the durable revocation record used to reconcile an interrupted second write. A retry completes the application transition without advancing the revision again, and accept rejects a tombstoned application even if its application file still says `pending`.

Rollback is code-only: revert the application-v2 change. Existing application files remain readable because the legacy aliases are dual-written. No destructive data migration or rollback script is required.
