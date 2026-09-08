'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const express = require('express');
const { initializeMarketplaceCoreSchema } = require('../src/lib/marketplace-schema');
const {
  expireTimedOutAwards,
  registerMarketplaceApplicationRoutes,
} = require('../src/routes/marketplace-application-routes');

function createHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      verification_data TEXT DEFAULT '{}',
      api_key TEXT
    );
  `);
  initializeMarketplaceCoreSchema(db);
  const profile = db.prepare('INSERT INTO profiles (id, verification_data, api_key) VALUES (?, ?, ?)');
  profile.run('client', '{}', 'key-client');
  profile.run('other-client', '{}', 'key-other-client');
  profile.run('verified-agent', JSON.stringify({ github: { verified: true } }), 'key-agent');
  profile.run('verified-agent-2', JSON.stringify({ solana: { verified: true } }), 'key-agent-2');
  profile.run('unverified-agent', JSON.stringify({ github: { verified: false } }), 'key-unverified');

  const app = express();
  app.use(express.json());
  registerMarketplaceApplicationRoutes(app, { getDb: () => db });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { db, server, baseUrl };
}

async function post(baseUrl, path, apiKey, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function insertJob(db, id, options = {}) {
  db.prepare(`
    INSERT INTO jobs (
      id, client_id, title, budget_type, budget_amount, budget_currency,
      timeline, status, escrow_id, escrow_funded, deposit_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '1w', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    options.clientId || 'client',
    id,
    options.budgetType || 'fixed',
    options.budget ?? 100,
    options.currency || 'SOL',
    options.status || 'open',
    options.escrowId || null,
    options.escrowFunded ? 1 : 0,
    options.depositConfirmedAt || null,
    options.now || '2026-09-05T00:00:00.000Z',
    options.now || '2026-09-05T00:00:00.000Z',
  );
}

function insertEscrow(db, id, jobId, amount, currency = 'SOL') {
  db.prepare(`
    INSERT INTO escrows (
      id, job_id, client_id, amount, currency, status,
      deposit_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, 'client', ?, ?, 'funded', ?, ?, ?)
  `).run(
    id,
    jobId,
    amount,
    currency,
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:00.000Z',
    '2026-09-05T00:00:00.000Z',
  );
}

function insertApplication(db, id, jobId, agentId, budget = 100, createdAt = '2026-09-05T01:00:00.000Z') {
  db.prepare(`
    INSERT INTO applications (
      id, job_id, agent_id, cover_message, proposed_budget, proposed_timeline,
      portfolio_items, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'A sufficiently detailed proposal', ?, '1w', '[]', 'pending', ?, ?)
  `).run(id, jobId, agentId, budget, createdAt, createdAt);
  db.prepare('UPDATE jobs SET application_count = application_count + 1 WHERE id = ?').run(jobId);
}

