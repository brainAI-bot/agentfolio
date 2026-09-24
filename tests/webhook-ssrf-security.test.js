'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const express = require('express');
const Database = require('better-sqlite3');
const { registerWebhookRoutes } = require('../src/routes/webhook-routes');
const {
  createSafeLookup,
  singleDeliver,
  validateWebhookUrl,
} = require('../src/lib/webhooks');

const SSRF_BYPASSES = [
  ['http://[::ffff:127.0.0.1]:3100/', '::ffff:127.0.0.1', 6],
  ['http://[::ffff:a9fe:a9fe]/latest/meta-data/', '::ffff:a9fe:a9fe', 6],
  ['http://0.0.0.1:3100/', '0.0.0.1', 4],
  ['http://localtest.me:3100/', '127.0.0.1', 4],
  ['http://100.64.0.1/', '100.64.0.1', 4],
];

function listen(server) {
  return new Promise((resolve, reject) => {
    const listener = server.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function lookupResult(lookup, hostname, options = {}) {
  return new Promise((resolve) => {
    lookup(hostname, options, (error, address, family) => resolve({ error, address, family }));
  });
}

test('guarded lookup preserves the all-addresses DNS contract', async () => {
  const lookup = createSafeLookup((_hostname, options, callback) => {
    assert.equal(options.all, true);
    callback(null, [
      { address: '1.1.1.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  const result = await lookupResult(lookup, 'delivery.example', { all: true });
  assert.equal(result.error, null);
  assert.deepEqual(result.address, [
    { address: '1.1.1.1', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  assert.equal(result.family, undefined);
});

test('registration rejects literal, mapped, CGNAT, and loopback-alias SSRF bypasses', () => {
  for (const [url] of SSRF_BYPASSES) {
    assert.match(validateWebhookUrl(url).error || '', /public destination/, url);
  }
});

test('delivery lookup rejects every private resolution before a socket is opened', async () => {
  assert.equal(typeof createSafeLookup, 'function');
  for (const [url, address, family] of SSRF_BYPASSES) {
    const lookup = createSafeLookup((_hostname, _options, callback) => callback(null, address, family));
    const result = await lookupResult(lookup, new URL(url).hostname);
    assert.match(result.error?.message || '', /public destination/, url);
    assert.equal(result.address, undefined);
  }
});

test('single delivery wires the guarded lookup into the HTTP request', async () => {
  let resolverCalls = 0;
  const result = await singleDeliver({
    id: 'wh_ssrf',
    url: 'http://delivery.invalid/hook',
    secret: 'whsec_ssrf_test',
  }, 'profile.updated', {
    deliveryId: 'evt_ssrf',
    timestamp: 1,
    body: '{}',
  }, {
    dnsLookup(_hostname, _options, callback) {
      resolverCalls += 1;
      callback(null, '127.0.0.1', 4);
    },
  });

  assert.equal(resolverCalls, 1);
  assert.equal(result.success, false);
  assert.match(result.error, /public destination/);
});

test('single delivery preserves Node all-address lookup through a real HTTP request', async () => {
  const http = require('node:http');
  const server = await listen(http.createServer((request, response) => {
    assert.equal(request.url, '/hook');
    response.writeHead(204);
    response.end();
  }));

  try {
    const result = await singleDeliver({
      id: 'wh_real_request',
      url: `http://delivery.example:${server.address().port}/hook`,
      secret: 'whsec_real_request_test',
    }, 'profile.updated', {
      deliveryId: 'evt_real_request',
      timestamp: 1,
      body: '{}',
    }, {
      dnsLookup(_hostname, options, callback) {
        assert.equal(options.all, true);
        callback(null, [{ address: '127.0.0.1', family: 4 }]);
      },
      isAddressAllowed: () => true,
    });

    assert.deepEqual(result, { success: true, statusCode: 204 });
  } finally {
    await close(server);
  }
});

test('single delivery does not follow redirect responses', async (t) => {
  const http = require('node:http');
  const originalRequest = http.request;
  let requestCount = 0;
  t.after(() => { http.request = originalRequest; });

  http.request = (_options, onResponse) => {
    requestCount += 1;
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 302;
      response.headers = { location: 'https://example.com/redirected' };
      response.resume = () => {};
      onResponse(response);
      queueMicrotask(() => response.emit('end'));
    };
    request.destroy = () => {};
    return request;
  };

  const result = await singleDeliver({
    id: 'wh_redirect',
    url: 'http://example.com/hook',
    secret: 'whsec_redirect_test',
  }, 'profile.updated', {
    deliveryId: 'evt_redirect',
    timestamp: 1,
    body: '{}',
  });

  assert.equal(requestCount, 1);
  assert.equal(result.success, false);
  assert.equal(result.statusCode, 302);
});

test('test endpoint returns only the upstream status code', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE profiles (id TEXT PRIMARY KEY, api_key TEXT UNIQUE)');
  db.prepare('INSERT INTO profiles (id, api_key) VALUES (?, ?)').run('owner-a', 'key-a');
  const app = express();
  app.use(express.json());
  registerWebhookRoutes(app, {
    getDb: () => db,
    service: {
      EVENTS: {},
      async testWebhook() {
        return {
          webhook: { id: 'wh_1', url: 'https://example.com/hook' },
          result: { success: true, statusCode: 204, response: 'sensitive upstream body' },
        };
      },
    },
  });
  const server = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/webhooks/wh_1/test`, {
      method: 'POST',
      headers: { 'X-API-Key': 'key-a' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { statusCode: 204 });
  } finally {
    await close(server);
    db.close();
  }
});