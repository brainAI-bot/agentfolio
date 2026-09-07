'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const Database = require('better-sqlite3');
const {
  AUTO_APPROVAL_MS,
  MarketplaceDeliveryError,
  initializeMarketplaceDeliverySchema,
  submitDeliverable,
  requestRevision,
  approveDeliverable,
  autoApproveDueDeliverables,
  addJobComment,
  listJobThread,
  registerMarketplaceDeliveryRoutes,
} = require('../src/routes/marketplace-delivery-routes');
const {
  listJobTransitionAudit,
  listMarketplaceEscrowEffects,
  transitionJobState,
} = require('../src/lib/marketplace-state-machine');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      api_key TEXT
    );
  `);
  initializeMarketplaceDeliverySchema(db);
  db.prepare('INSERT INTO profiles (id, api_key) VALUES (?, ?)').run('client', 'client-key');
  db.prepare('INSERT INTO profiles (id, api_key) VALUES (?, ?)').run('worker', 'worker-key');
  db.prepare('INSERT INTO profiles (id, api_key) VALUES (?, ?)').run('outsider', 'outsider-key');
  return db;
}

function insertJob(db, id = 'job_delivery', overrides = {}) {
  db.prepare(`
    INSERT INTO jobs (
      id, client_id, title, budget_type, status, selected_agent_id,
      escrow_id, escrow_funded, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.clientId || 'client',
    `Delivery job ${id}`,
    overrides.budgetType || 'fixed',
    overrides.status || 'in_progress',
    overrides.selectedAgentId === undefined ? 'worker' : overrides.selectedAgentId,
    overrides.escrowId || null,
    overrides.escrowFunded ? 1 : 0,
    overrides.createdAt || '2026-09-01T00:00:00.000Z',
    overrides.updatedAt || '2026-09-01T00:00:00.000Z',
  );
}

function submit(db, jobId = 'job_delivery', now = '2026-09-01T00:00:00.000Z', text = 'Finished work') {
  return submitDeliverable(db, {
    jobId,
    actorId: 'worker',
    body: { text, links: ['https://example.com/artifact'] },
    now,
    idempotencyKey: `submit-${text}`,
  });
}

test('stores immutable hashed deliverables and only allows the awarded worker to submit', () => {
  const db = createDb();
  try {
    insertJob(db);
    assert.throws(
      () => submitDeliverable(db, { jobId: 'job_delivery', actorId: 'outsider', body: { text: 'not allowed' } }),
      (error) => error instanceof MarketplaceDeliveryError && error.code === 'WORKER_ACTION_FORBIDDEN',
    );

    const result = submit(db);
    assert.equal(result.status, 'submitted');
    assert.equal(result.deliverable.submittedBy, 'worker');
    assert.equal(result.deliverable.submissionNumber, 1);
    assert.deepEqual(result.deliverable.links, ['https://example.com/artifact']);
    assert.equal(
      result.deliverable.contentHash,
      crypto.createHash('sha256').update(JSON.stringify({
        text: 'Finished work',
        links: ['https://example.com/artifact'],
      })).digest('hex'),
    );
    assert.equal(
      new Date(result.deliverable.autoApproveAt).getTime() - new Date(result.deliverable.submittedAt).getTime(),
      AUTO_APPROVAL_MS,
    );
    assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_delivery').status, 'submitted');
    assert.throws(
      () => db.prepare('UPDATE marketplace_deliverables SET text = ? WHERE id = ?').run('rewritten', result.deliverable.id),
      /MARKETPLACE_DELIVERABLE_IMMUTABLE/,
    );
  } finally {
    db.close();
  }
});

