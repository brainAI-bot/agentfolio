'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const nacl = require('tweetnacl');
const { PublicKey } = require('@solana/web3.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-trust-write-auth-'));
const dbPath = path.join(tempDir, 'agentfolio.db');
process.env.AGENTFOLIO_DB_PATH = dbPath;

const profileStore = require('../src/profile-store');
const { registerReviewsV2Routes } = require('../src/api/reviews-v2');

async function request(baseUrl, method, routePath, body, headers = {}) {
  const options = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
  };
  if (!['GET', 'HEAD'].includes(method)) options.body = JSON.stringify(body);
  const response = await fetch(`${baseUrl}${routePath}`, options);
  return { status: response.status, body: await response.json() };
}

function signChallenge(challenge, signer) {
  return {
    ...challenge,
    signature: Buffer.from(
      nacl.sign.detached(Buffer.from(challenge.message), signer.secretKey)
    ).toString('base64'),
  };
}

function createHarness() {
  const app = express();
  app.use(express.json());
  profileStore.registerRoutes(app);
  registerReviewsV2Routes(app, { dbPath });

  const db = profileStore.getDb();
  const ownerSigner = nacl.sign.keyPair();
  const attackerSigner = nacl.sign.keyPair();
  const ownerWallet = new PublicKey(ownerSigner.publicKey).toBase58();
  const attackerWallet = new PublicKey(attackerSigner.publicKey).toBase58();
  db.prepare('INSERT INTO profiles (id, name, api_key, wallet) VALUES (?, ?, ?, ?)')
    .run('agent_owner', 'Owner', 'owner-key', ownerWallet);
  db.prepare('INSERT INTO profiles (id, name, api_key, wallet) VALUES (?, ?, ?, ?)')
    .run('agent_attacker', 'Attacker', 'attacker-key', attackerWallet);
  db.prepare(`
    INSERT INTO reviews (id, profile_id, reviewer_id, rating, comment)
    VALUES (?, ?, ?, ?, ?)
  `).run('review-1', 'agent_owner', 'agent_attacker', 5, 'real review');

  const server = app.listen(0);
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    server,
    db,
    ownerSigner,
  };
}

const harness = createHarness();

test.after(async () => {
  await new Promise((resolve) => harness.server.close(resolve));
  profileStore.closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('body-asserted endorsement and review-response actors are rejected without writes', async () => {
  const endorsementBefore = harness.db.prepare('SELECT COUNT(*) AS count FROM endorsements').get().count;
  const endorsement = await request(
    harness.baseUrl,
    'POST',
    '/api/profile/agent_owner/endorsements',
    { endorser_id: 'agent_owner', endorser_name: 'Owner', skill: 'security', weight: 99 }
  );
  assert.equal(endorsement.status, 403);
  assert.equal(endorsement.body.next, '/api/reviews/challenge then /api/reviews/submit');
  assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM endorsements').get().count, endorsementBefore);

  const response = await request(
    harness.baseUrl,
    'POST',
    '/api/reviews/review-1/respond',
    { responder_id: 'agent_owner', response_text: 'forged response' }
  );
  assert.equal(response.status, 403);
  assert.equal(response.body.next, '/api/reviews/challenge then /api/reviews/submit');
  const review = harness.db.prepare('SELECT has_response, response_text FROM reviews WHERE id = ?').get('review-1');
  assert.equal(Number(review.has_response || 0), 0);
  assert.equal(review.response_text, null);
});

test('legacy constant profile signature is rejected and wallet challenge is single-use', async () => {
  const legacyMessage = Buffer.from('agentfolio-edit:agent_owner');
  const legacySignature = Buffer.from(
    nacl.sign.detached(legacyMessage, harness.ownerSigner.secretKey)
  ).toString('base64');
  const ownerWallet = new PublicKey(harness.ownerSigner.publicKey).toBase58();
  const legacy = await request(
    harness.baseUrl,
    'PATCH',
    '/api/profile/agent_owner',
    { actorId: 'agent_owner', description: 'legacy replay must not land' },
    { 'x-wallet-address': ownerWallet, 'x-wallet-signature': legacySignature }
  );
  assert.equal(legacy.status, 401);
  assert.notEqual(harness.db.prepare('SELECT description FROM profiles WHERE id = ?').get('agent_owner').description, 'legacy replay must not land');

  const assertedActor = await request(
    harness.baseUrl,
    'PATCH',
    '/api/profile/agent_owner',
    { actorId: 'agent_owner', description: 'attacker write must not land' },
    { 'x-api-key': 'attacker-key' }
  );
  assert.equal(assertedActor.status, 403);
  assert.notEqual(
    harness.db.prepare('SELECT description FROM profiles WHERE id = ?').get('agent_owner').description,
    'attacker write must not land'
  );

  const editBody = { actorId: 'agent_owner', description: 'challenge-authorized edit' };
  const challenge = await request(harness.baseUrl, 'POST', '/api/marketplace/auth/challenge', {
    action: 'profile.edit',
    resourceId: 'agent_owner',
    actorId: 'agent_owner',
    method: 'PATCH',
    path: '/api/profile/agent_owner',
    body: editBody,
  });
  assert.equal(challenge.status, 201, JSON.stringify(challenge.body));
  const walletChallenge = signChallenge(challenge.body, harness.ownerSigner);
  const first = await request(
    harness.baseUrl,
    'PATCH',
    '/api/profile/agent_owner',
    { ...editBody, walletChallenge }
  );
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(harness.db.prepare('SELECT description FROM profiles WHERE id = ?').get('agent_owner').description, editBody.description);

  const replay = await request(
    harness.baseUrl,
    'PATCH',
    '/api/profile/agent_owner',
    { ...editBody, walletChallenge }
  );
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'AUTH_CHALLENGE_USED_OR_EXPIRED');
  assert.equal(harness.db.prepare('SELECT description FROM profiles WHERE id = ?').get('agent_owner').description, editBody.description);
});

test('fixture endorsement rows stay stored but are excluded from public reads', async () => {
  harness.db.prepare(`
    INSERT INTO endorsements (id, profile_id, endorser_id, endorser_name, skill, comment, weight)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('end-real', 'agent_owner', 'agent_real', 'Real Agent', 'security', 'production outcome', 1);
  harness.db.prepare(`
    INSERT INTO endorsements (id, profile_id, endorser_id, endorser_name, skill, comment, weight)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('end-fixture', 'agent_owner', 'agent_braintest', 'Test Agent', 'security', 'Phase 1 endorsement flow test', 1);

  const list = await request(harness.baseUrl, 'GET', '/api/profile/agent_owner/endorsements', {});
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.endorsements.map((row) => row.id), ['end-real']);
  assert.equal(list.body.total, 1);
});
