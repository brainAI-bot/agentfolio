const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTrustScore } = require('../src/lib/compute-trust-score');
const {
  checkBoaEligibilityFromTrust,
  getReviewWeightForTrustScore,
} = require('../src/lib/trust-score-gates');
const { computeUnifiedTrustScore } = require('../src/lib/unified-trust-score');
const { calculateTier } = require('../src/lib/performance-fees');

test('trust score ignores profile-body, social, and generic completion claims', () => {
  const result = computeTrustScore({
    profile: {
      bio: 'A very complete and impressive profile body that should not grant trust by itself.',
      avatar: 'https://example.com/avatar.png',
      skills: ['one', 'two', 'three'],
      verificationData: {
        x: { verified: true, handle: '@gameable' },
        discord: { verified: true, handle: 'gameable' },
      },
    },
    endorsementsGiven: 12,
    endorsementsReceived: [{ endorserLevel: 5 }],
    jobsPosted: 3,
    escrowsCompletedAsWorker: 10,
    escrowsCompletedAsPoster: 10,
    reviewsReceived: [{ rating: 5 }],
    tenure: { daysActive: 365, referralsReachedL2: 4 },
  });

  assert.equal(result.trustScore, 0);
  assert.deepEqual(result.breakdown, {
    canonicalVerifications: 0,
    satpEvidence: 0,
    releasedEscrowEvidence: 0,
    signedReviewEvidence: 0,
  });
});

test('trust score counts only canonical verifications and signed/released evidence', () => {
  const result = computeTrustScore({
    verifications: [
      { platform: 'solana', verified: true, txSignature: 'sol-tx' },
      { platform: 'github', verified: true },
      { platform: 'x', verified: true },
      { platform: 'satp', verified: true, txSignature: 'satp-tx' },
    ],
    hasSatpIdentity: true,
    activity: {
      releasedEscrows: [
        { status: 'released', releaseTxHash: 'release-tx', escrowPda: 'escrow-pda' },
        { status: 'released' },
      ],
      reviewsReceived: [
        { rating: 5, memoTx: 'memo-tx' },
        { rating: 5 },
      ],
    },
  });

  assert.equal(result.breakdown.canonicalVerifications, 240);
  assert.equal(result.breakdown.satpEvidence, 120);
  assert.equal(result.breakdown.releasedEscrowEvidence, 40);
  assert.equal(result.breakdown.signedReviewEvidence, 20);
  assert.equal(result.trustScore, 420);
});

test('unified trust score feeds persisted canonical verifications into shared trust calculator', () => {
  const db = {
    prepare(sql) {
      return {
        all(...params) {
          if (sql.includes('FROM verifications')) {
            assert.equal(params[0], 'agent-1');
            return [
              { platform: 'solana', identifier: 'wallet', proof: '{"txSignature":"sol-tx"}', verified_at: '2026-07-08T00:00:00Z' },
              { platform: 'github', identifier: 'octo', proof: '{}', verified_at: '2026-07-08T00:00:00Z' },
              { platform: 'x', identifier: 'gameable', proof: '{}', verified_at: '2026-07-08T00:00:00Z' },
            ];
          }
          return [];
        },
        get() {
          return { c: 0 };
        },
      };
    },
  };

  const result = computeUnifiedTrustScore(db, {
    id: 'agent-1',
    bio: 'A sufficiently complete profile for level checks, but not score credit.',
    avatar: 'https://example.com/a.png',
    skills: JSON.stringify(['one', 'two', 'three']),
  });

  assert.equal(result.breakdown.canonicalVerifications, 240);
  assert.equal(result.trustScore, 240);
});

test('generic on-chain attestation counts do not masquerade as SATP evidence', () => {
  const result = computeTrustScore({
    onchain: { onchainAttestationsReceived: 5 },
  });

  assert.equal(result.breakdown.satpEvidence, 0);
  assert.equal(result.trustScore, 0);
});

test('unified trust score does not use legacy V3 reputation as a score floor', () => {
  const db = {
    prepare() {
      return {
        all() {
          return [];
        },
        get() {
          return { c: 0 };
        },
      };
    },
  };

  const result = computeUnifiedTrustScore(
    db,
    { id: 'agent-legacy-v3' },
    { v3Score: { reputationScore: 9000, verificationLevel: 5 } }
  );

  assert.equal(result.trustScore, 0);
  assert.equal(result.trustBreakdown.v3.normalizedDisplayScore, 9000);
  assert.equal(result.source, 'verifiable-trust-score');
});

test('fee, BOA, and review gates consume shared trust score thresholds', () => {
  assert.equal(calculateTier({ completedJobs: 100, completionRate: 1, trustScore: 0 }), 1);
  assert.equal(calculateTier({ completedJobs: 100, completionRate: 1, trustScore: 400 }), 3);
  assert.equal(calculateTier({ completedJobs: 100, completionRate: 1, trustScore: 560 }), 4);

  assert.deepEqual(checkBoaEligibilityFromTrust({ verificationLevel: 3, trustScore: 49 }), {
    eligible: false,
    reason: 'Trust Score 49 insufficient (need 50+)',
    level: 3,
    trustScore: 49,
  });
  assert.deepEqual(checkBoaEligibilityFromTrust({ verificationLevel: 3, trustScore: 50 }), {
    eligible: true,
    level: 3,
    trustScore: 50,
  });

  assert.equal(getReviewWeightForTrustScore(0), 1);
  assert.equal(getReviewWeightForTrustScore(320), 2);
  assert.equal(getReviewWeightForTrustScore(560), 3);
});
