const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  buildReputationSurface,
  loadReviewSummary,
  summarizeJobHistory,
  summarizeReviews,
} = require('../src/lib/reputation-surface');

function createCanonicalReviewDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE reviews (id TEXT, job_id TEXT, reviewer_id TEXT, reviewee_id TEXT, rating INTEGER);
    CREATE TABLE peer_reviews (id TEXT, job_id TEXT, reviewer_id TEXT, reviewee_id TEXT, rating INTEGER);
    CREATE TABLE escrows (id TEXT, job_id TEXT, client_id TEXT, agent_id TEXT, status TEXT, release_tx_hash TEXT);
  `);
  return db;
}

test('buildReputationSurface normalizes score, tier, reviews, and job history', () => {
  const surface = buildReputationSurface({
    profile: { id: 'agent_alpha' },
    unified: {
      score: 456,
      level: 'TRUSTED',
      levelName: 'Trusted',
      source: 'unit-test',
      breakdown: { verifications: 4 },
    },
    reviewSummary: { total: 3, avg_rating: 4.666 },
    jobHistory: { completed_jobs: 2, posted_jobs: 1 },
  });

  assert.equal(surface.score, 456);
  assert.equal(surface.trustScore, 456);
  assert.equal(surface.reputationScore, 456);
  assert.equal(surface.level, 4);
  assert.equal(surface.verificationLevel, 4);
  assert.equal(surface.tier, 'Trusted');
  assert.equal(surface.reviewCount, 3);
  assert.equal(surface.reviewAvg, 4.67);
  assert.equal(surface.reviewSummary.label, '4.7 average from 3 reviews');
  assert.equal(surface.completedJobs, 2);
  assert.equal(surface.jobsCompleted, 2);
  assert.equal(surface.jobHistory.label, '2 completed jobs / 1 posted job');
});

test('buildReputationSurface returns consistent unavailable-field fallbacks', () => {
  const surface = buildReputationSurface({ profile: { id: 'agent_empty' } });

  assert.equal(surface.score, 0);
  assert.equal(surface.trustScore, 0);
  assert.equal(surface.level, 0);
  assert.equal(surface.tier, 'Unverified');
  assert.deepEqual(surface.reviewSummary, summarizeReviews());
  assert.deepEqual(surface.jobHistory, summarizeJobHistory());
  assert.equal(surface.reviewSummary.label, 'No reviews yet');
  assert.equal(surface.jobHistory.label, 'No jobs yet');
});

test('buildReputationSurface uses V3 reputation when supplied separately', () => {
  const surface = buildReputationSurface({
    profile: { id: 'agent_v3' },
    unified: { score: 120, level: 1, levelName: 'Registered' },
    v3Score: {
      reputationScore: 640,
      verificationLevel: 5,
      verificationLabel: 'Sovereign',
      isBorn: true,
    },
  });

  assert.equal(surface.score, 640);
  assert.equal(surface.trustScore, 640);
  assert.equal(surface.verificationLevel, 5);
  assert.equal(surface.tier, 'Sovereign');
  assert.equal(surface.source, 'v3-onchain');
  assert.equal(surface.isBorn, true);
});

test('loadReviewSummary keeps an evaluated canonical zero instead of legacy fallback counts', () => {
  const db = createCanonicalReviewDb();
  const summary = loadReviewSummary(db, 'agent_empty', { total: 9, avg_rating: 5 });
  assert.equal(summary.count, 0);
  assert.equal(summary.averageRating, 0);
  db.close();
});

test('loadReviewSummary uses fallback only when canonical evidence cannot be evaluated', () => {
  const db = new Database(':memory:');
  const originalError = console.error;
  console.error = () => {};
  try {
    const summary = loadReviewSummary(db, 'agent_unknown', { total: 2, avg_rating: 4.5 });
    assert.equal(summary.count, 2);
    assert.equal(summary.averageRating, 4.5);
  } finally {
    console.error = originalError;
    db.close();
  }
});
