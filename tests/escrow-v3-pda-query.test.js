const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');

const escrowV3Router = require('../src/routes/escrow-v3-routes');

const VALID_CLIENT = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const VALID_AGENT = '11111111111111111111111111111112';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET /api/v3/escrow/pda/derive rejects duplicate query params before hashing', async () => {
  const app = express();
  app.use('/api/v3/escrow', escrowV3Router);
  const server = await listen(app);

  try {
    const { port } = server.address();
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v3/escrow/pda/derive?clientWallet=${VALID_CLIENT}&description=one&description=two`,
    );
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error, 'Missing required query params');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET /api/v3/escrow/pda/derive derives a mainnet escrow PDA', async () => {
  const app = express();
  app.use('/api/v3/escrow', escrowV3Router);
  const server = await listen(app);

  try {
    const { port } = server.address();
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v3/escrow/pda/derive?clientWallet=${VALID_CLIENT}&description=one&nonce=0`,
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.network, 'mainnet');
    assert.equal(body.client, VALID_CLIENT);
    assert.equal(body.nonce, 0);
    assert.equal(body.descriptionHash, crypto.createHash('sha256').update('one').digest('hex'));
    assert.match(body.escrowPDA, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.equal(Number.isInteger(body.bump), true);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('POST /api/v3/escrow/create is gated before live-funds release', async () => {
  const previousEnable = process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  const previousOwnerAuthorization = process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
  const previousKill = process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
  delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  delete process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
  delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;

  const app = express();
  app.use(express.json());
  app.use('/api/v3/escrow', escrowV3Router);
  const server = await listen(app);

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/v3/escrow/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientWallet: VALID_CLIENT,
        agentWallet: VALID_AGENT,
        agentId: 'agent_test',
        amountLamports: 1,
        description: 'non-release gate smoke',
        deadlineUnix: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 423);
    assert.equal(body.code, 'LIVE_ESCROW_WRITES_READ_ONLY');
    assert.equal(body.liveEscrow.status, 'live_funds_gated_pending_security_review');
    assert.equal(body.liveEscrow.ownerAuthorization.required, true);
    assert.equal(body.liveEscrow.ownerAuthorization.status, 'missing_owner_authorization');
    assert.equal(body.liveEscrow.verifiedRuntime.network, 'devnet');
    assert.equal(body.liveEscrow.mainnetLiveFundsCleared, false);
    assert.equal(body.enableWith, 'AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES');
    assert.equal(body.killSwitchEnv, 'AGENTFOLIO_ESCROW_KILL_SWITCH');
  } finally {
    if (previousEnable === undefined) delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    else process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = previousEnable;
    if (previousOwnerAuthorization === undefined) delete process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
    else process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION = previousOwnerAuthorization;
    if (previousKill === undefined) delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
    else process.env.AGENTFOLIO_ESCROW_KILL_SWITCH = previousKill;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET /api/v3/escrow/health exposes live escrow gate status', async () => {
  const previousEnable = process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  const previousOwnerAuthorization = process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
  const previousKill = process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
  process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = '1';
  delete process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
  process.env.AGENTFOLIO_ESCROW_KILL_SWITCH = '1';

  const app = express();
  app.use('/api/v3/escrow', escrowV3Router);
  const server = await listen(app);

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/v3/escrow/health`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.liveEscrow.enabled, false);
    assert.equal(body.liveEscrow.requested, true);
    assert.equal(body.liveEscrow.ownerAuthorized, false);
    assert.equal(body.liveEscrow.killSwitchActive, true);
    assert.equal(body.liveEscrow.status, 'live_funds_blocked_by_kill_switch');
    assert.equal(body.liveEscrow.ownerAuthorization.env, 'AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION');
    assert.equal(body.liveEscrow.ownerAuthorization.status, 'missing_owner_authorization');
    assert.match(body.liveEscrow.readOnlyPosture, /GET health and PDA derivation routes remain read-only HTTP 200/);
    assert.equal(body.liveEscrow.verifiedRuntime.network, 'devnet');
    assert.equal(body.liveEscrow.mainnetLiveFundsCleared, false);
    assert.equal(body.liveEscrow.enableWith, 'AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES');
    assert.equal(body.liveEscrow.killSwitchEnv, 'AGENTFOLIO_ESCROW_KILL_SWITCH');
    assert.equal(body.escrowAuthority.expectedProgramId, 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C');
    assert.equal(body.escrowAuthority.status, 'blocked_pending_authoritative_source_idl');
    assert.equal(body.escrowAuthority.releaseGate.liveEscrowWritesAllowed, false);
    assert.equal(body.escrowAuthority.releaseGate.ownerAuthorizationRequired, true);
    assert.equal(body.escrowAuthority.releaseGate.ownerAuthorizationStatus, 'missing_owner_authorization');
    assert.match(body.escrowAuthority.releaseGate.reason, /PDA reads may derive/);
    assert.equal(body.escrowProvenance.escrowProgramId, 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C');
    assert.equal(typeof body.escrowProvenance.artifactCommit, 'string');
    assert.ok(body.escrowProvenance.artifactCommit.length > 0);
    assert.match(body.escrowProvenance.sourceHash, /^[0-9a-f]{64}$/);
    assert.match(body.escrowProvenance.idlHash, /^[0-9a-f]{64}$/);
    assert.match(body.escrowProvenance.runtimeProgramId, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.equal(body.escrowProvenance.mismatchStatus, 'matched');
    assert.equal(body.escrowProvenance.failClosed, false);
    assert.equal(body.escrowProvenance.liveEscrowWritesAllowed, false);
  } finally {
    if (previousEnable === undefined) delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    else process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = previousEnable;
    if (previousOwnerAuthorization === undefined) delete process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
    else process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION = previousOwnerAuthorization;
    if (previousKill === undefined) delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
    else process.env.AGENTFOLIO_ESCROW_KILL_SWITCH = previousKill;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