test('verified apply/withdraw is SQLite-only and fails closed for self, duplicate, and unverified applications', async (t) => {
  const { db, server, baseUrl } = createHarness();
  t.after(() => { server.close(); db.close(); });
  insertJob(db, 'job_apply');

  const unverified = await post(baseUrl, '/api/marketplace/jobs/job_apply/apply', 'key-unverified', {
    coverMessage: 'A sufficiently detailed proposal',
  });
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.code, 'VERIFIED_AGENT_REQUIRED');

  const self = await post(baseUrl, '/api/jobs/job_apply/apply', 'key-client', {
    coverMessage: 'A sufficiently detailed proposal',
  });
  assert.equal(self.status, 403);
  assert.equal(self.body.code, 'SELF_APPLICATION_FORBIDDEN');

  const applied = await post(baseUrl, '/api/jobs/job_apply/apply', 'key-agent', {
    coverMessage: 'A sufficiently detailed proposal',
    proposedBudget: 90,
    portfolioItems: ['https://example.com/work'],
  });
  assert.equal(applied.status, 201);
  assert.equal(applied.body.agentId, 'verified-agent');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM applications').get().count, 1);

  const duplicate = await post(baseUrl, '/api/jobs/job_apply/apply', 'key-agent', {
    coverMessage: 'Another sufficiently detailed proposal',
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'APPLICATION_ALREADY_EXISTS');

  const unauthorized = await post(baseUrl, `/api/applications/${applied.body.id}/withdraw`, 'key-agent-2');
  assert.equal(unauthorized.status, 403);
  const withdrawn = await post(baseUrl, `/api/marketplace/applications/${applied.body.id}/withdraw`, 'key-agent');
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.status, 'withdrawn');
  assert.equal(db.prepare('SELECT application_count FROM jobs WHERE id = ?').get('job_apply').application_count, 0);

  insertJob(db, 'job_reject');
  const rejectable = await post(baseUrl, '/api/jobs/job_reject/apply', 'key-agent-2', {
    coverMessage: 'A sufficiently detailed proposal',
  });
  const forgedReject = await post(baseUrl, `/api/applications/${rejectable.body.id}/reject`, 'key-other-client');
  assert.equal(forgedReject.status, 403);
  const rejected = await post(baseUrl, `/api/applications/${rejectable.body.id}/reject`, 'key-client');
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.status, 'rejected');

  for (let index = 0; index < 9; index += 1) {
    insertJob(db, `job_daily_${index}`);
    const response = await post(baseUrl, `/api/jobs/job_daily_${index}/apply`, 'key-agent', {
      coverMessage: `A sufficiently detailed proposal ${index}`,
    });
    assert.equal(response.status, 201);
  }
  insertJob(db, 'job_daily_limited');
  const limited = await post(baseUrl, '/api/jobs/job_daily_limited/apply', 'key-agent', {
    coverMessage: 'A sufficiently detailed eleventh proposal',
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'APPLICATION_DAILY_LIMIT');
});

test('selection requires exact verified funding and records counter-offer top-up before award', async (t) => {
  const { db, server, baseUrl } = createHarness();
  t.after(() => { server.close(); db.close(); });
  insertJob(db, 'job_counter', { escrowId: 'esc_counter', escrowFunded: true, depositConfirmedAt: '2026-09-05T00:00:00.000Z' });
  insertEscrow(db, 'esc_counter', 'job_counter', 80);
  insertApplication(db, 'app_counter', 'job_counter', 'verified-agent', 100);

  const unauthorized = await post(baseUrl, '/api/marketplace/applications/app_counter/select', 'key-other-client');
  assert.equal(unauthorized.status, 403);

  const mismatch = await post(baseUrl, '/api/marketplace/applications/app_counter/select', 'key-client');
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'ESCROW_ADJUSTMENT_REQUIRED');
  assert.equal(mismatch.body.adjustmentType, 'top_up');
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_counter').status, 'open');
  assert.deepEqual(
    db.prepare('SELECT adjustment_type, funded_amount, required_amount, status FROM marketplace_escrow_adjustments').get(),
    { adjustment_type: 'top_up', funded_amount: 80, required_amount: 100, status: 'staged' },
  );

  db.prepare('UPDATE escrows SET amount = 100 WHERE id = ?').run('esc_counter');
  const selected = await post(baseUrl, '/api/marketplace/jobs/job_counter/applications/app_counter/select', 'key-client');
  assert.equal(selected.status, 200);
  assert.equal(selected.body.status, 'awarded');
  assert.equal(selected.body.agreedBudget, 100);
  const awardWindowMs = new Date(selected.body.awardExpiresAt).getTime() - Date.now();
  assert.ok(awardWindowMs > (48 * 60 * 60 * 1000) - 5000);
  assert.ok(awardWindowMs <= 48 * 60 * 60 * 1000);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_counter').status, 'awarded');
  assert.deepEqual(
    db.prepare(`
      SELECT resolution, funded_amount, required_amount, currency
      FROM marketplace_escrow_adjustment_resolutions
    `).get(),
    { resolution: 'funding_matched', funded_amount: 100, required_amount: 100, currency: 'SOL' },
  );
});

