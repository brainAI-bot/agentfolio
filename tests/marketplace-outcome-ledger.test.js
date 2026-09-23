'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  JOB_STATUS,
  MarketplaceTransitionError,
  initializeMarketplaceState,
  transitionJobState,
} = require('../src/lib/marketplace-state-machine');
const {
  OUTCOME_MODEL_VERSION,
  listMarketplaceOutcomes,
  summarizeMarketplaceOutcomesForSubject,
} = require('../src/lib/marketplace-outcome-ledger');
const outcomeLedger = require('../src/lib/marketplace-outcome-ledger');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      selected_agent_id TEXT,
      status TEXT NOT NULL,
      escrow_id TEXT,
      escrow_funded INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      agent_id TEXT NOT NULL
    );
    CREATE TABLE marketplace_claims (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      agent_id TEXT NOT NULL
    );
  `);
  initializeMarketplaceState(db);
  return db;
}

function insertJob(db, id, status, {
  clientId = 'poster',
  agentId = 'agent',
  escrowId = null,
  escrowFunded = false,
} = {}) {
  db.prepare(`
    INSERT INTO jobs (
      id, client_id, selected_agent_id, status, escrow_id, escrow_funded, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, clientId, agentId, status, escrowId, escrowFunded ? 1 : 0, '2026-09-20T00:00:00.000Z');
}

function transition(db, jobId, key, source, reason, toStatus = JOB_STATUS.OPEN, {
  referenceId = `${source === 'marketplace-claim-api' ? 'claim' : 'application'}:${jobId}`,
  subjectId = 'agent',
  referenceJobId = jobId,
} = {}) {
  const isClaim = source === 'marketplace-claim-api';
  const table = isClaim ? 'marketplace_claims' : 'applications';
  const metadataKey = isClaim ? 'claimId' : 'applicationId';
  if (source === 'marketplace-claim-api' || source === 'marketplace-application-api') {
    db.prepare(`INSERT OR IGNORE INTO ${table} (id, job_id, agent_id) VALUES (?, ?, ?)`)
      .run(referenceId, referenceJobId, subjectId);
  }
  return transitionJobState(db, jobId, toStatus, {
    actorId: 'actor',
    idempotencyKey: key,
    source,
    reason,
    metadata: { [metadataKey]: referenceId },
    now: '2026-09-20T01:00:00.000Z',
    env: {},
  });
}

