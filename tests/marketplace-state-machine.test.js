const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const express = require('express');

const {
  JOB_STATUS,
  ALLOWED_TRANSITIONS,
  MarketplaceTransitionError,
  initializeMarketplaceState,
  transitionJobState,
  listJobTransitionAudit,
  listMarketplaceEscrowEffects,
} = require('../src/lib/marketplace-state-machine');
const { registerWriteEndpoints } = require('../src/write-endpoints');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      escrow_id TEXT,
      escrow_funded INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  initializeMarketplaceState(db);
  return db;
}

function insertJob(db, id, status, options = {}) {
  db.prepare(`
    INSERT INTO jobs (id, status, escrow_id, escrow_funded, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    status,
    options.escrowId || null,
    options.escrowFunded ? 1 : 0,
    '2026-09-04T00:00:00.000Z',
  );
}

function transitionOptions(key, overrides = {}) {
  return {
    actorId: 'agent_test',
    reason: 'focused state-machine test',
    source: 'test',
    idempotencyKey: key,
    now: '2026-09-04T12:00:00.000Z',
    env: {},
    ...overrides,
  };
}

test('accepts every canonical edge and writes exactly one audit row atomically', () => {
  const db = createDb();
  try {
    let sequence = 0;
    for (const [fromStatus, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const toStatus of targets) {
        sequence += 1;
        const jobId = `job_allowed_${sequence}`;
        insertJob(db, jobId, fromStatus);

        const result = transitionJobState(
          db,
          jobId,
          toStatus,
          transitionOptions(`allowed-${sequence}`, { metadata: { sequence } }),
        );

        assert.equal(result.job.status, toStatus);
        assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId).status, toStatus);
        assert.deepEqual(listJobTransitionAudit(db, jobId), [{
          id: result.audit.id,
          jobId,
          fromStatus,
          toStatus,
          actorId: 'agent_test',
          reason: 'focused state-machine test',
          source: 'test',
          idempotencyKey: `allowed-${sequence}`,
          metadata: { sequence },
          createdAt: '2026-09-04T12:00:00.000Z',
        }]);
      }
    }
  } finally {
    db.close();
  }
});

test('rejects representative forbidden, unknown, and replayed transitions', () => {
  const db = createDb();
  try {
    insertJob(db, 'job_forbidden', JOB_STATUS.OPEN);

    assert.throws(
      () => transitionJobState(
        db,
        'job_forbidden',
        JOB_STATUS.SUBMITTED,
        transitionOptions('forbidden-open-submitted'),
      ),
      (error) => error instanceof MarketplaceTransitionError
        && error.code === 'ILLEGAL_JOB_TRANSITION',
    );

    assert.throws(
      () => transitionJobState(
        db,
        'job_forbidden',
        'retired',
        transitionOptions('unknown-retired'),
      ),
      (error) => error instanceof MarketplaceTransitionError
        && error.code === 'UNKNOWN_JOB_STATUS',
    );

    assert.throws(
      () => transitionJobState(
        db,
        'job_forbidden',
        JOB_STATUS.OPEN,
        transitionOptions('replay-open'),
      ),
      (error) => error instanceof MarketplaceTransitionError
        && error.code === 'REPLAYED_JOB_TRANSITION',
    );

    assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_forbidden').status, JOB_STATUS.OPEN);
    assert.equal(listJobTransitionAudit(db, 'job_forbidden').length, 0);
  } finally {
    db.close();
  }
});

test('requires the transition guard for every direct jobs.status mutation', () => {
  const db = createDb();
  try {
    insertJob(db, 'job_direct', JOB_STATUS.OPEN);
    assert.throws(
      () => db.prepare('UPDATE jobs SET status = ? WHERE id = ?')
        .run(JOB_STATUS.AWARDED, 'job_direct'),
      /JOB_STATUS_TRANSITION_REQUIRES_GUARD/,
    );
    assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_direct').status, JOB_STATUS.OPEN);
  } finally {
    db.close();
  }
});

test('rolls back status and audit together when effect recording fails', () => {
  const db = createDb();
  try {
    insertJob(db, 'job_rollback', JOB_STATUS.APPROVED, {
      escrowId: 'esc_rollback',
      escrowFunded: true,
    });
    db.exec(`
      CREATE TRIGGER fail_effect_insert
      BEFORE INSERT ON marketplace_escrow_effects
      BEGIN
        SELECT RAISE(ABORT, 'SIMULATED_EFFECT_FAILURE');
      END;
    `);

    assert.throws(
      () => transitionJobState(
        db,
        'job_rollback',
        JOB_STATUS.RELEASED,
        transitionOptions('rollback-release'),
      ),
      /SIMULATED_EFFECT_FAILURE/,
    );

    assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_rollback').status, JOB_STATUS.APPROVED);
    assert.equal(listJobTransitionAudit(db, 'job_rollback').length, 0);
    assert.equal(listMarketplaceEscrowEffects(db, 'job_rollback').length, 0);
  } finally {
    db.close();
  }
});

test('records release, refund, and dispute effects as staged while live escrow is disabled', () => {
  const db = createDb();
  try {
    const cases = [
      ['job_release', JOB_STATUS.WORK_SUBMITTED, JOB_STATUS.COMPLETED, 'release'],
      ['job_refund', JOB_STATUS.OPEN, JOB_STATUS.CANCELLED, 'refund'],
      ['job_disputed_refund', JOB_STATUS.DISPUTED, JOB_STATUS.CANCELLED, 'refund'],
      ['job_dispute', JOB_STATUS.SUBMITTED, JOB_STATUS.DISPUTED, 'dispute'],
    ];

    for (const [jobId, fromStatus, toStatus, effectType] of cases) {
      insertJob(db, jobId, fromStatus, {
        escrowId: `esc_${effectType}`,
        escrowFunded: true,
      });
      transitionJobState(
        db,
        jobId,
        toStatus,
        transitionOptions(`staged-${effectType}`),
      );

      const [effect] = listMarketplaceEscrowEffects(db, jobId);
      assert.equal(effect.effectType, effectType);
      assert.equal(effect.executionMode, 'staged');
      assert.equal(effect.status, 'staged');
      assert.equal(effect.liveEscrowEnabled, false);
      assert.equal(effect.gateStatus, 'live_funds_gated_pending_security_review');
      assert.equal(effect.payload.escrowId, `esc_${effectType}`);
    }
  } finally {
    db.close();
  }
});

test('does not stage escrow effects for release or dispute transitions without a funded escrow', () => {
  const db = createDb();
  try {
    insertJob(db, 'job_unfunded_release', JOB_STATUS.WORK_SUBMITTED);
    transitionJobState(
      db,
      'job_unfunded_release',
      JOB_STATUS.COMPLETED,
      transitionOptions('unfunded-release'),
    );
    assert.equal(listMarketplaceEscrowEffects(db, 'job_unfunded_release').length, 0);

    insertJob(db, 'job_no_escrow_dispute', JOB_STATUS.IN_PROGRESS, {
      escrowFunded: true,
    });
    transitionJobState(
      db,
      'job_no_escrow_dispute',
      JOB_STATUS.DISPUTED,
      transitionOptions('no-escrow-dispute'),
    );
    assert.equal(listMarketplaceEscrowEffects(db, 'job_no_escrow_dispute').length, 0);
  } finally {
    db.close();
  }
});

test('write complete route uses the transition guard on the real jobs table', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-state-route-'));
  const dbPath = path.join(tmpDir, 'agentfolio.db');
  const setupDb = new Database(dbPath);
  setupDb.pragma('foreign_keys = ON');
  setupDb.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL
    );

    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      status TEXT NOT NULL,
      escrow_id TEXT,
      escrow_funded INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      completion_note TEXT,
      funds_released INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  initializeMarketplaceState(setupDb);
  setupDb.prepare('INSERT INTO profiles (id, api_key) VALUES (?, ?)').run('client_route', 'test-key');
  setupDb.prepare(`
    INSERT INTO jobs (id, client_id, status, updated_at)
    VALUES (?, ?, ?, ?)
  `).run('job_route_complete', 'client_route', JOB_STATUS.OPEN, '2026-09-04T00:00:00.000Z');
  setupDb.close();

  const app = express();
  app.use(express.json());
  registerWriteEndpoints(app, { dbPath });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/jobs/job_route_complete/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': 'test-key',
        'Idempotency-Key': 'route-complete-once',
      },
      body: JSON.stringify({ completion_note: 'accepted' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, JOB_STATUS.COMPLETED);

    const verifyDb = new Database(dbPath);
    try {
      const job = verifyDb.prepare('SELECT status, completed_at, completion_note, funds_released FROM jobs WHERE id = ?')
        .get('job_route_complete');
      assert.equal(job.status, JOB_STATUS.COMPLETED);
      assert.ok(job.completed_at);
      assert.equal(job.completion_note, 'accepted');
      assert.equal(job.funds_released, 1);

      const audit = verifyDb.prepare('SELECT from_status, to_status, actor_id, source FROM job_transition_audit WHERE job_id = ?')
        .get('job_route_complete');
      assert.deepEqual(audit, {
        from_status: JOB_STATUS.OPEN,
        to_status: JOB_STATUS.COMPLETED,
        actor_id: 'client_route',
        source: 'write-endpoints',
      });
    } finally {
      verifyDb.close();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('audit and staged effect rows are immutable', () => {
  const db = createDb();
  try {
    insertJob(db, 'job_immutable', JOB_STATUS.APPROVED, {
      escrowId: 'esc_immutable',
      escrowFunded: true,
    });
    const result = transitionJobState(
      db,
      'job_immutable',
      JOB_STATUS.RELEASED,
      transitionOptions('immutable-release'),
    );

    assert.throws(
      () => db.prepare('UPDATE job_transition_audit SET reason = ? WHERE id = ?')
        .run('rewritten', result.audit.id),
      /JOB_TRANSITION_AUDIT_IMMUTABLE/,
    );
    assert.throws(
      () => db.prepare('DELETE FROM marketplace_escrow_effects WHERE transition_audit_id = ?')
        .run(result.audit.id),
      /MARKETPLACE_ESCROW_EFFECT_IMMUTABLE/,
    );
  } finally {
    db.close();
  }
});