test('only the client can request revisions and the two-revision maximum is enforced', () => {
  const db = createDb();
  try {
    insertJob(db);
    const first = submit(db);
    assert.throws(
      () => requestRevision(db, {
        jobId: 'job_delivery',
        deliverableId: first.deliverable.id,
        actorId: 'worker',
        body: { reason: 'self revision' },
      }),
      (error) => error instanceof MarketplaceDeliveryError && error.code === 'CLIENT_ACTION_FORBIDDEN',
    );

    const firstRevision = requestRevision(db, {
      jobId: 'job_delivery',
      deliverableId: first.deliverable.id,
      actorId: 'client',
      body: { reason: 'Add the test receipt' },
      now: '2026-09-02T00:00:00.000Z',
      idempotencyKey: 'revision-1',
    });
    assert.equal(firstRevision.revision.revisionNumber, 1);
    const second = submit(db, 'job_delivery', '2026-09-03T00:00:00.000Z', 'Finished work v2');
    const secondRevision = requestRevision(db, {
      jobId: 'job_delivery',
      deliverableId: second.deliverable.id,
      actorId: 'client',
      body: { reason: 'Link the final receipt' },
      now: '2026-09-04T00:00:00.000Z',
      idempotencyKey: 'revision-2',
    });
    assert.equal(secondRevision.revision.revisionNumber, 2);
    const third = submit(db, 'job_delivery', '2026-09-05T00:00:00.000Z', 'Finished work v3');
    assert.throws(
      () => requestRevision(db, {
        jobId: 'job_delivery',
        deliverableId: third.deliverable.id,
        actorId: 'client',
        body: { reason: 'A third request is forbidden' },
      }),
      (error) => error instanceof MarketplaceDeliveryError && error.code === 'REVISION_LIMIT_REACHED',
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM marketplace_revision_requests').get().count, 2);
  } finally {
    db.close();
  }
});

test('client approval is audited without triggering a live escrow effect', () => {
  const db = createDb();
  try {
    insertJob(db, 'job_approve', { escrowId: 'esc_staged', escrowFunded: true });
    const delivery = submit(db, 'job_approve');
    assert.throws(
      () => approveDeliverable(db, { jobId: 'job_approve', deliverableId: delivery.deliverable.id, actorId: 'worker' }),
      (error) => error instanceof MarketplaceDeliveryError && error.code === 'CLIENT_ACTION_FORBIDDEN',
    );
    const result = approveDeliverable(db, {
      jobId: 'job_approve',
      deliverableId: delivery.deliverable.id,
      actorId: 'client',
      now: '2026-09-02T00:00:00.000Z',
      idempotencyKey: 'client-approval',
    });
    assert.equal(result.status, 'approved');
    const audit = listJobTransitionAudit(db, 'job_approve');
    assert.equal(audit.at(-1).toStatus, 'approved');
    assert.equal(audit.at(-1).actorId, 'client');
    assert.equal(listMarketplaceEscrowEffects(db, 'job_approve').length, 0);
  } finally {
    db.close();
  }
});

test('seven-day silence auto-approves once through an auditable idempotent timer seam', () => {
  const db = createDb();
  try {
    insertJob(db, 'job_timer');
    const delivery = submit(db, 'job_timer', '2026-09-01T00:00:00.000Z');
    assert.deepEqual(
      autoApproveDueDeliverables(db, { now: '2026-09-07T23:59:59.999Z' }),
      { results: [], errors: [] },
    );
    const firstSweep = autoApproveDueDeliverables(db, { now: '2026-09-08T00:00:00.000Z' });
    const [approved] = firstSweep.results;
    assert.deepEqual(firstSweep.errors, []);
    assert.equal(approved.deliverableId, delivery.deliverable.id);
    assert.equal(approved.status, 'approved');
    assert.deepEqual(
      autoApproveDueDeliverables(db, { now: '2026-09-09T00:00:00.000Z' }),
      { results: [], errors: [] },
    );
    const audit = listJobTransitionAudit(db, 'job_timer');
    const autoAudit = audit.find((entry) => entry.idempotencyKey === `deliverable-auto-approve:${delivery.deliverable.id}`);
    assert.equal(autoAudit.actorId, 'system:marketplace-auto-approval');
    assert.equal(autoAudit.source, 'marketplace-delivery-timer');
    assert.equal(audit.filter((entry) => entry.toStatus === 'approved').length, 1);
  } finally {
    db.close();
  }
});

test('auto-approval isolates a poisoned candidate and reports its error without starving later jobs', () => {
  const db = createDb();
  try {
    insertJob(db, 'job_poisoned');
    insertJob(db, 'job_healthy');
    const poisoned = submit(db, 'job_poisoned', '2026-09-01T00:00:00.000Z', 'Poisoned delivery');
    const healthy = submit(db, 'job_healthy', '2026-09-01T00:00:01.000Z', 'Healthy delivery');
    db.prepare("UPDATE jobs SET budget_type = 'hourly' WHERE id = ?").run('job_poisoned');

    const sweep = autoApproveDueDeliverables(db, { now: '2026-09-08T00:00:01.000Z' });

    assert.equal(sweep.results.length, 1);
    assert.equal(sweep.results[0].jobId, 'job_healthy');
    assert.equal(sweep.results[0].deliverableId, healthy.deliverable.id);
    assert.equal(sweep.results[0].status, 'approved');
    assert.match(sweep.results[0].transitionAuditId, /^jta_/);
    assert.deepEqual(sweep.errors, [{
      jobId: 'job_poisoned',
      deliverableId: poisoned.deliverable.id,
      code: 'FIXED_PRICE_ONLY',
      error: 'Only fixed-price jobs are supported',
    }]);
    assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_poisoned').status, 'submitted');
    assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_healthy').status, 'approved');
  } finally {
    db.close();
  }
});

test('timer-driven approval preserves the client dispute path', () => {
  const db = createDb();
  try {
    insertJob(db, 'job_auto_dispute');
    submit(db, 'job_auto_dispute', '2026-09-01T00:00:00.000Z');
    const sweep = autoApproveDueDeliverables(db, { now: '2026-09-08T00:00:00.000Z' });
    assert.equal(sweep.results[0].status, 'approved');

    const disputed = transitionJobState(db, 'job_auto_dispute', 'disputed', {
      actorId: 'client',
      reason: 'deliverable was not received',
      source: 'marketplace-dispute-api',
      idempotencyKey: 'post-auto-approval-dispute',
      now: '2026-09-09T00:00:00.000Z',
    });

    assert.equal(disputed.job.status, 'disputed');
    assert.equal(disputed.audit.fromStatus, 'approved');
    assert.equal(disputed.audit.toStatus, 'disputed');
  } finally {
    db.close();
  }
});

test('delivery route registration initializes marketplace prerequisites on a clean database', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);
  const app = express();

  assert.doesNotThrow(() => registerMarketplaceDeliveryRoutes(app, { getDb: () => db }));
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('jobs', 'applications', 'escrows') ORDER BY name").all(),
    [{ name: 'applications' }, { name: 'escrows' }, { name: 'jobs' }],
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'guard_jobs_status_transition'").get().count,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('profiles') WHERE name = 'api_key'").get().count,
    1,
  );
  db.close();
});