test('outcome ledger migration starts empty and does not reinterpret historical lifecycle rows', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      selected_agent_id TEXT,
      status TEXT NOT NULL,
      escrow_id TEXT,
      escrow_funded INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE job_transition_audit (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'server',
      idempotency_key TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      UNIQUE (job_id, idempotency_key)
    );
    INSERT INTO jobs VALUES (
      'historical-decline', 'poster', 'agent', 'open', NULL, 0, '2026-09-19T00:00:00.000Z'
    );
    INSERT INTO job_transition_audit VALUES (
      'jta_historical', 'historical-decline', 'awarded', 'open', 'agent',
      'agent_declined', 'marketplace-application-api', 'historical-key', '{}',
      '2026-09-19T00:00:00.000Z'
    );
  `);

  initializeMarketplaceState(db);

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM marketplace_outcome_ledger').get().count, 0);
  db.close();
});

test('canonical award declines and timeouts append only defensible negative outcomes', () => {
  const db = createDb();
  try {
    const cases = [
      ['application-decline', 'marketplace-application-api', 'agent_declined', 'application_award_declined', 'agent'],
      ['application-timeout', 'marketplace-application-api', 'award_timed_out', 'application_award_timed_out', 'agent'],
      ['claim-decline', 'marketplace-claim-api', 'claimant_declined', 'claim_award_declined', 'claimant'],
      ['claim-timeout', 'marketplace-claim-api', 'claim_award_timed_out', 'claim_award_timed_out', 'claimant'],
    ];

    for (const [jobId, source, reason, outcomeType, subjectRole] of cases) {
      insertJob(db, jobId, JOB_STATUS.AWARDED);
      const result = transition(db, jobId, `key:${jobId}`, source, reason);
      assert.equal(result.outcome.outcomeType, outcomeType);
      assert.equal(result.outcome.subjectRole, subjectRole);
      assert.equal(result.outcome.polarity, 'negative');
      assert.equal(result.outcome.modelVersion, OUTCOME_MODEL_VERSION);
      assert.equal(result.outcome.settledAmountMinor, null);
      assert.equal(result.outcome.sourceTransitionAuditId, result.audit.id);
    }

    const outcomes = listMarketplaceOutcomes(db);
    assert.equal(outcomes.length, 4);
    assert.deepEqual(summarizeMarketplaceOutcomesForSubject(db, 'agent'), {
      outcomeCount: 4,
      qualifiedOutcomeCount: 4,
      outcomeEventCount: 4,
      positiveOutcomeCount: 0,
      negativeOutcomeCount: 4,
      settledVolume: 0,
    });
  } finally {
    db.close();
  }
});

test('recorder re-reads canonical audit references and cannot be forged or misattributed by caller objects', () => {
  const db = createDb();
  try {
    assert.equal(outcomeLedger.recordDerivedMarketplaceOutcome, undefined);

    insertJob(db, 'canonical-subject', JOB_STATUS.AWARDED, { agentId: 'forged-job-agent' });
    const canonical = transition(
      db,
      'canonical-subject',
      'canonical-subject',
      'marketplace-application-api',
      'agent_declined',
      JOB_STATUS.OPEN,
      { subjectId: 'canonical-application-agent' },
    );
    assert.equal(canonical.outcome.subjectId, 'canonical-application-agent');

    insertJob(db, 'cross-job-reference', JOB_STATUS.AWARDED, { agentId: 'forged-job-agent' });
    insertJob(db, 'reference-owner', JOB_STATUS.OPEN, { agentId: null });
    const forged = transition(
      db,
      'cross-job-reference',
      'cross-job-reference',
      'marketplace-application-api',
      'agent_declined',
      JOB_STATUS.OPEN,
      {
        referenceId: 'application:other-job',
        referenceJobId: 'reference-owner',
        subjectId: 'misattributed-agent',
      },
    );
    assert.equal(forged.outcome, null);
    assert.deepEqual(
      listMarketplaceOutcomes(db).map((row) => row.subjectId),
      ['canonical-application-agent'],
    );
  } finally {
    db.close();
  }
});

test('staged release and dispute transitions create no positive or monetary outcomes', () => {
  const db = createDb();
  try {
    insertJob(db, 'staged-release', JOB_STATUS.WORK_SUBMITTED, {
      escrowId: 'esc-release', escrowFunded: true,
    });
    insertJob(db, 'staged-dispute', JOB_STATUS.SUBMITTED, {
      escrowId: 'esc-dispute', escrowFunded: true,
    });

    transition(db, 'staged-release', 'release', 'marketplace-delivery-api', 'poster_approved', JOB_STATUS.COMPLETED);
    transition(db, 'staged-dispute', 'dispute', 'marketplace-delivery-api', 'dispute_opened', JOB_STATUS.DISPUTED);

    assert.deepEqual(listMarketplaceOutcomes(db), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM marketplace_escrow_effects').get().count, 2);
  } finally {
    db.close();
  }
});

test('outcome rows reject direct insertion, updates, and deletes', () => {
  const db = createDb();
  try {
    insertJob(db, 'immutable-outcome', JOB_STATUS.AWARDED);
    const result = transition(
      db,
      'immutable-outcome',
      'immutable',
      'marketplace-application-api',
      'agent_declined',
    );

    assert.throws(
      () => db.prepare('UPDATE marketplace_outcome_ledger SET outcome_type = ? WHERE id = ?')
        .run('rewritten', result.outcome.id),
      /MARKETPLACE_OUTCOME_IMMUTABLE/,
    );
    assert.throws(
      () => db.prepare('DELETE FROM marketplace_outcome_ledger WHERE id = ?').run(result.outcome.id),
      /MARKETPLACE_OUTCOME_IMMUTABLE/,
    );
    assert.throws(
      () => db.prepare(`INSERT INTO marketplace_outcome_ledger (
        id, job_id, subject_id, subject_role, outcome_type, polarity, model_version,
        source_transition_audit_id, source, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`)
        .run('forged', 'immutable-outcome', 'agent', 'agent', 'forged', 'positive',
          OUTCOME_MODEL_VERSION, result.audit.id, 'test', '2026-09-20T02:00:00.000Z'),
      /MARKETPLACE_OUTCOME_REQUIRES_CANONICAL_EVENT/,
    );
  } finally {
    db.close();
  }
});

test('replaying a canonical transition cannot duplicate its derived outcome', () => {
  const db = createDb();
  try {
    insertJob(db, 'replayed-outcome', JOB_STATUS.AWARDED);
    transition(
      db,
      'replayed-outcome',
      'replay-key',
      'marketplace-application-api',
      'agent_declined',
    );

    assert.throws(
      () => transition(
        db,
        'replayed-outcome',
        'replay-key',
        'marketplace-application-api',
        'agent_declined',
      ),
      (error) => error instanceof MarketplaceTransitionError
        && error.code === 'REPLAYED_JOB_TRANSITION',
    );
    assert.equal(listMarketplaceOutcomes(db).length, 1);
  } finally {
    db.close();
  }
});
