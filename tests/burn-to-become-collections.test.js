const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildBurnToBecomeCollectionsPayload,
} = require('../src/lib/burn-to-become-collections');

test('Burn-to-Become collections expose the hard-coded BOA module shape', () => {
  assert.deepEqual(buildBurnToBecomeCollectionsPayload(12), {
    collections: [{
      name: 'Burned-Out Agents',
      total: 100,
      minted: 12,
      remaining: 88,
      mintPrice: '1 SOL',
      freeMintThreshold: 100,
    }],
    total: 1,
    message: 'Burn-to-Become collections',
  });
});

test('production server does not shadow the gated module GET handler', () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
  const publicRouteSource = fs.readFileSync(
    path.resolve(__dirname, '../src/routes/burn-to-become-public.js'),
    'utf8',
  );

  assert.doesNotMatch(serverSource, /app\.get\(['"]\/api\/burn-to-become\/collections/);
  assert.match(publicRouteSource, /buildBurnToBecomeCollectionsPayload\(minted\.size\)/);
});
