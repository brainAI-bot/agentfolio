'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const nacl = require('tweetnacl');
const { PublicKey } = require('@solana/web3.js');
const {
  CHALLENGE_TTL_MS,
  createMarketplaceAuth,
  issueChallenge,
  profileWallet,
  registerMarketplaceAuthChallengeRoute,
} = require('../src/lib/marketplace-wallet-auth');

async function jsonRequest(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function createHarness() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      api_key TEXT,
      wallet TEXT,
      wallets TEXT,
      verification_data TEXT
    )
  `);
  const signer = nacl.sign.keyPair();
  const wallet = new PublicKey(signer.publicKey).toBase58();
  db.prepare('INSERT INTO profiles (id, wallet, wallets, verification_data) VALUES (?, ?, ?, ?)')
    .run('actor', 'not-a-solana-key', JSON.stringify({ solana: wallet }), JSON.stringify({ solana: { address: 'also-invalid' } }));
  db.prepare('INSERT INTO profiles (id, wallet, wallets, verification_data) VALUES (?, ?, ?, ?)')
    .run('invalid-actor', '0x1234', JSON.stringify({ solana: 'bad' }), '{}');

  const app = express();
  app.use(express.json());
  registerMarketplaceAuthChallengeRoute(app, { getDb: () => db });
  const authorize = createMarketplaceAuth({ getDb: () => db, actorProperty: 'actor' });
  let mutations = 0;
  const comment = (req, res) => { mutations += 1; res.json({ ok: true, actor: req.actor }); };
  for (const path of ['/api/marketplace/jobs/:jobId/comments', '/api/jobs/:jobId/comments']) {
    app.post(path, authorize({ action: 'comment', resourceId: (req) => req.params.jobId }), comment);
  }
  app.post(
    '/api/marketplace/jobs/:jobId/approve',
    authorize({ action: 'approve', resourceId: (req) => req.body.deliverableId }),
    (req, res) => { mutations += 1; res.json({ ok: true, actor: req.actor }); },
  );
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const issue = async ({ action = 'comment', resourceId = 'job-1', path = '/api/marketplace/jobs/job-1/comments', body = { actorId: 'actor', text: 'original' }, actorId = 'actor' } = {}) => {
    const result = await jsonRequest(baseUrl, '/api/marketplace/auth/challenge', {
      action, resourceId, actorId, method: 'POST', path, body,
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  const signed = (challenge) => ({
    ...challenge,
    signature: Buffer.from(nacl.sign.detached(Buffer.from(challenge.message), signer.secretKey)).toString('base64'),
  });
  return { db, server, baseUrl, issue, signed, wallet, mutationCount: () => mutations };
}

async function closeHarness(harness) {
  await new Promise((resolve) => harness.server.close(resolve));
  harness.db.close();
}

test('wallet challenge is short-lived, single-use, and binds the canonical request body', async () => {
  const harness = createHarness();
  try {
    const requestBody = { actorId: 'actor', text: 'original' };
    const challenge = await harness.issue({ body: requestBody });
    assert.equal(new Date(challenge.expiresAt).getTime() - new Date(challenge.issuedAt).getTime(), CHALLENGE_TTL_MS);
    assert.match(challenge.nonce, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(challenge.message, /method:POST\npath:\/api\/marketplace\/jobs\/job-1\/comments/);
    assert.match(challenge.message, /bodySHA256:[a-f0-9]{64}$/);

    const first = await jsonRequest(harness.baseUrl, challenge.path, { ...requestBody, walletChallenge: harness.signed(challenge) });
    assert.equal(first.status, 200);
    assert.equal(harness.mutationCount(), 1);

    const replay = await jsonRequest(harness.baseUrl, challenge.path, { ...requestBody, walletChallenge: harness.signed(challenge) });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'AUTH_CHALLENGE_USED_OR_EXPIRED');
    assert.equal(harness.mutationCount(), 1);

    const alteredChallenge = await harness.issue({ body: requestBody });
    const altered = await jsonRequest(harness.baseUrl, alteredChallenge.path, {
      actorId: 'actor', text: 'attacker changed this', walletChallenge: harness.signed(alteredChallenge),
    });
    assert.equal(altered.status, 401);
    assert.equal(altered.body.code, 'AUTH_INVALID');
    assert.equal(harness.mutationCount(), 1);

    const expiredChallenge = issueChallenge(harness.db, {
      action: 'comment', resourceId: 'job-1', actorId: 'actor', method: 'POST',
      path: '/api/marketplace/jobs/job-1/comments', body: requestBody,
    }, new Date('2000-01-01T00:00:00.000Z'));
    const expired = await jsonRequest(harness.baseUrl, expiredChallenge.path, {
      ...requestBody, walletChallenge: harness.signed(expiredChallenge),
    });
    assert.equal(expired.status, 401);
    assert.equal(expired.body.code, 'AUTH_CHALLENGE_USED_OR_EXPIRED');
    assert.equal(harness.mutationCount(), 1);
  } finally {
    await closeHarness(harness);
  }
});

test('wallet challenge rejects an altered alias path and exact resource identifier', async () => {
  const harness = createHarness();
  try {
    const body = { actorId: 'actor', text: 'same body' };
    const pathChallenge = await harness.issue({ body });
    const wrongPath = await jsonRequest(harness.baseUrl, '/api/jobs/job-1/comments', {
      ...body, walletChallenge: harness.signed(pathChallenge),
    });
    assert.equal(wrongPath.status, 401);
    assert.equal(wrongPath.body.code, 'AUTH_INVALID');

    const approvalBody = { actorId: 'actor', deliverableId: 'deliverable-2' };
    const resourceChallenge = await harness.issue({
      action: 'approve',
      resourceId: 'deliverable-1',
      path: '/api/marketplace/jobs/job-1/approve',
      body: approvalBody,
    });
    const wrongResource = await jsonRequest(harness.baseUrl, resourceChallenge.path, {
      ...approvalBody, walletChallenge: harness.signed(resourceChallenge),
    });
    assert.equal(wrongResource.status, 401);
    assert.equal(wrongResource.body.code, 'AUTH_INVALID');

    const missingResourceBody = { actorId: 'actor' };
    const missingResourceChallenge = await harness.issue({
      action: 'approve', resourceId: 'undefined',
      path: '/api/marketplace/jobs/job-1/approve', body: missingResourceBody,
    });
    const missingResource = await jsonRequest(harness.baseUrl, missingResourceChallenge.path, {
      ...missingResourceBody, walletChallenge: harness.signed(missingResourceChallenge),
    });
    assert.equal(missingResource.status, 401);
    assert.equal(missingResource.body.code, 'AUTH_INVALID');
    assert.equal(harness.mutationCount(), 0);
  } finally {
    await closeHarness(harness);
  }
});

test('profile wallet selection skips malformed candidates and missing authority is a 403', async () => {
  const harness = createHarness();
  try {
    const profile = harness.db.prepare('SELECT * FROM profiles WHERE id = ?').get('actor');
    assert.equal(profileWallet(profile), harness.wallet);
    const invalid = harness.db.prepare('SELECT * FROM profiles WHERE id = ?').get('invalid-actor');
    assert.equal(profileWallet(invalid), null);

    const response = await jsonRequest(harness.baseUrl, '/api/marketplace/auth/challenge', {
      action: 'comment', resourceId: 'job-1', actorId: 'invalid-actor', method: 'POST',
      path: '/api/marketplace/jobs/job-1/comments', body: { actorId: 'invalid-actor', text: 'x' },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'AUTH_INVALID');
  } finally {
    await closeHarness(harness);
  }
});
