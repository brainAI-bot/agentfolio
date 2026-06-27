const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const escrowV3Router = require('../src/routes/escrow-v3-routes');

const VALID_CLIENT = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';

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
