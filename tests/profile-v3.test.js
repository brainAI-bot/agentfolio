const { describe, it } = require('node:test');
const assert = require('node:assert');
const { shouldFetchV3Reputation } = require('../frontend/src/lib/profile-v3');

describe('shouldFetchV3Reputation', () => {
  it('skips synthetic local profile ids', () => {
    assert.strictEqual(shouldFetchV3Reputation('local_client_mnvm8zu5mqrq5i'), false);
    assert.strictEqual(shouldFetchV3Reputation('local_endorse_44f9f9f8'), false);
  });

  it('allows real profile ids to keep fetching V3 reputation', () => {
    assert.strictEqual(shouldFetchV3Reputation('agent_brainforge'), true);
    assert.strictEqual(shouldFetchV3Reputation('p1t8r731729'), true);
  });
});
