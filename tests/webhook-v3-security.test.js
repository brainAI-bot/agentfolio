'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const express = require('express');
const Database = require('better-sqlite3');
const { registerWebhookRoutes } = require('../src/routes/webhook-routes');
const {
  deliverWebhook,
  verifyWebhookSignature,
  createWebhookReplayCache,
  registerWebhook,
} = require('../src/lib/webhooks');
const {
  verifyWebhookSignature: verifySdkWebhookSignature,
  createWebhookReplayCache: createSdkReplayCache,
} = require('../sdk');

function listen(server) {
  return new Promise((resolve, reject) => {
    const listener = server.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function memoryWebhookService() {
  const records = [];
  return {
    EVENTS: { PROFILE_UPDATED: 'profile.updated' },
    registerWebhook(url, events, options) {
      const webhook = { id: `wh_${records.length + 1}`, url, events, ownerId: options.ownerId, description: options.description || '', secret: 'whsec_test', active: true };
      records.push(webhook);
      return { webhook };
    },
    listWebhooks(showSecrets, ownerId) {
      return records.filter((entry) => entry.ownerId === ownerId).map((entry) => ({ ...entry, secret: showSecrets ? entry.secret : 'whsec_test...' }));
    },
    getWebhook(id, showSecret, ownerId) {
      const entry = records.find((item) => item.id === id && item.ownerId === ownerId);
      return entry ? { ...entry, secret: showSecret ? entry.secret : 'whsec_test...' } : null;
    },
    updateWebhook(id, updates, ownerId) {
      const entry = records.find((item) => item.id === id && item.ownerId === ownerId);
      if (!entry) return { error: 'Webhook not found' };
      Object.assign(entry, updates);
      return { webhook: entry };
    },
    deleteWebhook(id, ownerId) {
      const index = records.findIndex((item) => item.id === id && item.ownerId === ownerId);
      if (index < 0) return { error: 'Webhook not found' };
      records.splice(index, 1);
      return { success: true };
    },
    getWebhookLogs(id, _limit, ownerId) { return this.getWebhook(id, false, ownerId) ? [] : null; },
    getDeadLetters() { return []; },
    clearDeadLetters() { return { cleared: true }; },
    async testWebhook(id, ownerId) { return this.getWebhook(id, false, ownerId) ? { result: { success: true } } : { error: 'Webhook not found' }; },
  };
}

test('webhook registration routes require auth and scope records to the API-key owner', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE profiles (id TEXT PRIMARY KEY, api_key TEXT UNIQUE)');
  db.prepare('INSERT INTO profiles (id, api_key) VALUES (?, ?), (?, ?)').run('owner-a', 'key-a', 'owner-b', 'key-b');
  const app = express();
  app.use(express.json());
  registerWebhookRoutes(app, { getDb: () => db, service: memoryWebhookService() });
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const unauthenticated = await fetch(`${baseUrl}/api/webhooks`);
    assert.equal(unauthenticated.status, 401);

    const created = await fetch(`${baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'key-a' },
      body: JSON.stringify({ url: 'https://example.com/hooks', events: ['profile.updated'] }),
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.webhook.ownerId, 'owner-a');
    assert.equal(createdBody.webhook.secret, 'whsec_test');

    const ownerList = await fetch(`${baseUrl}/api/webhooks`, { headers: { 'X-API-Key': 'key-a' } }).then((response) => response.json());
    const otherList = await fetch(`${baseUrl}/api/webhooks`, { headers: { 'X-API-Key': 'key-b' } }).then((response) => response.json());
    assert.equal(ownerList.webhooks.length, 1);
    assert.equal(ownerList.webhooks[0].secret, 'whsec_test...');
    assert.equal(otherList.webhooks.length, 0);

    const crossOwnerRead = await fetch(`${baseUrl}/api/webhooks/${createdBody.webhook.id}`, { headers: { 'X-API-Key': 'key-b' } });
    assert.equal(crossOwnerRead.status, 404);
  } finally {
    await close(server);
    db.close();
  }
});

test('webhook registration rejects credential-bearing and private callback URLs', () => {
  assert.match(registerWebhook('http://127.0.0.1/hook', ['profile.updated']).error, /public destination/);
  assert.match(registerWebhook('https://user:pass@example.com/hook', ['profile.updated']).error, /credentials/);
  assert.match(registerWebhook('https://example.com/hook', 'profile.updated').error, /array/);
});

test('signed webhook retries preserve exact body, delivery ID, timestamp, and signature', async () => {
  const attempts = [];
  const request = (options, onResponse) => {
    const chunks = [];
    const req = new EventEmitter();
    req.write = (chunk) => chunks.push(Buffer.from(chunk));
    req.end = () => {
      const headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value]));
      attempts.push({ headers, body: Buffer.concat(chunks) });
      const res = new EventEmitter();
      res.statusCode = attempts.length < 3 ? 500 : 204;
      res.resume = () => {};
      onResponse(res);
      queueMicrotask(() => res.emit('end'));
    };
    req.destroy = () => {};
    return req;
  };
  const webhook = {
    id: 'wh_retry',
    url: 'https://example.com/receiver',
    secret: 'whsec_retry_test',
  };
  const result = await deliverWebhook(webhook, 'profile.updated', { text: 'spacing matters', nested: { value: 1 } }, { baseDelayMs: 1, request });
  assert.equal(result.success, true);
  assert.equal(attempts.length, 3);
  for (const attempt of attempts.slice(1)) {
    assert.deepEqual(attempt.body, attempts[0].body);
    assert.equal(attempt.headers['x-agentfolio-delivery'], attempts[0].headers['x-agentfolio-delivery']);
    assert.equal(attempt.headers['x-agentfolio-timestamp'], attempts[0].headers['x-agentfolio-timestamp']);
    assert.equal(attempt.headers['x-agentfolio-signature'], attempts[0].headers['x-agentfolio-signature']);
  }

  const headers = attempts[0].headers;
  const now = Number(headers['x-agentfolio-timestamp']) * 1000;
  const verified = verifyWebhookSignature({
    rawBody: attempts[0].body,
    secret: webhook.secret,
    signature: headers['x-agentfolio-signature'],
    timestamp: headers['x-agentfolio-timestamp'],
    deliveryId: headers['x-agentfolio-delivery'],
  }, { now, replayCache: createWebhookReplayCache() });
  assert.equal(verified.valid, true);

  const replayCache = createWebhookReplayCache();
  const verificationInput = {
    rawBody: attempts[0].body,
    secret: webhook.secret,
    signature: headers['x-agentfolio-signature'],
    timestamp: headers['x-agentfolio-timestamp'],
    deliveryId: headers['x-agentfolio-delivery'],
  };
  assert.equal(verifyWebhookSignature(verificationInput, { now, replayCache }).valid, true);
  assert.equal(verifyWebhookSignature(verificationInput, { now, replayCache }).code, 'REPLAY_DETECTED');
  assert.equal(verifyWebhookSignature({ ...verificationInput, signature: '' }, { now, replayCache: createWebhookReplayCache() }).code, 'INVALID_SIGNATURE_FORMAT');
  assert.equal(verifyWebhookSignature({ ...verificationInput, rawBody: Buffer.from(`${attempts[0].body.toString()} `) }, { now, replayCache: createWebhookReplayCache() }).code, 'SIGNATURE_MISMATCH');
  assert.equal(verifyWebhookSignature(verificationInput, { now: now + 301_000, replayCache: createWebhookReplayCache() }).code, 'TIMESTAMP_OUTSIDE_TOLERANCE');

  const sdkReplayCache = createSdkReplayCache();
  assert.equal(verifySdkWebhookSignature(attempts[0].body, headers, webhook.secret, { now, replayCache: sdkReplayCache }).valid, true);
  assert.equal(verifySdkWebhookSignature(attempts[0].body, headers, webhook.secret, { now, replayCache: sdkReplayCache }).code, 'REPLAY_DETECTED');
  assert.equal(verifySdkWebhookSignature(Buffer.from('{}'), headers, webhook.secret, { now, replayCache: createSdkReplayCache() }).code, 'SIGNATURE_MISMATCH');
});
