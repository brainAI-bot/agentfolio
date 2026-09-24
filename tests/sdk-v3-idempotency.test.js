'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { AgentFolio } = require('../sdk');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('SDK V3 methods use canonical routes and explicit stable idempotency keys', async () => {
  const sdk = new AgentFolio({ apiKey: 'test-key' });
  const calls = [];
  sdk._request = async (method, route, options) => { calls.push({ method, route, options }); return {}; };

  await sdk.marketplace.claim('job/claim', { idempotencyKey: 'claim-key' });
  await sdk.marketplace.stageFunding('job/fund', '1.000000001', { idempotencyKey: 'fund-key' });
  await sdk.marketplace.verifyStagedFunding('job/fund', 'staged:abc', { idempotencyKey: 'verify-key' });
  await sdk.marketplace.settle('job/settle', { idempotencyKey: 'settle-key' });
  await sdk.marketplace.close('job/close', { idempotencyKey: 'close-key' });

  assert.deepEqual(calls.map(({ method, route, options }) => [method, route, options.idempotencyKey, options.body]), [
    ['POST', '/api/marketplace/jobs/job%2Fclaim/claim', 'claim-key', undefined],
    ['POST', '/api/marketplace/jobs/job%2Ffund/fund-staged', 'fund-key', { amount: '1.000000001' }],
    ['POST', '/api/marketplace/jobs/job%2Ffund/fund-staged/verify', 'verify-key', { escrowReference: 'staged:abc' }],
    ['POST', '/api/marketplace/jobs/job%2Fsettle/release', 'settle-key', undefined],
    ['POST', '/api/marketplace/jobs/job%2Fclose/close', 'close-key', undefined],
  ]);
});

test('SDK automatic retry preserves Idempotency-Key and exact serialized body', async () => {
  const attempts = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      attempts.push({ key: req.headers['idempotency-key'], body, url: req.url });
      res.setHeader('Content-Type', 'application/json');
      if (attempts.length === 1) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'retry' }));
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
  });
  await listen(server);
  try {
    const sdk = new AgentFolio({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: 'test-key' });
    const result = await sdk.marketplace.stageFunding('job-1', '1.000000001');
    assert.deepEqual(result, { ok: true });
    assert.equal(attempts.length, 2);
    assert.ok(attempts[0].key);
    assert.equal(attempts[1].key, attempts[0].key);
    assert.equal(attempts[1].body, attempts[0].body);
    assert.equal(attempts[1].url, attempts[0].url);
  } finally {
    await close(server);
  }
});
