'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { initializeMarketplaceCoreSchema } = require('../src/lib/marketplace-schema');
const { initializeMarketplaceState, transitionJobState } = require('../src/lib/marketplace-state-machine');
const { computeMarketplaceClaimEligibility } = require('../src/lib/marketplace-claim-eligibility');
const { cancelJob, expireJob } = require('../src/routes/marketplace-job-routes');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      handle TEXT,
      verification_data TEXT DEFAULT '{}'
    );
    CREATE TABLE verifications (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      identifier TEXT NOT NULL,
      proof TEXT DEFAULT '{}',
      verified_at TEXT,
      UNIQUE(profile_id, platform)
    );
  `);
  initializeMarketplaceCoreSchema(db);
  initializeMarketplaceState(db);
  return db;
}

function insertJob(db, id, {
  clientId = 'poster', agentId = null, status = 'open', title = 'Production marketplace job',
  description = 'Canonical production outcome', expiresAt = null, escrowId = null, funded = false,
} = {}) {
  db.prepare(`INSERT INTO jobs
    (id, client_id, selected_agent_id, title, description, status, budget_amount,
     budget_amount_minor, budget_currency, escrow_id, escrow_funded, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, '1000000000', 'SOL', ?, ?, ?, ?, ?)`)
    .run(id, clientId, agentId, title, description, status, escrowId, funded ? 1 : 0, expiresAt,
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
}

function insertEscrow(db, id, jobId, agentId, { status = 'funded', releaseTx = null, releasedAt = null } = {}) {
  db.prepare(`INSERT INTO escrows
    (id, job_id, client_id, agent_id, amount, amount_minor, currency, status,
     deposit_confirmed_at, release_tx_hash, released_at, created_at, updated_at)
    VALUES (?, ?, 'poster', ?, 1, '1000000000', 'SOL', ?, ?, ?, ?, ?, ?)`)
    .run(id, jobId, agentId, status, '2026-09-01T00:00:00.000Z', releaseTx, releasedAt,
      '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
}

test('claim eligibility ignores free-form scores and only counts canonical non-fixture outcomes', () => {
  const db = createDb();
  try {
    db.prepare('INSERT INTO profiles (id, name, handle, verification_data) VALUES (?, ?, ?, ?)')
      .run('agent-real', 'Real Agent', 'real-agent', JSON.stringify({
        github: { verified: true }, verificationLevel: 5, trustScore: 800,
      }));

    const forged = computeMarketplaceClaimEligibility(db, 'agent-real');
    assert.equal(forged.eligibleIdentity, false);
    assert.equal(forged.verificationLevel, 0);
    assert.equal(forged.trustScore, 0);

    const addVerification = db.prepare(`INSERT INTO verifications
      (id, profile_id, platform, identifier, proof, verified_at) VALUES (?, 'agent-real', ?, ?, ?, ?)`);
    addVerification.run('v-satp', 'satp', 'satp-record', '{}', '2026-09-02T00:00:00.000Z');
    addVerification.run('v-github', 'github', 'real-agent', '{}', '2026-09-02T00:00:00.000Z');
    addVerification.run('v-solana', 'solana', 'wallet-real', '{}', '2026-09-02T00:00:00.000Z');
    addVerification.run('v-unverified-domain', 'domain', 'forged.example', '{}', null);

    insertJob(db, 'job-real', { agentId: 'agent-real', status: 'closed' });
    insertEscrow(db, 'esc-real', 'job-real', 'agent-real', {
      status: 'released', releaseTx: 'real-release-tx', releasedAt: '2026-09-03T00:00:00.000Z',
    });
    insertJob(db, 'job-staged', { agentId: 'agent-real', status: 'closed' });
    insertEscrow(db, 'esc-staged', 'job-staged', 'agent-real');
    insertJob(db, 'job-fixture', { agentId: 'agent-real', status: 'closed', title: 'test fixture release' });
    insertEscrow(db, 'esc-fixture', 'job-fixture', 'agent-real', {
      status: 'released', releaseTx: 'fixture-release-tx', releasedAt: '2026-09-03T00:00:00.000Z',
    });
    insertJob(db, 'job-disputed', { agentId: 'agent-real', status: 'disputed' });
    insertEscrow(db, 'esc-disputed', 'job-disputed', 'agent-real', {
      status: 'released', releaseTx: 'disputed-release-tx', releasedAt: '2026-09-03T00:00:00.000Z',
    });
    insertJob(db, 'job-declined', { agentId: 'agent-real', status: 'awarded' });
    db.prepare(`INSERT INTO applications
      (id, job_id, agent_id, status, created_at, updated_at)
      VALUES ('application-declined', 'job-declined', 'agent-real', 'selected', ?, ?)`)
      .run('2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z');
    transitionJobState(db, 'job-declined', 'open', {
      actorId: 'agent-real',
      reason: 'agent_declined',
      source: 'marketplace-application-api',
      idempotencyKey: 'decline-outcome',
      metadata: { applicationId: 'application-declined' },
      now: '2026-09-03T00:00:00.000Z',
      env: {},
    });

    const computed = computeMarketplaceClaimEligibility(db, 'agent-real');
    assert.equal(computed.source, 'canonical-marketplace-evidence-v2');
    assert.equal(computed.eligibleIdentity, true);
    assert.equal(computed.verificationLevel, 2);
    assert.equal(computed.releasedEscrowCount, 1);
    assert.equal(computed.outcomeCount, 1);
    assert.equal(computed.positiveOutcomeCount, 0);
    assert.equal(computed.negativeOutcomeCount, 1);
    assert.equal(computed.trustScore, 360);
    const eligibilitySource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'lib', 'marketplace-claim-eligibility.js'),
      'utf8',
    );
    assert.doesNotMatch(eligibilitySource, /canonicalSignedReviews|peer_reviews|rating|reviewsReceived/);
  } finally {
    db.close();
  }
});

test('funded cancellation and expiry stay staged even when legacy live gates are enabled', () => {
  const db = createDb();
  const envNames = [
    'AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES',
    'AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES',
    'AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION',
    'SATP_PLATFORM_KEYPAIR',
  ];
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES: 'true',
    AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES: 'true',
    AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION: 'owner-approved-live-escrow-writes',
    SATP_PLATFORM_KEYPAIR: '/must/not/be/read/server-key.json',
  });
  try {
    insertJob(db, 'job-cancel', { escrowId: 'esc-cancel', funded: true });
    insertEscrow(db, 'esc-cancel', 'job-cancel', null);
    insertJob(db, 'job-expire', {
      escrowId: 'esc-expire', funded: true, expiresAt: '2026-09-02T00:00:00.000Z',
    });
    insertEscrow(db, 'esc-expire', 'job-expire', null);

    const cancelled = cancelJob(db, {
      jobId: 'job-cancel', actorId: 'poster', body: { reason: 'listing withdrawn' },
      idempotencyKey: 'cancel-once', now: '2026-09-03T00:00:00.000Z',
    });
    const expired = expireJob(db, {
      jobId: 'job-expire', actorId: 'poster', body: {},
      idempotencyKey: 'expire-once', now: '2026-09-03T00:00:00.000Z',
    });

    for (const result of [cancelled, expired]) {
      assert.deepEqual(result.escrow, { effect: 'refund', mode: 'staged', status: 'staged', moneyMoved: false });
      const effect = db.prepare('SELECT * FROM marketplace_escrow_effects WHERE transition_audit_id = ?').get(result.transitionAuditId);
      assert.equal(effect.execution_mode, 'staged');
      assert.equal(effect.status, 'staged');
      assert.equal(effect.live_escrow_enabled, 0);
      assert.equal(effect.gate_status, 'live_funds_gated_pending_security_review');
    }

    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'marketplace-job-routes.js'), 'utf8');
    assert.doesNotMatch(source, /escrow-onchain|buildRefund|SATP_PLATFORM_KEYPAIR|server-key|readFileSync/);
  } finally {
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    db.close();
  }
});

test('cancellation metadata and transition audit roll back together', () => {
  const db = createDb();
  try {
    insertJob(db, 'job-rollback');
    db.exec(`CREATE TRIGGER reject_cancel_metadata
      BEFORE UPDATE OF cancel_reason ON jobs
      WHEN NEW.cancel_reason IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'REJECT_CANCEL_METADATA'); END;`);

    assert.throws(() => cancelJob(db, {
      jobId: 'job-rollback', actorId: 'poster', body: { reason: 'must roll back' },
      idempotencyKey: 'rollback-once', now: '2026-09-03T00:00:00.000Z',
    }), /REJECT_CANCEL_METADATA/);
    assert.deepEqual(
      db.prepare('SELECT status, cancelled_at, cancel_reason FROM jobs WHERE id = ?').get('job-rollback'),
      { status: 'open', cancelled_at: null, cancel_reason: null },
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM job_transition_audit WHERE job_id = ?').get('job-rollback').count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM marketplace_escrow_effects WHERE job_id = ?').get('job-rollback').count, 0);
  } finally {
    db.close();
  }
});
