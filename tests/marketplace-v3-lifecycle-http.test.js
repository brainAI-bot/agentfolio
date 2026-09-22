'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const express = require('express');
const { registerMarketplaceJobRoutes } = require('../src/routes/marketplace-job-routes');
const { registerMarketplaceApplicationRoutes } = require('../src/routes/marketplace-application-routes');
const { registerMarketplaceDeliveryRoutes } = require('../src/routes/marketplace-delivery-routes');
const { registerPublicMarketplaceReadRoutes } = require('../src/routes/public-marketplace-read-routes');

async function createHarness(clockState = { now: '2026-09-22T12:00:00.000Z' }) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT,
    wallet TEXT,
    wallets TEXT DEFAULT '{}',
    verification_data TEXT DEFAULT '{}',
    api_key TEXT UNIQUE
  );
  CREATE TABLE verifications (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    identifier TEXT NOT NULL,
    proof TEXT DEFAULT '{}',
    verified_at TEXT NOT NULL,
    UNIQUE(profile_id, platform)
  )`);
  const insert = db.prepare('INSERT INTO profiles (id, verification_data, api_key) VALUES (?, ?, ?)');
  insert.run('poster', '{}', 'key-poster');
  insert.run('agent-a', JSON.stringify({ github: { verified: true }, verificationLevel: 3, trustScore: 80 }), 'key-a');
  insert.run('agent-b', JSON.stringify({ solana: { verified: true }, verificationLevel: 3, trustScore: 75 }), 'key-b');
  insert.run('agent-low', JSON.stringify({ github: { verified: true }, verificationLevel: 5, trustScore: 100 }), 'key-low');
  const verify = db.prepare('INSERT INTO verifications (id, profile_id, platform, identifier, proof, verified_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const agentId of ['agent-a', 'agent-b']) {
    verify.run(`v-${agentId}-satp`, agentId, 'satp', `${agentId}-satp`, JSON.stringify({ txSignature: `${agentId}-satp-tx` }), '2026-09-20T00:00:00.000Z');
    verify.run(`v-${agentId}-github`, agentId, 'github', `${agentId}-github`, '{}', '2026-09-20T00:00:00.000Z');
    verify.run(`v-${agentId}-solana`, agentId, 'solana', `${agentId}-solana`, '{}', '2026-09-20T00:00:00.000Z');
  }
  verify.run('v-agent-low-satp', 'agent-low', 'satp', 'agent-low-satp', '{}', '2026-09-20T00:00:00.000Z');
  verify.run('v-agent-low-github', 'agent-low', 'github', 'agent-low-github', '{}', '2026-09-20T00:00:00.000Z');

  const app = express();
  app.use(express.json());
  registerPublicMarketplaceReadRoutes(app, { getDb: () => db });
  const clock = () => clockState.now;
  registerMarketplaceJobRoutes(app, { getDb: () => db, clock });
  registerMarketplaceApplicationRoutes(app, { getDb: () => db, clock });
  registerMarketplaceDeliveryRoutes(app, { getDb: () => db, clock });
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
    'marketplace-delivery-routes.js',
  ].map((file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', file), 'utf8')).join('\n');
  assert.doesNotMatch(lifecycleSources, /\b(?:Keypair|privateKey|secretKey|sendTransaction|sendRawTransaction|signTransaction|build\w*Tx|relayTransaction)\b/);
});


test('V3 HTTP tranche 2 completes select and claim lifecycles with fake-clock failure coverage', async (t) => {
  const clock = { now: '2026-09-22T12:00:00.000Z' };
  const { db, server, baseUrl } = await createHarness(clock);
  t.after(() => { server.close(); db.close(); });

  const select = await createJob(baseUrl, 'select');
  assert.equal(select.status, 201);
  await stageAndVerify(baseUrl, select.body.id, 'staged:select:e2e');
  const application = await request(baseUrl, 'POST', `/api/marketplace/jobs/${select.body.id}/apply`, {
    key: 'key-a', body: { coverMessage: 'I will deliver this exact lifecycle task.', proposedBudget: '1.000000001' },
  });
  assert.equal(application.status, 201);
  const award = await request(baseUrl, 'POST', `/api/marketplace/applications/${application.body.id}/select`, {
    key: 'key-poster', idempotencyKey: 'select-e2e', body: {},
  });
  assert.equal(award.body.status, 'awarded');
  const accepted = await request(baseUrl, 'POST', `/api/marketplace/applications/${application.body.id}/accept`, {
    key: 'key-a', idempotencyKey: 'accept-select-e2e', body: {},
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, 'in_progress');
  const acceptedReplay = await request(baseUrl, 'POST', `/api/marketplace/applications/${application.body.id}/accept`, {
    key: 'key-a', idempotencyKey: 'accept-select-e2e', body: {},
  });
  assert.equal(acceptedReplay.status, 200);
  assert.equal(acceptedReplay.body.replayed, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM job_transition_audit WHERE job_id = ? AND to_status = 'in_progress'").get(select.body.id).count, 1);

  const submit = async (jobId, key, text, actorKey = 'key-a') => request(baseUrl, 'POST', `/api/marketplace/jobs/${jobId}/deliverables`, {
    key: actorKey, idempotencyKey: key, body: { text, links: [`https://example.com/${key}`] },
  });
  const revise = async (jobId, deliverableId, key, reason) => request(baseUrl, 'POST', `/api/marketplace/jobs/${jobId}/deliverables/${deliverableId}/revisions`, {
    key: 'key-poster', idempotencyKey: key, body: { reason },
  });

  const first = await submit(select.body.id, 'select-submit-1', 'Initial select-mode delivery');
  assert.equal(first.status, 201);
  assert.equal(first.body.status, 'submitted');
  const firstReplay = await submit(select.body.id, 'select-submit-1', 'Initial select-mode delivery');
  assert.equal(firstReplay.status, 201);
  assert.equal(firstReplay.body.replayed, true);
  const revisionOne = await revise(select.body.id, first.body.deliverable.id, 'select-revision-1', 'Add the first receipt');
  assert.equal(revisionOne.body.revision.revisionNumber, 1);
  const second = await submit(select.body.id, 'select-submit-2', 'Select-mode delivery revision two');
  const revisionTwo = await revise(select.body.id, second.body.deliverable.id, 'select-revision-2', 'Add the final receipt');
  assert.equal(revisionTwo.body.revision.revisionNumber, 2);
  const third = await submit(select.body.id, 'select-submit-3', 'Final select-mode delivery');
  const revisionThree = await revise(select.body.id, third.body.deliverable.id, 'select-revision-3', 'A forbidden third revision');
  assert.equal(revisionThree.status, 409);
  assert.equal(revisionThree.body.code, 'REVISION_LIMIT_REACHED');

  const approved = await request(baseUrl, 'POST', `/api/marketplace/jobs/${select.body.id}/deliverables/${third.body.deliverable.id}/approve`, {
    key: 'key-poster', idempotencyKey: 'select-approve', body: {},
  });
  assert.equal(approved.body.status, 'approved');
  const illegalSubmit = await submit(select.body.id, 'select-illegal-submit', 'Cannot submit after approval');
  assert.equal(illegalSubmit.status, 409);
  assert.equal(illegalSubmit.body.code, 'JOB_NOT_IN_PROGRESS');

  const released = await request(baseUrl, 'POST', `/api/marketplace/jobs/${select.body.id}/release`, {
    key: 'key-poster', idempotencyKey: 'select-release', body: {},
  });
  assert.equal(released.status, 200);
  assert.equal(released.body.status, 'released');
  assert.equal(released.body.executionMode, 'staged');
  assert.equal(released.body.moneyMoved, false);
  assert.equal(released.body.transaction, undefined);
  assert.deepEqual(released.body.effect, {
    escrowId: 'staged:select:e2e',
    fromStatus: 'approved',
    toStatus: 'released',
    transitionAuditId: released.body.transitionAuditId,
    amountMinor: '1000000001',
    feeBasisPoints: 500,
    feeMinor: '50000000',
    recipientMinor: '950000001',
    currency: 'SOL',
    payerId: 'poster',
    recipientId: 'agent-a',
  });
  const releaseReplay = await request(baseUrl, 'POST', `/api/marketplace/jobs/${select.body.id}/release`, {
    key: 'key-poster', idempotencyKey: 'select-release', body: {},
  });
  assert.equal(releaseReplay.body.replayed, true);
  assert.equal(releaseReplay.body.effectId, released.body.effectId);
  const closed = await request(baseUrl, 'POST', `/api/marketplace/jobs/${select.body.id}/close`, {
    key: 'key-poster', idempotencyKey: 'select-close', body: {},
  });
  assert.equal(closed.body.status, 'closed');
  assert.equal(closed.body.moneyMoved, false);
  const thread = await request(baseUrl, 'GET', `/api/marketplace/jobs/${select.body.id}/thread`, { key: 'key-poster' });
  assert.equal(thread.status, 200);
  assert.equal(thread.body.deliverables.length, 3);
  assert.equal(thread.body.revisions.length, 2);
  assert.equal(thread.body.escrowEffects.length, 1);
  assert.equal(thread.body.escrowEffects[0].effectType, 'release');
  assert.equal(thread.body.transitions.filter((entry) => entry.toStatus === 'released').length, 1);
  const closedRead = await request(baseUrl, 'GET', `/api/marketplace/jobs/${select.body.id}`);
  assert.equal(closedRead.body.status, 'closed');
  assert.equal(closedRead.body.publicMetrics.gmvMinorUnits, '0');
  assert.equal(closedRead.body.publicMetrics.outcomeReputationEligible, false);

  const claim = await createJob(baseUrl, 'claim');
  await stageAndVerify(baseUrl, claim.body.id, 'staged:claim:e2e');
  const claimed = await request(baseUrl, 'POST', `/api/marketplace/jobs/${claim.body.id}/claim`, {
    key: 'key-b', idempotencyKey: 'claim-happy', body: {},
  });
  assert.equal(claimed.body.status, 'awarded');
  const claimAccepted = await request(baseUrl, 'POST', `/api/marketplace/jobs/${claim.body.id}/claim/accept`, {
    key: 'key-b', idempotencyKey: 'claim-happy-accept', body: {},
  });
  assert.equal(claimAccepted.body.status, 'in_progress');
  const claimDelivery = await submit(claim.body.id, 'claim-submit', 'Claim-mode finished delivery', 'key-b');
  assert.equal(claimDelivery.body.status, 'submitted');
  const tooEarly = await request(baseUrl, 'POST', `/api/marketplace/jobs/${claim.body.id}/approval-timeout`, {
    key: 'key-poster', idempotencyKey: 'claim-approval-timeout-early', body: {},
  });
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.body.code, 'APPROVAL_TIMEOUT_NOT_REACHED');
  clock.now = '2026-09-29T12:00:00.000Z';
  const autoApproved = await request(baseUrl, 'POST', `/api/marketplace/jobs/${claim.body.id}/approval-timeout`, {
    key: 'key-poster', idempotencyKey: 'claim-approval-timeout', body: {},
  });
  assert.equal(autoApproved.body.status, 'approved');
  const claimRelease = await request(baseUrl, 'POST', `/api/marketplace/jobs/${claim.body.id}/release`, {
    key: 'key-poster', idempotencyKey: 'claim-release', body: {},
  });
  assert.equal(claimRelease.body.effect.feeBasisPoints, 500);
  assert.equal(claimRelease.body.effect.feeMinor, '50000000');
  const claimClose = await request(baseUrl, 'POST', `/api/marketplace/jobs/${claim.body.id}/close`, {
    key: 'key-b', idempotencyKey: 'claim-close', body: {},
  });
  assert.equal(claimClose.body.status, 'closed');

  clock.now = '2026-10-01T00:00:00.000Z';
  const reopen = await createJob(baseUrl, 'claim');
  await stageAndVerify(baseUrl, reopen.body.id, 'staged:claim:reopen');
  const firstClaim = await request(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim`, {
    key: 'key-a', idempotencyKey: 'reopen-claim-a', body: {},
  });
  assert.equal(firstClaim.body.status, 'awarded');
  const declined = await request(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim/decline`, {
    key: 'key-a', idempotencyKey: 'reopen-decline-a', body: {},
  });
  assert.equal(declined.body.status, 'open');
  const declinedReplay = await request(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim/decline`, {
    key: 'key-a', idempotencyKey: 'reopen-decline-a', body: {},
  });
  assert.equal(declinedReplay.body.replayed, true);
  const repeatedIdentity = await request(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim`, {
    key: 'key-a', idempotencyKey: 'reopen-claim-a-again', body: {},
  });
  assert.equal(repeatedIdentity.status, 409);
  assert.equal(repeatedIdentity.body.code, 'CLAIM_RETRY_FORBIDDEN');
  const secondClaim = await request(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim`, {
    key: 'key-b', idempotencyKey: 'reopen-claim-b', body: {},
  });
  assert.equal(secondClaim.body.status, 'awarded');
  clock.now = '2026-10-03T00:00:00.001Z';
  const timedOut = await request(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim/award-timeout`, {
    key: 'key-poster', idempotencyKey: 'reopen-timeout-b', body: {},
  });
  assert.equal(timedOut.body.status, 'open');
  assert.equal(timedOut.body.outcome, 'timed_out');

  const expiring = await createJob(baseUrl, 'select', { expiresAt: '2026-10-04T00:00:00.000Z' });
  const earlyExpiry = await request(baseUrl, 'POST', `/api/marketplace/jobs/${expiring.body.id}/expire`, {
    key: 'key-poster', idempotencyKey: 'expire-early', body: {},
  });
  assert.equal(earlyExpiry.status, 409);
  assert.equal(earlyExpiry.body.code, 'JOB_NOT_EXPIRED');
  clock.now = '2026-10-04T00:00:00.000Z';
  const expired = await request(baseUrl, 'POST', `/api/marketplace/jobs/${expiring.body.id}/expire`, {
    key: 'key-poster', idempotencyKey: 'expire-due', body: {},
  });
  assert.equal(expired.body.status, 'expired');
  const expiredReplay = await request(baseUrl, 'POST', `/api/marketplace/jobs/${expiring.body.id}/expire`, {
    key: 'key-poster', idempotencyKey: 'expire-due', body: {},
  });
  assert.equal(expiredReplay.body.replayed, true);

  const cancellable = await createJob(baseUrl, 'select');
  await stageAndVerify(baseUrl, cancellable.body.id, 'staged:cancel:e2e');
  const cancelled = await request(baseUrl, 'POST', `/api/marketplace/jobs/${cancellable.body.id}/cancel`, {
    key: 'key-poster', idempotencyKey: 'cancel-funded', body: { reason: 'Poster withdrew the open listing' },
  });
  assert.equal(cancelled.body.status, 'cancelled');
  assert.deepEqual(cancelled.body.escrow, { effect: 'refund', mode: 'staged', status: 'staged', moneyMoved: false });
  const cancelledReplay = await request(baseUrl, 'POST', `/api/marketplace/jobs/${cancellable.body.id}/cancel`, {
    key: 'key-poster', idempotencyKey: 'cancel-funded', body: { reason: 'Poster withdrew the open listing' },
  });
  assert.equal(cancelledReplay.body.replayed, true);
  assert.equal(cancelledReplay.body.transitionAuditId, cancelled.body.transitionAuditId);
  const cancelThread = await request(baseUrl, 'GET', `/api/marketplace/jobs/${cancellable.body.id}/thread`, { key: 'key-poster' });
  assert.equal(cancelThread.body.escrowEffects.length, 1);
  assert.equal(cancelThread.body.escrowEffects[0].effectType, 'refund');
});
