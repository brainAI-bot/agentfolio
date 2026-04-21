const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const { Connection } = require('@solana/web3.js');
const v3ScoreService = require('../src/v3-score-service');

const originalGetMultipleAccountsInfo = Connection.prototype.getMultipleAccountsInfo;

afterEach(() => {
  Connection.prototype.getMultipleAccountsInfo = originalGetMultipleAccountsInfo;
  v3ScoreService.clearV3Cache();
  v3ScoreService.__test.reset();
});

describe('V3 score service stale cache on 429', () => {
  it('returns stale cached scores immediately and preserves them if refresh is rate limited', async () => {
    const agentId = 'agent_brainforge';
    const staleScore = {
      agentName: 'brainforge',
      reputationScore: 512,
      verificationLevel: 4,
      authority: 'EEnvc3VvabX5x23ULx76oqqMpsPPtZjnYn3UuZ3y5JkZ',
    };

    v3ScoreService.__test._cache.set(agentId, staleScore);
    v3ScoreService.__test.setCacheTime(Date.now() - (6 * 60 * 1000));
    v3ScoreService.__test.setSleepForTests(() => Promise.resolve());

    let rpcCalls = 0;
    Connection.prototype.getMultipleAccountsInfo = async () => {
      rpcCalls += 1;
      throw new Error('429 Too Many Requests: rate limited');
    };

    const startedAt = Date.now();
    const result = await v3ScoreService.getV3Scores([agentId]);
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(result.get(agentId), staleScore);
    assert.ok(elapsedMs < 100, `expected stale cache hit to return quickly, got ${elapsedMs}ms`);

    await new Promise(resolve => setTimeout(resolve, 25));

    assert.strictEqual(v3ScoreService.__test._cache.get(agentId), staleScore);
    assert.strictEqual(rpcCalls, 4, 'expected initial attempt plus 3 retry attempts');
  });
});
