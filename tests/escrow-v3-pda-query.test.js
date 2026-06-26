const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const escrowV3Routes = require('../src/routes/escrow-v3-routes');

function startApp() {
  const app = express();
  app.use('/api/v3/escrow', escrowV3Routes);
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test('GET /api/v3/escrow/pda/derive derives a PDA without requiring the full SDK', async () => {
  const app = await startApp();
  try {
    const url = new URL('/api/v3/escrow/pda/derive', app.baseUrl);
    url.searchParams.set('client', '11111111111111111111111111111111');
    url.searchParams.set('description', 'hq-rc4-smoke');
    url.searchParams.set('nonce', '0');

    const res = await fetch(url);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.client, '11111111111111111111111111111111');
    assert.equal(body.descriptionHash, '781ce5cbc2ed3de507052d8ab05f89fd8faf696131abf0cca82795d3c6f03836');
    assert.equal(body.nonce, 0);
    assert.equal(body.network, 'mainnet');
    assert.match(body.escrowPDA, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.equal(typeof body.bump, 'number');
  } finally {
    await app.close();
  }
});

test('GET /api/v3/escrow/pda/derive rejects repeated query params', async () => {
  const app = await startApp();
  try {
    const res = await fetch(`${app.baseUrl}/api/v3/escrow/pda/derive?client=11111111111111111111111111111111&description=one&description=two`);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.error, 'Missing required query params');
  } finally {
    await app.close();
  }
});
