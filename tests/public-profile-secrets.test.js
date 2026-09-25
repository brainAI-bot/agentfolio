'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { sanitizePublicProfile } = require('../src/lib/public-profile');

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