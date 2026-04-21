const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const { Connection } = require('@solana/web3.js');
const client = require('../src/satp-identity-client');

const wallet = 'FcJ6g8vDcHz1bGBypZg1wv8eCJ2jP3fL8Y8d4DmMxE3x';
const originalGetAccountInfo = Connection.prototype.getAccountInfo;
const originalGetProgramAccounts = Connection.prototype.getProgramAccounts;

afterEach(() => {
  Connection.prototype.getAccountInfo = originalGetAccountInfo;
  Connection.prototype.getProgramAccounts = originalGetProgramAccounts;
  client.__test.resetCache();
});

describe('SATP identity cache stale-while-revalidate', () => {
  it('returns stale cached identity immediately while refresh runs in background', async () => {
    const staleIdentity = {
      authority: wallet,
      name: 'Cached Agent',
      reputationScore: 64,
      verificationLevel: 3,
    };

    client.__test._cache.accounts = [staleIdentity];
    client.__test._cache.time = Date.now() - (31 * 60 * 1000);
    client.__test._cache.byAuthority.set(wallet, staleIdentity);
    client.__test.setSleepForTests(() => Promise.resolve());

    let accountInfoCalls = 0;
    let programAccountCalls = 0;

    Connection.prototype.getAccountInfo = async () => {
      accountInfoCalls += 1;
      return null;
    };

    Connection.prototype.getProgramAccounts = async () => {
      programAccountCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 25));
      return [];
    };

    const startedAt = Date.now();
    const identity = await client.getAgentIdentity(wallet, 'mainnet');
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(identity.authority, wallet);
    assert.strictEqual(identity.name, 'Cached Agent');
    assert.ok(elapsedMs < 250, `expected stale cache hit to avoid blocking refresh, got ${elapsedMs}ms`);
    assert.ok(accountInfoCalls >= 4, 'expected normal direct lookup probes before cache fallback');

    await new Promise(resolve => setImmediate(resolve));
    assert.ok(programAccountCalls >= 1, 'expected background refresh to start');

    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(programAccountCalls >= 4, 'expected stubbed background refresh to finish before teardown');
  });
});
