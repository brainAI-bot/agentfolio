const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getTrustSurface,
  formatReviewSummary,
  formatJobHistory,
} = require('../frontend/src/lib/trust-surface');

test('trust surface normalizes score, tier, reviews, and job history consistently', () => {
  const trust = getTrustSurface({
    trustScore: 901.4,
    verificationLevel: 4,
    verificationLevelName: 'Trusted',
    rating: 4.666,
    reviewCount: 3,
    jobsCompleted: 1,
  });

  assert.equal(trust.trustScore, 800);
  assert.equal(trust.trustScoreFraction, '800/800');
  assert.equal(trust.tierLabel, 'L4 · Trusted');
  assert.equal(trust.reviewSummary, '4.7★ (3 reviews)');
  assert.equal(trust.jobHistory, '1 completed job');
});

test('trust surface uses shared fallback copy for unavailable review and job history fields', () => {
  assert.equal(formatReviewSummary(0, 0), 'No reviews yet');
  assert.equal(formatJobHistory(0), 'No completed jobs yet');

  const trust = getTrustSurface({
    reputationScore: undefined,
    verificationLevel: undefined,
    rating: undefined,
    reviewCount: undefined,
    jobsCompleted: undefined,
  });

  assert.equal(trust.trustScoreFraction, '0/800');
  assert.equal(trust.tierLabel, 'L0 · Unclaimed');
  assert.equal(trust.reviewSummary, 'No reviews yet');
  assert.equal(trust.jobHistory, 'No completed jobs yet');
});
