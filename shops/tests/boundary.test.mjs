import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChangedPaths } from '../scripts/boundary.mjs';

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
