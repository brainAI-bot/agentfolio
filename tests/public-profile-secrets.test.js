'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { sanitizePublicProfile } = require('../src/lib/public-profile');

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