test('structured comments are immutable attachment-link-only evidence limited to parties/admin', () => {
  const db = createDb();
  try {
    insertJob(db, 'job_thread');
    assert.throws(
      () => addJobComment(db, { jobId: 'job_thread', actorId: 'outsider', body: { text: 'no access' } }),
      (error) => error instanceof MarketplaceDeliveryError && error.code === 'JOB_PARTY_REQUIRED',
    );
    assert.throws(
      () => addJobComment(db, { jobId: 'job_thread', actorId: 'client', body: { text: 'binary', files: ['proof.zip'] } }),
      (error) => error instanceof MarketplaceDeliveryError && error.code === 'ATTACHMENT_LINKS_ONLY',
    );
    const { comment } = addJobComment(db, {
      jobId: 'job_thread',
      actorId: 'client',
      body: { text: 'Revision context', attachmentLinks: ['https://example.com/evidence'] },
      idempotencyKey: 'comment-1',
    });
    addJobComment(db, {
      jobId: 'job_thread',
      actorId: 'admin',
      adminIds: new Set(['admin']),
      body: { text: 'Administrative evidence note' },
    });
    const thread = listJobThread(db, { jobId: 'job_thread', actorId: 'worker' });
    assert.equal(thread.comments.length, 2);
    assert.deepEqual(thread.comments[0].attachmentLinks, ['https://example.com/evidence']);
    assert.throws(
      () => db.prepare('DELETE FROM marketplace_job_comments WHERE id = ?').run(comment.id),
      /MARKETPLACE_JOB_COMMENT_IMMUTABLE/,
    );
  } finally {
    db.close();
  }
});

test('HTTP aliases authenticate actors and expose the SQLite job thread', async () => {
  const db = createDb();
  insertJob(db, 'job_route');
  const app = express();
  app.use(express.json());
  registerMarketplaceDeliveryRoutes(app, { getDb: () => db });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const submitted = await fetch(`${base}/api/marketplace/jobs/job_route/deliverables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'worker-key', 'Idempotency-Key': 'route-submit' },
      body: JSON.stringify({ text: 'Route delivery', links: ['https://example.com/route'] }),
    });
    assert.equal(submitted.status, 201);
    const submittedBody = await submitted.json();
    assert.equal(submittedBody.status, 'submitted');

    const commented = await fetch(`${base}/api/jobs/job_route/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer client-key' },
      body: JSON.stringify({ text: 'Received for review' }),
    });
    assert.equal(commented.status, 201);

    const thread = await fetch(`${base}/api/marketplace/jobs/job_route/thread`, {
      headers: { 'X-Api-Key': 'client-key' },
    });
    assert.equal(thread.status, 200);
    const threadBody = await thread.json();
    assert.equal(threadBody.deliverables.length, 1);
    assert.equal(threadBody.comments.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
