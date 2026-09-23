'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createMarketplaceV3Server } = require('../src/marketplace-v3-server');
const { expireDueJobs } = require('../src/routes/marketplace-job-routes');
const { autoApproveDueDeliverables } = require('../src/routes/marketplace-delivery-routes');
const { runMarketplaceProductionSmoke } = require('../scripts/marketplace-v3-production-smoke');

function seedIdentityDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (
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
    );
  `);
  const profiles = [
    ['poster', 'Poster', '{}', '{}', 'key-poster'],
    ['worker', 'Worker', '{}', JSON.stringify({ github: { verified: true }, verificationLevel: 3, trustScore: 80 }), 'key-worker'],
    ['worker-b', 'Worker B', '{}', JSON.stringify({ solana: { verified: true }, verificationLevel: 3, trustScore: 75 }), 'key-worker-b'],
    ['worker-low', 'Worker Low', '{}', JSON.stringify({ github: { verified: true }, verificationLevel: 5, trustScore: 100 }), 'key-worker-low'],
    ['admin', 'Admin', '{}', '{}', 'key-admin'],
  ];
  const insertProfile = db.prepare('INSERT INTO profiles (id, name, wallets, verification_data, api_key) VALUES (?, ?, ?, ?, ?)');
  for (const profile of profiles) insertProfile.run(...profile);
  const insertVerification = db.prepare('INSERT INTO verifications (id, profile_id, platform, identifier, proof, verified_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const workerId of ['worker', 'worker-b']) {
    for (const platform of ['satp', 'github', 'solana']) {
      insertVerification.run(`v-${workerId}-${platform}`, workerId, platform, `${workerId}-${platform}`, '{}', '2026-09-22T00:00:00.000Z');
    }
  }
  for (const platform of ['satp', 'github']) {
    insertVerification.run(`v-worker-low-${platform}`, 'worker-low', platform, `worker-low-${platform}`, '{}', '2026-09-22T00:00:00.000Z');
  }
  db.close();
}

async function api(baseUrl, method, route, { key, idempotencyKey, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(key ? { 'X-API-Key': key } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

function jobBody(title, overrides = {}) {
  return {
    title,
    description: 'A production-shaped staged marketplace lifecycle task.',
    category: 'development',
    skills: ['node', 'sqlite'],
    budgetType: 'fixed',
    budgetAmount: '1.000000001',
    budgetCurrency: 'SOL',
    timeline: '1w',
    pickupMode: 'select',
    minimumVerificationLevel: 2,
    minimumTrustScore: 50,
    ...overrides,
  };
}

async function createFundAccept(baseUrl, suffix) {
  const created = await api(baseUrl, 'POST', '/api/marketplace/jobs', {
    key: 'key-poster', body: jobBody(`V3 staged ${suffix}`),
  });
  assert.equal(created.status, 201);
  const jobId = created.body.id;
  const staged = await api(baseUrl, 'POST', `/api/marketplace/jobs/${jobId}/fund-staged`, {
    key: 'key-poster', idempotencyKey: `stage-${suffix}`, body: { amount: '1.000000001' },
  });
  assert.equal(staged.status, 201);
  assert.match(staged.body.escrowId, /^staged:[0-9a-f-]{36}$/);
  assert.equal(staged.body.liveEscrowWritesAllowed, false);
  const verified = await api(baseUrl, 'POST', `/api/marketplace/jobs/${jobId}/fund-staged/verify`, {
    key: 'key-poster', idempotencyKey: `verify-${suffix}`,
    body: { escrowReference: staged.body.escrowId, amount: '999999', verificationSource: 'client_claim_is_ignored' },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.amountMinor, '1000000001');
  assert.equal(verified.body.verificationSource, 'server_staged_escrow_readback');
  const applied = await api(baseUrl, 'POST', `/api/marketplace/jobs/${jobId}/apply`, {
    key: 'key-worker', body: { coverMessage: 'I can complete this staged lifecycle safely.', proposedBudget: '1.000000001' },
  });
  assert.equal(applied.status, 201);
  const selected = await api(baseUrl, 'POST', `/api/marketplace/applications/${applied.body.id}/select`, {
    key: 'key-poster', idempotencyKey: `select-${suffix}`, body: {},
  });
  assert.equal(selected.body.status, 'awarded');
  const accepted = await api(baseUrl, 'POST', `/api/marketplace/applications/${applied.body.id}/accept`, {
    key: 'key-worker', idempotencyKey: `accept-${suffix}`, body: {},
  });
  assert.equal(accepted.body.status, 'in_progress');
  return { jobId, applicationId: applied.body.id };
}

test('V3 staged lifecycle uses the production route factory without live funds or direct SQL state writes', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-v3-e2e-'));
  const dbPath = path.join(tmpDir, 'agentfolio.db');
  seedIdentityDatabase(dbPath);
  const clock = { now: '2026-09-23T12:00:00.000Z' };
  const priorAdmins = process.env.MARKETPLACE_ADMIN_PROFILE_IDS;
  process.env.MARKETPLACE_ADMIN_PROFILE_IDS = 'admin';
  const runtime = createMarketplaceV3Server({ dbPath, clock: () => clock.now });
  const server = await runtime.listen();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    runtime.close();
    if (priorAdmins === undefined) delete process.env.MARKETPLACE_ADMIN_PROFILE_IDS;
    else process.env.MARKETPLACE_ADMIN_PROFILE_IDS = priorAdmins;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await assert.rejects(
    runMarketplaceProductionSmoke({ baseUrl, env: {} }),
    (error) => error.code === 'PRODUCTION_SMOKE_FLAG_REQUIRED',
  );
  const beforeSmoke = runtime.getDb().prepare('SELECT COUNT(*) AS jobs, (SELECT COUNT(*) FROM job_transition_audit) AS transitions FROM jobs').get();
  const smoke = await runMarketplaceProductionSmoke({ baseUrl, env: { AGENTFOLIO_RUN_PRODUCTION_MARKETPLACE_SMOKE: '1' } });
  assert.equal(smoke.status, 200);
  assert.equal(smoke.liveEscrowWritesAllowed, false);
  assert.equal(smoke.moneyMoved, false);
  assert.equal(smoke.customerStateChanged, false);
  const afterSmoke = runtime.getDb().prepare('SELECT COUNT(*) AS jobs, (SELECT COUNT(*) FROM job_transition_audit) AS transitions FROM jobs').get();
  assert.deepEqual(afterSmoke, beforeSmoke);

  const rejectedReference = await api(baseUrl, 'POST', '/api/marketplace/jobs', {
    key: 'key-poster', body: jobBody('Server reference check'),
  });
  const rejectedStage = await api(baseUrl, 'POST', `/api/marketplace/jobs/${rejectedReference.body.id}/fund-staged`, {
    key: 'key-poster', idempotencyKey: 'client-reference-rejected',
    body: { amount: '1.000000001', escrowReference: 'client:chosen:reference' },
  });
  assert.equal(rejectedStage.status, 400);
  assert.equal(rejectedStage.body.code, 'SERVER_ESCROW_REFERENCE_REQUIRED');

  const happy = await createFundAccept(baseUrl, 'happy-path');
  const happyDelivery = await api(baseUrl, 'POST', `/api/marketplace/jobs/${happy.jobId}/deliverables`, {
    key: 'key-worker', idempotencyKey: 'deliver-happy', body: { text: 'Completed staged work for normal acceptance.', links: [] },
  });
  assert.equal(happyDelivery.status, 201);
  assert.equal(happyDelivery.body.status, 'submitted');
  const happyApproval = await api(baseUrl, 'POST', `/api/marketplace/jobs/${happy.jobId}/deliverables/${happyDelivery.body.deliverable.id}/approve`, {
    key: 'key-poster', idempotencyKey: 'approve-happy', body: {},
  });
  assert.equal(happyApproval.status, 200);
  assert.equal(happyApproval.body.status, 'approved');
  const happyRelease = await api(baseUrl, 'POST', `/api/marketplace/jobs/${happy.jobId}/release`, {
    key: 'key-poster', idempotencyKey: 'release-happy', body: {},
  });
  assert.equal(happyRelease.status, 200);
  assert.equal(happyRelease.body.status, 'released');
  assert.equal(happyRelease.body.executionMode, 'staged');
  assert.equal(happyRelease.body.moneyMoved, false);
  assert.equal(happyRelease.body.effect.amountMinor, '1000000001');
  assert.equal(happyRelease.body.effect.feeMinor, '50000000');
  assert.equal(happyRelease.body.effect.recipientMinor, '950000001');
  const happyClose = await api(baseUrl, 'POST', `/api/marketplace/jobs/${happy.jobId}/close`, {
    key: 'key-poster', idempotencyKey: 'close-happy', body: {},
  });
  assert.equal(happyClose.status, 200);
  assert.equal(happyClose.body.status, 'closed');
  assert.equal(happyClose.body.moneyMoved, false);
  const happyRead = await api(baseUrl, 'GET', `/api/marketplace/jobs/${happy.jobId}`);
  assert.equal(happyRead.body.status, 'closed');

  const disputed = await createFundAccept(baseUrl, 'dispute');
  const delivered = await api(baseUrl, 'POST', `/api/marketplace/jobs/${disputed.jobId}/deliverables`, {
    key: 'key-worker', idempotencyKey: 'deliver-dispute', body: { text: 'Completed work with evidence.', links: [] },
  });
  assert.equal(delivered.body.status, 'submitted');
  const disagreement = await api(baseUrl, 'POST', `/api/marketplace/jobs/${disputed.jobId}/disagreements`, {
    key: 'key-poster', idempotencyKey: 'raise-disagreement', body: { reason: 'The delivered scope does not match the accepted requirements.' },
  });
  assert.equal(disagreement.status, 201);
  assert.equal(disagreement.body.status, 'disputed');
  assert.equal(disagreement.body.moneyMoved, false);
  const forbiddenResolution = await api(baseUrl, 'POST', `/api/marketplace/jobs/${disputed.jobId}/disagreements/resolve`, {
    key: 'key-poster', idempotencyKey: 'resolve-forbidden',
    body: { resolution: 'worker', reason: 'The poster cannot resolve their own disagreement.' },
  });
  assert.equal(forbiddenResolution.status, 403);
  assert.equal(forbiddenResolution.body.code, 'MARKETPLACE_ADMIN_REQUIRED');
  const badSplit = await api(baseUrl, 'POST', `/api/marketplace/jobs/${disputed.jobId}/disagreements/resolve`, {
    key: 'key-admin', idempotencyKey: 'resolve-bad-split',
    body: { resolution: 'split', workerAmountMinor: '500000000', posterAmountMinor: '500000000', reason: 'This intentionally fails the exact total check.' },
  });
  assert.equal(badSplit.status, 409);
  assert.equal(badSplit.body.code, 'RESOLUTION_AMOUNT_MISMATCH');
  const resolution = await api(baseUrl, 'POST', `/api/marketplace/jobs/${disputed.jobId}/disagreements/resolve`, {
    key: 'key-admin', idempotencyKey: 'resolve-split',
    body: { resolution: 'split', workerAmountMinor: '600000001', posterAmountMinor: '400000000', reason: 'Evidence supports a precise staged split resolution.' },
  });
  assert.equal(resolution.body.status, 'cancelled_with_compensation');
  assert.equal(resolution.body.executionMode, 'staged');
  assert.equal(resolution.body.liveEscrowWritesAllowed, false);
  assert.equal(resolution.body.moneyMoved, false);
  assert.equal(resolution.body.resolution.workerAmountMinor, '600000001');
  assert.equal(resolution.body.resolution.posterAmountMinor, '400000000');
  const resolutionReplay = await api(baseUrl, 'POST', `/api/marketplace/jobs/${disputed.jobId}/disagreements/resolve`, {
    key: 'key-admin', idempotencyKey: 'resolve-split',
    body: { resolution: 'poster', reason: 'A replay cannot change the recorded staged outcome.' },
  });
  assert.equal(resolutionReplay.status, 200);
  assert.equal(resolutionReplay.body.replayed, true);
  assert.equal(resolutionReplay.body.resolution.workerAmountMinor, '600000001');

  for (const [outcome, expectedStatus] of [['worker', 'released'], ['poster', 'cancelled']]) {
    const variant = await createFundAccept(baseUrl, `dispute-${outcome}`);
    const variantDelivery = await api(baseUrl, 'POST', `/api/marketplace/jobs/${variant.jobId}/deliverables`, {
      key: 'key-worker', idempotencyKey: `deliver-dispute-${outcome}`, body: { text: `Disputed delivery resolved for ${outcome}.`, links: [] },
    });
    assert.equal(variantDelivery.status, 201);
    const raised = await api(baseUrl, 'POST', `/api/marketplace/jobs/${variant.jobId}/disagreements`, {
      key: 'key-poster', idempotencyKey: `raise-dispute-${outcome}`, body: { reason: `Exercise the ${outcome} resolution state transition.` },
    });
    assert.equal(raised.body.status, 'disputed');
    const resolved = await api(baseUrl, 'POST', `/api/marketplace/jobs/${variant.jobId}/disagreements/resolve`, {
      key: 'key-admin', idempotencyKey: `resolve-dispute-${outcome}`, body: { resolution: outcome, reason: `Canonical evidence supports the ${outcome} outcome.` },
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.status, expectedStatus);
    assert.equal(resolved.body.executionMode, 'staged');
    assert.equal(resolved.body.moneyMoved, false);
  }

  const silent = await createFundAccept(baseUrl, 'silent-poster');
  const silentDelivery = await api(baseUrl, 'POST', `/api/marketplace/jobs/${silent.jobId}/deliverables`, {
    key: 'key-worker', idempotencyKey: 'deliver-silent', body: { text: 'Accepted worker submitted final staged work.', links: [] },
  });
  assert.equal(silentDelivery.body.status, 'submitted');
  clock.now = '2026-09-30T12:00:00.001Z';
  const settled = autoApproveDueDeliverables(runtime.getDb(), { now: clock.now });
  assert.equal(settled.errors.length, 0, JSON.stringify(settled.errors));
  assert.equal(settled.results.length, 1);
  assert.equal(settled.results[0].status, 'auto_released');
  assert.equal(settled.results[0].executionMode, 'staged');
  assert.equal(settled.results[0].moneyMoved, false);
  const silentThread = await api(baseUrl, 'GET', `/api/marketplace/jobs/${silent.jobId}/thread`, { key: 'key-worker' });
  assert.equal(silentThread.body.escrowEffects.at(-1).effectType, 'release');
  assert.equal(silentThread.body.escrowEffects.at(-1).liveEscrowEnabled, false);

  clock.now = '2026-10-01T00:00:00.000Z';
  const expiring = await api(baseUrl, 'POST', '/api/marketplace/jobs', {
    key: 'key-poster', body: jobBody('Timed expiry job', { expiresAt: '2026-10-02T00:00:00.000Z' }),
  });
  assert.equal(expiring.status, 201);
  assert.deepEqual(expireDueJobs(runtime.getDb(), { now: clock.now }), { results: [], errors: [] });
  clock.now = '2026-10-02T00:00:00.000Z';
  const expired = expireDueJobs(runtime.getDb(), { now: clock.now });
  assert.deepEqual(expired.errors, []);
  assert.equal(expired.results.length, 1);
  assert.equal(expired.results[0].jobId, expiring.body.id);
  assert.equal(expired.results[0].status, 'expired');
  const expiredRead = await api(baseUrl, 'GET', `/api/marketplace/jobs/${expiring.body.id}`);
  assert.equal(expiredRead.body.status, 'expired');

  clock.now = '2026-10-03T00:00:00.000Z';
  const claimRace = await api(baseUrl, 'POST', '/api/marketplace/jobs', {
    key: 'key-poster', body: jobBody('Claim race guard', { pickupMode: 'claim' }),
  });
  assert.equal(claimRace.status, 201);
  const raceStaged = await api(baseUrl, 'POST', `/api/marketplace/jobs/${claimRace.body.id}/fund-staged`, {
    key: 'key-poster', idempotencyKey: 'stage-claim-race', body: { amount: '1.000000001' },
  });
  assert.equal(raceStaged.status, 201);
  const raceVerified = await api(baseUrl, 'POST', `/api/marketplace/jobs/${claimRace.body.id}/fund-staged/verify`, {
    key: 'key-poster', idempotencyKey: 'verify-claim-race', body: { escrowReference: raceStaged.body.escrowId },
  });
  assert.equal(raceVerified.status, 200);
  const ineligibleClaim = await api(baseUrl, 'POST', `/api/marketplace/jobs/${claimRace.body.id}/claim`, {
    key: 'key-worker-low', idempotencyKey: 'claim-low', body: {},
  });
  assert.equal(ineligibleClaim.status, 403);
  assert.equal(ineligibleClaim.body.code, 'CLAIM_INELIGIBLE_VERIFICATION_LEVEL');
  const claims = await Promise.all([
    api(baseUrl, 'POST', `/api/marketplace/jobs/${claimRace.body.id}/claim`, { key: 'key-worker', idempotencyKey: 'claim-worker', body: {} }),
    api(baseUrl, 'POST', `/api/marketplace/jobs/${claimRace.body.id}/claim`, { key: 'key-worker-b', idempotencyKey: 'claim-worker-b', body: {} }),
  ]);
  const winnerIndex = claims.findIndex((entry) => entry.status === 200);
  const loserIndex = claims.findIndex((entry) => entry.status === 409);
  assert.notEqual(winnerIndex, -1);
  assert.notEqual(loserIndex, -1);
  assert.equal(claims[loserIndex].body.code, 'JOB_ALREADY_CLAIMED');
  assert.equal(claims[loserIndex].body.selectedAgentId, undefined);
  assert.equal(claims[loserIndex].body.retryable, false);
  const claimKeys = ['key-worker', 'key-worker-b'];
  const claimIds = ['claim-worker', 'claim-worker-b'];
  const acceptedClaim = await api(baseUrl, 'POST', `/api/marketplace/jobs/${claimRace.body.id}/claim/accept`, {
    key: claimKeys[winnerIndex], idempotencyKey: `${claimIds[winnerIndex]}-accept`, body: {},
  });
  assert.equal(acceptedClaim.body.status, 'in_progress');
  const unauthorizedAcceptReplay = await api(baseUrl, 'POST', `/api/marketplace/jobs/${claimRace.body.id}/claim/accept`, {
    key: claimKeys[loserIndex], idempotencyKey: `${claimIds[winnerIndex]}-accept`, body: {},
  });
  assert.equal(unauthorizedAcceptReplay.status, 403);
  assert.equal(unauthorizedAcceptReplay.body.code, 'APPLICATION_ACTOR_FORBIDDEN');

  const reopen = await api(baseUrl, 'POST', '/api/marketplace/jobs', {
    key: 'key-poster', body: jobBody('Claim return-path guard', { pickupMode: 'claim' }),
  });
  const reopenStaged = await api(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/fund-staged`, {
    key: 'key-poster', idempotencyKey: 'stage-claim-reopen', body: { amount: '1.000000001' },
  });
  assert.equal(reopenStaged.status, 201);
  const reopenVerified = await api(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/fund-staged/verify`, {
    key: 'key-poster', idempotencyKey: 'verify-claim-reopen', body: { escrowReference: reopenStaged.body.escrowId },
  });
  assert.equal(reopenVerified.status, 200);
  const firstClaim = await api(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim`, {
    key: 'key-worker', idempotencyKey: 'reopen-claim-worker', body: {},
  });
  assert.equal(firstClaim.body.status, 'awarded');
  const declined = await api(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim/decline`, {
    key: 'key-worker', idempotencyKey: 'reopen-decline-worker', body: {},
  });
  assert.equal(declined.body.status, 'open');
  const unauthorizedDeclineReplay = await api(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim/decline`, {
    key: 'key-worker-b', idempotencyKey: 'reopen-decline-worker', body: {},
  });
  assert.equal(unauthorizedDeclineReplay.status, 403);
  assert.equal(unauthorizedDeclineReplay.body.code, 'APPLICATION_ACTOR_FORBIDDEN');
  const secondClaim = await api(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim`, {
    key: 'key-worker-b', idempotencyKey: 'reopen-claim-worker-b', body: {},
  });
  assert.equal(secondClaim.body.status, 'awarded');
  clock.now = '2026-10-05T00:00:00.001Z';
  const timedOut = await api(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim/award-timeout`, {
    key: 'key-poster', idempotencyKey: 'reopen-timeout-worker-b', body: {},
  });
  assert.equal(timedOut.body.status, 'open');
  assert.equal(timedOut.body.outcome, 'timed_out');
  const unauthorizedTimeoutReplay = await api(baseUrl, 'POST', `/api/marketplace/jobs/${reopen.body.id}/claim/award-timeout`, {
    key: 'key-worker', idempotencyKey: 'reopen-timeout-worker-b', body: {},
  });
  assert.equal(unauthorizedTimeoutReplay.status, 403);
  assert.equal(unauthorizedTimeoutReplay.body.code, 'CLIENT_ACTION_FORBIDDEN');

  const db = runtime.getDb();
  const transitions = db.prepare('SELECT from_status, to_status, actor_id, source FROM job_transition_audit WHERE job_id = ? ORDER BY created_at, rowid').all(expiring.body.id);
  assert.deepEqual(transitions, [{ from_status: 'open', to_status: 'expired', actor_id: 'system:job-expiry', source: 'marketplace-job-expiry-timer' }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM marketplace_disagreement_resolutions').get().count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM marketplace_escrow_effects WHERE execution_mode <> 'staged' OR live_escrow_enabled <> 0").get().count, 0);
  assert.deepEqual(
    db.prepare(`
      SELECT subject_id, subject_role, outcome_type, polarity, settled_amount_minor
      FROM marketplace_outcome_ledger
      WHERE job_id = ?
      ORDER BY created_at, rowid
    `).all(reopen.body.id),
    [
      {
        subject_id: 'worker',
        subject_role: 'claimant',
        outcome_type: 'claim_award_declined',
        polarity: 'negative',
        settled_amount_minor: null,
      },
      {
        subject_id: 'worker-b',
        subject_role: 'claimant',
        outcome_type: 'claim_award_timed_out',
        polarity: 'negative',
        settled_amount_minor: null,
      },
    ],
  );
  const lifecycleSources = [
    'marketplace-job-routes.js',
    'marketplace-application-routes.js',
    'marketplace-delivery-routes.js',
  ].map((file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', file), 'utf8')).join('\n');
  assert.doesNotMatch(lifecycleSources, /\b(?:Keypair|privateKey|secretKey|sendTransaction|sendRawTransaction|signTransaction|build\w*Tx|relayTransaction)\b/);
});
