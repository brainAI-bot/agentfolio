'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const { sanitizePublicProfile } = require('../src/lib/public-profile');
const { registerClaimRoutes } = require('../src/routes/claim-routes');

test('public profile serializers recursively remove claim and API capabilities', () => {
  const publicPayload = sanitizePublicProfile({
    id: 'agent-safe',
    claim_token: 'redacted-fixture',
    api_key: 'redacted-fixture',
    nested: {
      claimToken: 'redacted-fixture',
      claim_code: 'redacted-fixture',
      github_token: 'redacted-fixture',
      visible: true,
    },
    profiles: [{ claimCode: 'redacted-fixture', apiKey: 'redacted-fixture', name: 'Safe' }],
  });

  assert.deepEqual(publicPayload, {
    id: 'agent-safe',
    nested: { visible: true },
    profiles: [{ name: 'Safe' }],
  });
});

test('profile list, detail, and mutation serializers use the public sanitizer', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'profile-store.js'), 'utf8');
  const calls = source.match(/sanitizePublicProfile\(/g) || [];
  assert.ok(calls.length >= 5, `expected sanitizer at every profile response seam, found ${calls.length}`);
  assert.doesNotMatch(source, /const \{ api_key, \.\.\.rest \} = r/);
  assert.doesNotMatch(source, /const \{ api_key, \.\.\.safe \} = row/);
});

test('bulk claim-link route fails closed when ADMIN_KEY is unset', async () => {
  const originalAdminKey = process.env.ADMIN_KEY;
  delete process.env.ADMIN_KEY;
  let claimTokenQueryRan = false;

  const db = {
    exec() {},
    prepare(sql) {
      if (sql.includes('SELECT id FROM profiles')) return { all: () => [] };
      if (sql.includes('SELECT id, name, handle, claim_token')) {
        return {
          all: () => {
            claimTokenQueryRan = true;
            return [];
          },
        };
      }
      return { get: () => null, run: () => ({ changes: 0 }) };
    },
  };

  const app = express();
  registerClaimRoutes(app, () => db);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const { port } = server.address();
    const legacyFallback = ['bf', 'admin', '2026'].join('-');
    const response = await fetch(`http://127.0.0.1:${port}/api/claims/urls`, {
      headers: { 'x-admin-key': legacyFallback },
    });

    assert.equal(response.status, 503);
    assert.equal(claimTokenQueryRan, false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (originalAdminKey === undefined) delete process.env.ADMIN_KEY;
    else process.env.ADMIN_KEY = originalAdminKey;
  }
});