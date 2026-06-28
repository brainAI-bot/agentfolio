const test = require('node:test');
const assert = require('node:assert/strict');
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

test('GET /api/v3/escrow/pda/derive derives a PDA from scalar query params', async () => {
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
    assert.match(body.escrowPDA, /^[1-9A-HJ-NP-Za-km-z]+$/);
    assert.equal(body.client, VALID_CLIENT);
    assert.equal(body.nonce, 0);
    assert.equal(body.network, 'mainnet');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('POST /api/v3/escrow/create is gated before live-funds release', async () => {
  const previousEnable = process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  const previousKill = process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
  delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
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
    assert.equal(body.enableWith, 'AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES');
    assert.equal(body.killSwitchEnv, 'AGENTFOLIO_ESCROW_KILL_SWITCH');
  } finally {
    if (previousEnable === undefined) delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    else process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = previousEnable;
    if (previousKill === undefined) delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
    else process.env.AGENTFOLIO_ESCROW_KILL_SWITCH = previousKill;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('GET /api/v3/escrow/health exposes live escrow gate status', async () => {
  const previousEnable = process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  const previousKill = process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
  process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = '1';
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
    assert.equal(body.liveEscrow.killSwitchActive, true);
    assert.equal(body.liveEscrow.enableWith, 'AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES');
    assert.equal(body.liveEscrow.killSwitchEnv, 'AGENTFOLIO_ESCROW_KILL_SWITCH');
  } finally {
    if (previousEnable === undefined) delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    else process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = previousEnable;
    if (previousKill === undefined) delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
    else process.env.AGENTFOLIO_ESCROW_KILL_SWITCH = previousKill;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
