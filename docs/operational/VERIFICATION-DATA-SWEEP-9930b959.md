# Verification data sweep evidence [#9930b959]

## Scope

This records the current write-mode cleanup sweep for roadmap shell `ROADMAP-AGENTFOLIO-9930b959-20260803-0815`.

The sweep uses `scripts/cleanup-retired-trust-providers.js` against the deployed public AgentFolio read surface at `https://agentfolio.bot`. It does not change `ROADMAP.md`.

## Commands

```bash
NODE_PATH=/Users/brainforge/agentfolio/node_modules node --test tests/verification-provider-cleanup.test.js
NODE_PATH=/Users/brainforge/agentfolio/node_modules node scripts/cleanup-retired-trust-providers.js --write --deployed-base-url=https://agentfolio.bot
```

## Results

Focused cleanup tests passed:

```text
tests 13
pass 13
fail 0
duration_ms 157.174042
```

The deployed write-mode sweep completed the public profile and attestation readback:

```json
{
  "mode": "write",
  "canonicalTrustProviders": ["solana", "github", "domain", "website"],
  "sqliteVerificationRowsRemoved": 0,
  "sqliteAttestationRowsRemoved": 0,
  "sqliteProfilesUpdated": 0,
  "sqliteProfilesRescored": 0,
  "jsonProfilesUpdated": 0,
  "jsonProfilesRescored": 0,
  "deployedDetectionRan": true,
  "deployedDetectionComplete": true,
  "deployedVerifiedClean": false,
  "deployedDetectionSource": "public-api-chain-cache",
  "deployedBaseUrl": "https://agentfolio.bot",
  "deployedProfilesTotal": 38,
  "deployedProfilesDiscovered": 38,
  "deployedProfilesCovered": 38,
  "deployedProfilePagesFetched": 1,
  "deployedProfilesTruncated": false,
  "deployedAttestationRowsDetected": 9,
  "deployedAttestationMatches": [],
  "deployedAttestationErrors": [],
  "deployedAttestationEmptyAgentsCount": 35
}
```

## Readback blocker

The cleanup target is clean for retired/non-verifying providers in the public chain-cache rows that were returned:

- `deployedAttestationMatches`: `[]`
- `deployedAttestationErrors`: `[]`
- profile coverage: `38/38`

The sweep cannot mark the deployed readback as fully clean yet because 35 covered profiles return empty by-agent attestation arrays. Several of those profiles still expose verification evidence in the public profile payload, so the script reports `profile_has_verification_evidence_but_chain_cache_returned_empty` anomalies instead of treating the readback as clean.

The exact remaining blocker is the deployed public chain-cache read surface, not the retired-provider cleanup matcher: `/api/satp/attestations/by-agent/:agentId` must return canonical attestation rows for profiles that still expose verification evidence, or the profile payload must stop exposing verification evidence for profiles with no chain-cache rows.
