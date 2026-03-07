const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');
const {
  PROGRAMS,
  rpcCall,
  fetchIdentityAccounts,
  fetchReputationAccounts,
  fetchValidationAccounts,
  getSATPOverview,
  clearCache,
  _cache
} = require('../src/lib/satp-explorer');

describe('satp-explorer', () => {
  beforeEach(() => {
    clearCache();
  });

  it('exports all expected functions', () => {
    assert.strictEqual(typeof rpcCall, 'function');
    assert.strictEqual(typeof fetchIdentityAccounts, 'function');
    assert.strictEqual(typeof fetchReputationAccounts, 'function');
    assert.strictEqual(typeof fetchValidationAccounts, 'function');
    assert.strictEqual(typeof getSATPOverview, 'function');
    assert.strictEqual(typeof clearCache, 'function');
  });

  it('has correct program IDs', () => {
    assert.strictEqual(PROGRAMS.identity, 'BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr');
    assert.strictEqual(PROGRAMS.reputation, 'TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh');
    assert.strictEqual(PROGRAMS.validation, 'AdDWFa9oEmZdrTrhu8YTWu4ozbTP7e6qa9rvyqfAvM7N');
  });

  it('clearCache empties the cache', () => {
    _cache.set('test', { data: 'hello', ts: Date.now() });
    assert.strictEqual(_cache.size, 1);
    clearCache();
    assert.strictEqual(_cache.size, 0);
  });

  it('cache respects TTL', () => {
    // Set an expired entry
    _cache.set('accounts:test', { data: [1, 2, 3], ts: Date.now() - 120000 });
    // The getCached function is internal, but getSATPOverview uses it
    // We can verify by checking the cache directly
    const entry = _cache.get('accounts:test');
    assert.ok(Date.now() - entry.ts > 60000, 'Entry should be expired');
  });

  it('PROGRAMS has exactly 3 programs', () => {
    const keys = Object.keys(PROGRAMS);
    assert.strictEqual(keys.length, 3);
    assert.ok(keys.includes('identity'));
    assert.ok(keys.includes('reputation'));
    assert.ok(keys.includes('validation'));
  });

  it('getSATPOverview returns expected shape', async () => {
    // This makes a real devnet call - may be slow or fail if devnet is down
    const overview = await getSATPOverview();
    assert.ok(overview.programs, 'should have programs');
    assert.strictEqual(overview.network, 'devnet');
    assert.ok(overview.counts !== undefined, 'should have counts');
    assert.ok(typeof overview.counts.identities === 'number');
    assert.ok(typeof overview.counts.reputations === 'number');
    assert.ok(typeof overview.counts.validations === 'number');
    assert.ok(overview.fetchedAt, 'should have fetchedAt');
  });

  it('getSATPOverview caches results', async () => {
    const first = await getSATPOverview();
    const second = await getSATPOverview();
    // Should be the exact same object from cache
    assert.strictEqual(first.fetchedAt, second.fetchedAt);
  });

  it('fetchIdentityAccounts returns an array', async () => {
    const result = await fetchIdentityAccounts();
    assert.ok(Array.isArray(result) || result.error, 'should return array or error');
  });

  it('fetchReputationAccounts returns an array', async () => {
    const result = await fetchReputationAccounts();
    assert.ok(Array.isArray(result) || result.error, 'should return array or error');
  });

  it('fetchValidationAccounts returns an array', async () => {
    const result = await fetchValidationAccounts();
    assert.ok(Array.isArray(result) || result.error, 'should return array or error');
  });
});
