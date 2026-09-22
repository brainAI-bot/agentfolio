'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const express = require('express');
const { registerMarketplaceJobRoutes } = require('../src/routes/marketplace-job-routes');
const { registerMarketplaceApplicationRoutes } = require('../src/routes/marketplace-application-routes');
const { registerPublicMarketplaceReadRoutes } = require('../src/routes/public-marketplace-read-routes');

async function createHarness() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT,
    wallet TEXT,
    wallets TEXT DEFAULT '{}',
    verification_data TEXT DEFAULT '{}',
    api_key TEXT UNIQUE
  )`);
  const insert = db.prepare('INSERT INTO profiles (id, verification_data, api_key) VALUES (?, ?, ?)');
  insert.run('poster', '{}', 'key-poster');
  insert.run('agent-a', JSON.stringify({ github: { verified: true }, verificationLevel: 3, trustScore: 80 }), 'key-a');
  insert.run('agent-b', JSON.stringify({ solana: { verified: true }, verificationLevel: 3, trustScore: 75 }), 'key-b');
  insert.run('agent-low', JSON.stringify({ github: { verified: true }, verificationLevel: 1, trustScore: 10 }), 'key-low');

  const app = express();
  app.use(express.json());
  registerPublicMarketplaceReadRoutes(app, { getDb: () => db });
  registerMarketplaceJobRoutes(app, { getDb: () => db });
  registerMarketplaceApplicationRoutes(app, { getDb: () => db });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  return { db, server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function request(baseUrl, method, path, { key, idempotencyKey, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'X-API-Key': key } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

function jobBody(pickupMode, overrides = {}) {
  return {
    title: `${pickupMode} lifecycle job`,
    description: 'A sufficiently detailed fixed-price marketplace task.',
    category: 'development',
    skills: ['sqlite', 'node'],
    budgetType: 'fixed',
    budgetAmount: '1.000000001',
    budgetCurrency: 'SOL',
    timeline: '1w',
    pickupMode,
    minimumVerificationLevel: 2,
    minimumTrustScore: 50,
    ...overrides,
  };
}

async function createJob(baseUrl, pickupMode, overrides) {
  return request(baseUrl, 'POST', '/api/marketplace/jobs', {
    key: 'key-poster',
    body: jobBody(pickupMode, overrides),
  });
}

async function stageAndVerify(baseUrl, jobId, escrowReference) {
  const staged = await request(baseUrl, 'POST', `/api/marketplace/jobs/${jobId}/fund-staged`, {
    key: 'key-poster',
    idempotencyKey: `stage-${jobId}`,
    body: { escrowReference, amount: '1.000000001' },
  });
  assert.equal(staged.status, 201);
  assert.equal(staged.body.executionMode, 'staged');
  assert.equal(staged.body.moneyMoved, false);
  assert.equal(staged.body.publicGmvMinorUnits, '0');
  assert.equal(staged.body.outcomeReputationEligible, false);
  assert.equal(staged.body.transaction, undefined);

  const verified = await request(baseUrl, 'POST', `/api/marketplace/jobs/${jobId}/fund-staged/verify`, {
    key: 'key-poster',
    idempotencyKey: `verify-${jobId}`,
    body: { escrowReference, amount: '1.000000001', verificationSource: 'staged_runtime_readback' },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.status, 'verified');
  assert.equal(verified.body.amountMinor, '1000000001');
  assert.equal(verified.body.moneyMoved, false);
  assert.equal(verified.body.transaction, undefined);
  return { staged, verified };
}

test('V3 HTTP lifecycle foundation supports exact select and claim modes while live funds stay closed', async (t) => {
  const { db, server, baseUrl } = await createHarness();
  t.after(() => { server.close(); db.close(); });

  const selectCreated = await createJob(baseUrl, 'select');
  const claimCreated = await createJob(baseUrl, 'claim');
  assert.equal(selectCreated.status, 201);
  assert.equal(claimCreated.status, 201);
  assert.equal(selectCreated.body.budgetAmount, '1.000000001');
  assert.equal(selectCreated.body.budgetAmountMinor, '1000000001');
  assert.equal(selectCreated.body.pickupMode, 'select');
  assert.equal(claimCreated.body.pickupMode, 'claim');

  const insertLegacy = db.prepare(`INSERT INTO jobs
    (id, client_id, title, description, category, skills, budget_type, budget_amount,
     budget_currency, timeline, pickup_mode, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'development', '[]', 'fixed', ?, 'SOL', '1w', ?, 'open', ?, ?)`);
  const legacyCreatedAt = '2026-09-22T00:00:00.000Z';
  insertLegacy.run('job_fixture_claim', 'poster', 'test fixture claim job', 'fixture row excluded from public traction', 1, 'claim', legacyCreatedAt, legacyCreatedAt);
  insertLegacy.run('job_legacy_zero', 'poster', 'legacy zero claim job', 'legacy zero-budget row must not break public reads', 0, 'claim', legacyCreatedAt, legacyCreatedAt);

  const listed = await request(baseUrl, 'GET', '/api/marketplace/jobs?pickupMode=claim&status=open');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.jobs[0].id, claimCreated.body.id);
  assert.equal(listed.body.publicTraction.excludedFixtures, 1);
  assert.equal(listed.body.publicTraction.excludedInvalidBudgets, 1);
  const selectListed = await request(baseUrl, 'GET', '/api/marketplace/jobs?pickupMode=select&status=open');
  assert.equal(selectListed.status, 200);
  assert.equal(selectListed.body.total, 1);
  assert.equal(selectListed.body.jobs[0].id, selectCreated.body.id);
  const statusFiltered = await request(baseUrl, 'GET', '/api/marketplace/jobs?status=awarded');
  assert.equal(statusFiltered.status, 200);
  assert.equal(statusFiltered.body.total, 0);

  const selectedRead = await request(baseUrl, 'GET', `/api/marketplace/jobs/${selectCreated.body.id}`);
  const claimRead = await request(baseUrl, 'GET', `/api/marketplace/jobs/${claimCreated.body.id}`);
  assert.equal(selectedRead.status, 200);
  assert.equal(claimRead.status, 200);
  assert.equal(selectedRead.body.pickupMode, 'select');
  assert.equal(claimRead.body.pickupMode, 'claim');
  assert.equal(selectedRead.body.publicMetrics.gmvMinorUnits, '0');
  assert.equal(selectedRead.body.publicMetrics.outcomeReputationEligible, false);
  assert.equal(claimRead.body.escrow.moneyMoved, false);

  const prematureClaim = await request(baseUrl, 'POST', `/api/marketplace/jobs/${claimCreated.body.id}/claim`, {
    key: 'key-a', idempotencyKey: 'premature-claim', body: {},
  });
  assert.equal(prematureClaim.status, 409);
  assert.equal(prematureClaim.body.code, 'ESCROW_FUNDING_REQUIRED');

  const mismatch = await request(baseUrl, 'POST', `/api/marketplace/jobs/${selectCreated.body.id}/fund-staged`, {
    key: 'key-poster', idempotencyKey: 'mismatch',
    body: { escrowReference: 'staged:select:001', amount: '1.000000002' },
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'ESCROW_FUNDING_MISMATCH');
  assert.equal(mismatch.body.expectedMinor, '1000000001');
  assert.equal(mismatch.body.actualMinor, '1000000002');

  await stageAndVerify(baseUrl, selectCreated.body.id, 'staged:select:001');
  const applied = await request(baseUrl, 'POST', `/api/marketplace/jobs/${selectCreated.body.id}/apply`, {
    key: 'key-a', body: { coverMessage: 'A complete and credible proposal.', proposedBudget: '1.000000001' },
  });
  assert.equal(applied.status, 201);
  assert.equal(applied.body.proposedBudgetMinor, '1000000001');

  const selected = await request(baseUrl, 'POST', `/api/marketplace/applications/${applied.body.id}/select`, {
    key: 'key-poster', idempotencyKey: 'select-once', body: {},
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.status, 'awarded');
  assert.equal(selected.body.agreedBudget, '1.000000001');
  const selectedReplay = await request(baseUrl, 'POST', `/api/marketplace/applications/${applied.body.id}/select`, {
    key: 'key-poster', idempotencyKey: 'select-once', body: {},
  });
  assert.equal(selectedReplay.status, 200);
  assert.equal(selectedReplay.body.replayed, true);

  const illegal = await request(baseUrl, 'POST', `/api/marketplace/jobs/${selectCreated.body.id}/cancel`, {
    key: 'key-poster', idempotencyKey: 'illegal-cancel', body: { reason: 'cannot cancel an award' },
  });
  assert.equal(illegal.status, 409);
  assert.equal(illegal.body.code, 'ILLEGAL_JOB_TRANSITION');

  await stageAndVerify(baseUrl, claimCreated.body.id, 'staged:claim:001');
  const ineligible = await request(baseUrl, 'POST', `/api/marketplace/jobs/${claimCreated.body.id}/claim`, {
    key: 'key-low', idempotencyKey: 'low-claim', body: {},
  });
  assert.equal(ineligible.status, 403);
  assert.equal(ineligible.body.code, 'CLAIM_INELIGIBLE_VERIFICATION_LEVEL');
  assert.equal(ineligible.body.predicate, 'minimum_verification_level');

  const claims = await Promise.all([
    request(baseUrl, 'POST', `/api/marketplace/jobs/${claimCreated.body.id}/claim`, {
      key: 'key-a', idempotencyKey: 'claim-a', body: {},
    }),
    request(baseUrl, 'POST', `/api/marketplace/jobs/${claimCreated.body.id}/claim`, {
      key: 'key-b', idempotencyKey: 'claim-b', body: {},
    }),
  ]);
  const winner = claims.find((entry) => entry.status === 200);
  const loser = claims.find((entry) => entry.status === 409);
  assert.ok(winner);
  assert.ok(loser);
  assert.equal(winner.body.status, 'awarded');
  assert.equal(winner.body.agreedBudgetMinor, '1000000001');
  assert.equal(loser.body.code, 'JOB_ALREADY_CLAIMED');
  assert.equal(loser.body.selectedAgentId, undefined);
  assert.equal(loser.body.retryable, false);

  const winnerKey = winner === claims[0] ? 'key-a' : 'key-b';
  const winnerIdempotencyKey = winner === claims[0] ? 'claim-a' : 'claim-b';
  const replay = await request(baseUrl, 'POST', `/api/marketplace/jobs/${claimCreated.body.id}/claim`, {
    key: winnerKey, idempotencyKey: winnerIdempotencyKey, body: {},
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.claimId, winner.body.claimId);

  const lifecycleSources = [
    'marketplace-job-routes.js',
    'marketplace-application-routes.js',
  ].map((file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', file), 'utf8')).join('\n');
  assert.doesNotMatch(lifecycleSources, /\b(?:Keypair|privateKey|secretKey|sendTransaction|sendRawTransaction|signTransaction|build\w*Tx|relayTransaction)\b/);
});
