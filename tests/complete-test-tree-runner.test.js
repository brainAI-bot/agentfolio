const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyResults,
  discoverTestFiles,
  parseCounts,
  validateQuarantine,
} = require('../scripts/run-complete-test-tree');

test('complete-tree discovery includes all eight marketplace tests', () => {
  const discovered = discoverTestFiles();
  const marketplace = discovered.filter((file) => /^tests\/marketplace-.*\.test\.js$/.test(file));
  assert.deepEqual(marketplace, [
    'tests/marketplace-application-lifecycle.test.js',
    'tests/marketplace-delivery-thread.test.js',
    'tests/marketplace-escrow-readback.test.js',
    'tests/marketplace-state-machine.test.js',
    'tests/marketplace-surface-regression.test.js',
    'tests/marketplace-wallet-auth-v2.test.js',
    'tests/marketplace-wallet-challenge.test.js',
    'tests/marketplace-web-parity.test.js',
  ]);
});

test('quarantine validation fails closed on an expired entry', () => {
  assert.throws(() => validateQuarantine({
    schemaVersion: 1,
    entries: { 'tests/example.test.js': { reason: 'A sufficiently specific failure reason.', expiresOn: '2026-09-18' } },
  }, ['tests/example.test.js'], '2026-09-19'), /quarantine expired/);
});

test('result classification rejects unexpected failures and passing quarantines', () => {
  const classified = classifyResults([
    { file: 'tests/pass.test.js', status: 0 },
    { file: 'tests/quarantined.test.js', status: 0 },
    { file: 'tests/unexpected.test.js', status: 1 },
  ], { 'tests/quarantined.test.js': { reason: 'known', expiresOn: '2026-10-03' } });
  assert.deepEqual(classified.unexpectedFailures.map(({ file }) => file), ['tests/unexpected.test.js']);
  assert.deepEqual(classified.passingQuarantines.map(({ file }) => file), ['tests/quarantined.test.js']);
});

test('Node test summaries are parsed mechanically', () => {
  assert.deepEqual(parseCounts('# tests 4\n# pass 3\n# fail 1\n# skipped 0\n'), {
    tests: 4,
    pass: 3,
    fail: 1,
    skipped: 0,
  });
});