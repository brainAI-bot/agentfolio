const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  listCanonicalJobReviews,
  listCanonicalPeerReviews,
  summarizeCanonicalReviews,
} = require('../src/lib/canonical-review-evidence');
const { computeUnifiedTrustScore } = require('../src/lib/unified-trust-score');
const { migrate } = require('../scripts/migrate-canonical-review-trust');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      wallets TEXT DEFAULT '{}',
      verification_data TEXT DEFAULT '{}'
    );
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      reviewer_id TEXT,
      reviewee_id TEXT,
      rating INTEGER,
      tx_signature TEXT
    );
    CREATE TABLE peer_reviews (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      reviewer_id TEXT,
      reviewee_id TEXT,
      rating INTEGER,
      verified INTEGER DEFAULT 0,
      signature TEXT,
      memo_tx TEXT,
      reviewer_wallet TEXT,
      chain TEXT,
      created_at TEXT
    );
    CREATE TABLE escrows (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      client_id TEXT,
      agent_id TEXT,
      status TEXT,
      release_tx_hash TEXT,
      released_at TEXT
    );
    CREATE TABLE verifications (profile_id TEXT, platform TEXT, identifier TEXT, proof TEXT, verified_at TEXT);
    CREATE TABLE endorsements (profile_id TEXT, endorser_id TEXT);
    CREATE TABLE jobs (id TEXT, client_id TEXT, selected_agent_id TEXT, status TEXT);
    CREATE TABLE attestations (profile_id TEXT, platform TEXT, tx_signature TEXT);
  `);
  db.prepare('INSERT INTO profiles (id, wallets) VALUES (?, ?)').run(
    'client-1',
    JSON.stringify({ solana: 'client-wallet' })
  );
  db.prepare('INSERT INTO profiles (id, wallets) VALUES (?, ?)').run(
    'agent-1',
    JSON.stringify({ solana: 'agent-wallet' })
  );
  return db;
}

function insertReleasedEscrow(db, { id = 'escrow-1', jobId = 'job-1', releaseTx = 'release-tx' } = {}) {
  db.prepare(`
    INSERT INTO escrows (id, job_id, client_id, agent_id, status, release_tx_hash, released_at)
    VALUES (?, ?, 'client-1', 'agent-1', 'released', ?, '2026-08-30T00:00:00Z')
  `).run(id, jobId, releaseTx);
}

test('canonical aggregates exclude unlinked, unreleased, and participant-mismatched reviews', () => {
  const db = createDb();
  insertReleasedEscrow(db);
  db.exec(`
    INSERT INTO reviews VALUES ('canonical-job', 'job-1', 'client-1', 'agent-1', 5, NULL);
    INSERT INTO reviews VALUES ('unlinked-signed', 'missing-job', 'client-1', 'agent-1', 5, 'tx-only');
    INSERT INTO reviews VALUES ('wrong-participant', 'job-1', 'stranger', 'agent-1', 5, NULL);
    INSERT INTO escrows VALUES ('escrow-2', 'job-2', 'client-1', 'agent-1', 'funded', NULL, NULL);
    INSERT INTO reviews VALUES ('unreleased', 'job-2', 'client-1', 'agent-1', 5, NULL);
  `);

  const reviews = listCanonicalJobReviews(db, { revieweeId: 'agent-1' });
  assert.deepEqual(reviews.map((review) => review.id), ['canonical-job']);
  assert.equal(summarizeCanonicalReviews(db, { revieweeId: 'agent-1' }).count, 1);
  db.close();
});

test('signed peer evidence requires released escrow, verified signature, and bound reviewer wallet', () => {
  const db = createDb();
  insertReleasedEscrow(db);
  const insert = db.prepare(`
    INSERT INTO peer_reviews
      (id, job_id, reviewer_id, reviewee_id, rating, verified, signature, memo_tx, reviewer_wallet, chain, created_at)
    VALUES (?, ?, ?, 'agent-1', 5, ?, ?, ?, ?, 'solana', '2026-08-30T00:00:00Z')
  `);
  insert.run('canonical-peer', 'job-1', 'client-1', 1, 'sig', 'memo', 'client-wallet');
  insert.run('wallet-mismatch', 'job-1', 'client-1', 1, 'sig', 'memo', 'attacker-wallet');
  insert.run('signature-missing', 'job-1', 'client-1', 1, '', 'memo-only', 'client-wallet');
  insert.run('escrow-missing', 'job-x', 'client-1', 1, 'sig', 'memo', 'client-wallet');

  const reviews = listCanonicalPeerReviews(db, { revieweeId: 'agent-1' });
  assert.deepEqual(reviews.map((review) => review.id), ['canonical-peer']);
  assert.equal(reviews[0].canonicalReleasedEscrowReview, true);
  assert.equal(reviews[0].reviewerIdentityBound, true);
  assert.equal(reviews[0].signatureVerified, true);

  const unified = computeUnifiedTrustScore(db, { id: 'agent-1' });
  assert.equal(unified.breakdown.signedReviewEvidence, 20);
  assert.equal(unified.trustBreakdown.signedReviewEvidence.evidenceCount, 1);
  db.close();
});

test('migration quarantines five unproven rows and records exact reasons', () => {
  const db = createDb();
  insertReleasedEscrow(db);
  db.exec(`
    INSERT INTO reviews VALUES ('canonical', 'job-1', 'client-1', 'agent-1', 5, NULL);
    INSERT INTO reviews VALUES ('q1', 'missing-1', 'client-1', 'agent-1', 5, 'tx-1');
    INSERT INTO reviews VALUES ('q2', 'missing-2', 'client-1', 'agent-1', 4, NULL);
    INSERT INTO reviews VALUES ('q3', 'job-1', 'stranger', 'agent-1', 5, NULL);
    INSERT INTO peer_reviews VALUES ('q4', 'job-1', 'client-1', 'agent-1', 5, 1, 'sig', 'memo', 'wrong-wallet', 'solana', '2026-08-30');
    INSERT INTO peer_reviews VALUES ('q5', 'job-1', 'client-1', 'agent-1', 5, 0, '', 'memo', 'client-wallet', 'solana', '2026-08-30');
  `);

  const result = migrate(db);
  assert.equal(result.eligible, 1);
  assert.equal(result.quarantined, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM reviews WHERE trust_status = 'quarantined'").get().c, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM peer_reviews WHERE trust_status = 'quarantined'").get().c, 2);
  assert.equal(
    db.prepare("SELECT trust_quarantine_reason FROM peer_reviews WHERE id = 'q4'").get().trust_quarantine_reason,
    'reviewer_wallet_not_bound_to_identity'
  );
  db.close();
});
