import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateChangedPaths } from '../scripts/boundary.mjs';

const readRepoFile = (relativePath) => readFileSync(
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
  'utf8',
);

test('Wave 0 permits isolated Shops and explicit token-page retirement paths', () => {
  assert.deepEqual(validateChangedPaths([
    'shops/README.md',
    '.github/workflows/shops-ci.yml',
    'frontend/src/app/launch/page.tsx',
    'scripts/check-public-routes.mjs',
  ]), []);
});

test('Wave 0 fails closed on a production runtime mutation', () => {
  assert.deepEqual(validateChangedPaths(['src/server.js']), [
    'src/server.js: production runtime/deploy paths are outside Wave 0',
  ]);
});

test('Wave 0 fails closed on unrelated repository changes', () => {
  assert.deepEqual(validateChangedPaths(['frontend/src/app/marketplace/page.tsx']), [
    'frontend/src/app/marketplace/page.tsx: outside the Shops boundary and approved token-page retirement set',
  ]);
});

test('token advertising is retired without deleting independent chain receipts', () => {
  const stats = readRepoFile('frontend/src/app/stats/page.tsx');
  assert.doesNotMatch(stats, /TokenStatsSection|Token Launches|recentLaunches/);
  assert.match(stats, /On-Chain Receipts/);
  assert.match(stats, /Historical Escrow Release Receipt/);
});

test('landing switch names both existing paid trust-score contracts and remains documentation-only', () => {
  const adr = readRepoFile('shops/docs/adr/0004-landing-switch.md');
  assert.match(adr, /GET \/api\/score\?id=<profileId>/);
  assert.match(adr, /GET \/api\/profile\/:id\/trust-score/);
  assert.match(adr, /Wave 0 adds no setting to production and disables nothing/);
});