test('minor-unit funding comparison accepts a representation artifact without recording an adjustment', async (t) => {
  const { db, server, baseUrl } = createHarness();
  t.after(() => { server.close(); db.close(); });
  insertJob(db, 'job_float_artifact', {
    budget: 0.3,
    escrowId: 'esc_float_artifact',
    escrowFunded: true,
  });
  insertEscrow(db, 'esc_float_artifact', 'job_float_artifact', 0.1 + 0.2);
  insertApplication(db, 'app_float_artifact', 'job_float_artifact', 'verified-agent', 0.3);

  const selected = await post(baseUrl, '/api/applications/app_float_artifact/select', 'key-client');
  assert.equal(selected.status, 200);
  assert.equal(selected.body.status, 'awarded');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM marketplace_escrow_adjustments').get().count,
    0,
  );
});

test('selection and acceptance require normalized escrow and job currency equality', async (t) => {
  const { db, server, baseUrl } = createHarness();
  t.after(() => { server.close(); db.close(); });
  insertJob(db, 'job_currency', {
    currency: 'USDC',
    escrowId: 'esc_currency',
    escrowFunded: true,
  });
  insertEscrow(db, 'esc_currency', 'job_currency', 100, 'SOL');
  insertApplication(db, 'app_currency', 'job_currency', 'verified-agent');

  const wrongSelectionCurrency = await post(baseUrl, '/api/applications/app_currency/select', 'key-client');
  assert.equal(wrongSelectionCurrency.status, 409);
  assert.equal(wrongSelectionCurrency.body.code, 'ESCROW_CURRENCY_MISMATCH');
  assert.equal(wrongSelectionCurrency.body.fundedCurrency, 'SOL');
  assert.equal(wrongSelectionCurrency.body.requiredCurrency, 'USDC');
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_currency').status, 'open');

  db.prepare("UPDATE escrows SET currency = ' usdc ' WHERE id = ?").run('esc_currency');
  const selected = await post(baseUrl, '/api/applications/app_currency/select', 'key-client');
  assert.equal(selected.status, 200);
  assert.equal(selected.body.status, 'awarded');

  db.prepare("UPDATE escrows SET currency = 'SOL' WHERE id = ?").run('esc_currency');
  const wrongAcceptanceCurrency = await post(baseUrl, '/api/applications/app_currency/accept', 'key-agent');
  assert.equal(wrongAcceptanceCurrency.status, 409);
  assert.equal(wrongAcceptanceCurrency.body.code, 'ESCROW_CURRENCY_MISMATCH');
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_currency').status, 'awarded');
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get('app_currency').status, 'selected');
});

