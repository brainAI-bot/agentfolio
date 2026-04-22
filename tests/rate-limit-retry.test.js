const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseRetryAfterMs, getRateLimitDelay } = require('../src/lib/rate-limit-retry');

describe('parseRetryAfterMs', () => {
  it('parses integer seconds', () => {
    assert.strictEqual(parseRetryAfterMs('3'), 3000);
  });

  it('parses HTTP date values', () => {
    const now = Date.parse('2026-04-22T00:00:00Z');
    const retryAt = 'Wed, 22 Apr 2026 00:00:05 GMT';
    assert.strictEqual(parseRetryAfterMs(retryAt, now), 5000);
  });

  it('returns null for invalid values', () => {
    assert.strictEqual(parseRetryAfterMs('nonsense'), null);
  });
});

describe('getRateLimitDelay', () => {
  it('falls back to exponential backoff when Retry-After is missing', () => {
    assert.strictEqual(getRateLimitDelay({ attempt: 0, initialDelayMs: 500 }), 500);
    assert.strictEqual(getRateLimitDelay({ attempt: 2, initialDelayMs: 500 }), 2000);
  });

  it('honors Retry-After when it is longer than exponential backoff', () => {
    assert.strictEqual(getRateLimitDelay({ retryAfter: '7', attempt: 1, initialDelayMs: 500 }), 7000);
  });

  it('caps excessive delays at maxDelayMs', () => {
    assert.strictEqual(getRateLimitDelay({ retryAfter: '120', attempt: 0, initialDelayMs: 500, maxDelayMs: 10000 }), 10000);
  });
});
