'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const { sanitizePublicProfile } = require('../src/lib/public-profile');
const { registerClaimRoutes } = require('../src/routes/claim-routes');

test('public profile serializers recursively remove email and normalized secret-shaped keys', () => {
  class ProfileExtra {
    constructor() {
      this.visible = 'class-field';
      this.CLIENT_SECRET = 'redacted-fixture';
    }
  }

  const publicPayload = sanitizePublicProfile({
    id: 'agent-safe',
    email: 'private@example.invalid',
    claim_token: 'redacted-fixture',
    Api_Key: 'redacted-fixture',
    nested: {
      'CLAIM-TOKEN': 'redacted-fixture',
      claim_code: 'redacted-fixture',
      githubToken: 'redacted-fixture',
      service_secret: 'redacted-fixture',
      visible: true,
    },
    json_column: JSON.stringify({
      Contact_Email: 'private@example.invalid',
      nested: { 'refresh-token': 'redacted-fixture', visible: 'json-field' },
    }),
    created_at: new Date('2026-09-25T12:00:00.000Z'),
    extra: new ProfileExtra(),
    profiles: [{ 'Claim-Code': 'redacted-fixture', APIKey: 'redacted-fixture', name: 'Safe' }],
  });

  assert.deepEqual(publicPayload, {
    id: 'agent-safe',
    nested: { visible: true },
    json_column: JSON.stringify({ nested: { visible: 'json-field' } }),
    created_at: '2026-09-25T12:00:00.000Z',
    extra: { visible: 'class-field' },
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