test('server marketplace registration initializes clean-database prerequisites before state triggers', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT UNIQUE
    );
  `);
  const app = express();

  assert.doesNotThrow(() => registerMarketplaceApplicationRoutes(app, { getDb: () => db }));
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('jobs', 'applications', 'escrows') ORDER BY name").all(),
    [{ name: 'applications' }, { name: 'escrows' }, { name: 'jobs' }],
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'guard_jobs_status_transition'").get().count,
    1,
  );
  db.close();
});

test('selected agent can accept; decline and 48h timeout reject the selection and reopen the job', async (t) => {
  const { db, server, baseUrl } = createHarness();
  t.after(() => { server.close(); db.close(); });

  insertJob(db, 'job_accept', { escrowId: 'esc_accept', escrowFunded: true });
  insertEscrow(db, 'esc_accept', 'job_accept', 100);
  insertApplication(db, 'app_accept', 'job_accept', 'verified-agent');
  insertApplication(db, 'app_other', 'job_accept', 'verified-agent-2');
  await post(baseUrl, '/api/applications/app_accept/select', 'key-client');

  const forgedAccept = await post(baseUrl, '/api/applications/app_accept/accept', 'key-agent-2');
  assert.equal(forgedAccept.status, 403);
  const accepted = await post(baseUrl, '/api/applications/app_accept/accept', 'key-agent');
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, 'in_progress');
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get('app_other').status, 'rejected');

  insertJob(db, 'job_decline', { escrowId: 'esc_decline', escrowFunded: true });
  insertEscrow(db, 'esc_decline', 'job_decline', 100);
  insertApplication(db, 'app_decline', 'job_decline', 'verified-agent');
  await post(baseUrl, '/api/applications/app_decline/select', 'key-client');
  const forgedDecline = await post(baseUrl, '/api/applications/app_decline/decline', 'key-agent-2');
  assert.equal(forgedDecline.status, 403);
  const declined = await post(baseUrl, '/api/applications/app_decline/decline', 'key-agent');
  assert.equal(declined.status, 200);
  assert.equal(declined.body.status, 'open');
  assert.equal(db.prepare('SELECT status_note FROM applications WHERE id = ?').get('app_decline').status_note, 'agent_declined');

  insertJob(db, 'job_timeout', { escrowId: 'esc_timeout', escrowFunded: true });
  insertEscrow(db, 'esc_timeout', 'job_timeout', 100);
  insertApplication(db, 'app_timeout', 'job_timeout', 'verified-agent');
  await post(baseUrl, '/api/applications/app_timeout/select', 'key-client');
  db.prepare("UPDATE jobs SET award_expires_at = '2026-09-04T00:00:00.000Z' WHERE id = 'job_timeout'").run();
  const timedOut = await post(baseUrl, '/api/marketplace/jobs/job_timeout/award-timeout', 'key-client');
  assert.equal(timedOut.status, 200);
  assert.equal(timedOut.body.status, 'open');
  assert.equal(timedOut.body.reason, 'award_timed_out');
  assert.equal(db.prepare('SELECT selected_application_id FROM jobs WHERE id = ?').get('job_timeout').selected_application_id, null);

  insertJob(db, 'job_auto_timeout', { escrowId: 'esc_auto_timeout', escrowFunded: true });
  insertEscrow(db, 'esc_auto_timeout', 'job_auto_timeout', 100);
  insertApplication(db, 'app_auto_timeout', 'job_auto_timeout', 'verified-agent');
  await post(baseUrl, '/api/applications/app_auto_timeout/select', 'key-client');
  db.prepare("UPDATE jobs SET award_expires_at = '2026-09-04T00:00:00.000Z' WHERE id = 'job_auto_timeout'").run();
  const sweep = expireTimedOutAwards(db, { now: '2026-09-06T00:00:00.000Z' });
  assert.equal(sweep.length, 1);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_auto_timeout').status, 'open');
  assert.equal(db.prepare('SELECT status FROM applications WHERE id = ?').get('app_auto_timeout').status, 'rejected');
});

test('SDK exposes the complete application award lifecycle on canonical routes', async () => {
  const { AgentFolio } = require('../sdk');
  const sdk = new AgentFolio({ apiKey: 'not-used' });
  const calls = [];
  sdk._request = async (method, path) => { calls.push([method, path]); return {}; };

  await sdk.marketplace.withdrawApplication('job/1', 'app/1');
  await sdk.marketplace.rejectApplication('job/1', 'app/1');
  await sdk.marketplace.selectApplication('job/1', 'app/1');
  await sdk.marketplace.acceptAward('job/1', 'app/1');
  await sdk.marketplace.declineAward('job/1', 'app/1');
  await sdk.marketplace.processAwardTimeout('job/1');

  assert.deepEqual(calls, [
    ['POST', '/api/marketplace/jobs/job%2F1/applications/app%2F1/withdraw'],
    ['POST', '/api/marketplace/jobs/job%2F1/applications/app%2F1/reject'],
    ['POST', '/api/marketplace/jobs/job%2F1/applications/app%2F1/select'],
    ['POST', '/api/marketplace/jobs/job%2F1/applications/app%2F1/accept'],
    ['POST', '/api/marketplace/jobs/job%2F1/applications/app%2F1/decline'],
    ['POST', '/api/marketplace/jobs/job%2F1/award-timeout'],
  ]);
});
