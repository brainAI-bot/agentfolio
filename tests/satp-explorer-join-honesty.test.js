const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const targetPath = path.resolve(__dirname, '../src/routes/satp-explorer-api.js');

function loadWithMocks({ profiles = [], explorerAgents = [] } = {}) {
  const originalLoad = Module._load;

  class PublicKey {
    constructor(value) { this.value = String(value || ''); }
    toBase58() { return this.value; }
  }
  class Connection {
    async getProgramAccounts() { return []; }
  }

  const db = {
    prepare(sql) {
      if (sql.includes('SELECT * FROM profiles')) {
        return { all() { return profiles; } };
      }
      if (sql.includes('FROM reviews') || sql.includes('FROM attestations') || sql.includes('FROM verifications')) {
        return { all() { return []; } };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
    close() { throw new Error('must not close shared profileStore db'); },
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@solana/web3.js') return { Connection, PublicKey };
    if (request === '../profile-store') return { getDb() { return db; } };
    if (request === '../lib/unified-trust-score') {
      return { computeUnifiedTrustScore() { return { score: 0, verifications: [] }; } };
    }
    if (request === '../v3-score-service') {
      return { parseGenesisRecord() { return null; }, async getV3Scores() { return new Map(); } };
    }
    if (request === '../v3-explorer') {
      return { async fetchAllV3Agents() { return explorerAgents; } };
    }
    if (request === '../lib/chain-cache') {
      return { getVerifications() { return []; } };
    }
    if (request === 'better-sqlite3') {
      return function Database() { throw new Error('explorer must not open a hardcoded db'); };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[targetPath];
  const mod = require(targetPath);
  return {
    mod,
    restore() {
      Module._load = originalLoad;
      delete require.cache[targetPath];
    },
  };
}

let cleanup = null;
afterEach(() => {
  if (cleanup) { cleanup(); cleanup = null; }
});

describe('SATP explorer profile join honesty', () => {
  it('populates profileId for a real identity when profile-store has a matching row', async () => {
    const loaded = loadWithMocks({
      profiles: [{
        id: 'agent_brainForge',
        name: 'brainForge',
        handle: 'brainForge',
        wallet: 'AuthForge',
        claimed_by: null,
        wallets: JSON.stringify({ solana: 'AuthForge' }),
        tags: '[]',
        skills: '[]',
        portfolio: '[]',
        links: '{}',
        metadata: '{}',
        verification_data: '{}',
        nft_avatar: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      }],
      explorerAgents: [{
        pda: 'PDA_FORGE',
        agentName: 'brainForge',
        authority: 'AuthForge',
        reputationScore: 100,
        verificationLevel: 1,
        tier: 'Registered',
        tierLabel: 'Registered',
      }],
    });
    cleanup = loaded.restore;
    loaded.mod.clearSatpExplorerCache();
    const result = await loaded.mod.getSatpAgents();
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.agents[0].profileId, 'agent_brainForge');
    assert.strictEqual(result.agents[0].agentId, 'agent_brainForge');
    assert.strictEqual(result.agents[0].onChainAgentId, 'brainForge');
    assert.strictEqual(result.agents[0].profileJoined, true);
    assert.strictEqual(result.profileJoin.matched, 1);
  });

  it('does not emit a wall of null profileIds when the join cannot match', async () => {
    const loaded = loadWithMocks({
      profiles: [],
      explorerAgents: [
        { pda: 'PDA1', agentName: 'brainChain', authority: 'Auth1', reputationScore: 10, verificationLevel: 0 },
        { pda: 'PDA2', agentName: 'brainKID', authority: 'Auth1', reputationScore: 10, verificationLevel: 0 },
        { pda: 'PDA3', agentName: 'Orphan Agent', authority: 'Auth2', reputationScore: 10, verificationLevel: 0 },
      ],
    });
    cleanup = loaded.restore;
    loaded.mod.clearSatpExplorerCache();
    const result = await loaded.mod.getSatpAgents();
    assert.ok(result.profileJoin);
    assert.strictEqual(result.profileJoin.matched, 0);
    for (const [index, agent] of result.agents.entries()) {
      assert.notStrictEqual(agent.profileId, null);
      assert.strictEqual(agent.profileId, undefined);
      assert.strictEqual(agent.onChainAgentId, ['brainChain', 'brainKID', 'Orphan Agent'][index]);
      assert.strictEqual(agent.profileJoined, false);
    }
    assert.ok(!result.agents.every((agent) => Object.prototype.hasOwnProperty.call(agent, 'profileId') && agent.profileId === null));
  });

  it('joins a real profile when persisted satp_v3 genesisPDA matches the on-chain PDA', async () => {
    const loaded = loadWithMocks({
      profiles: [{
        id: 'p1reg',
        name: 'Phase One Registry',
        handle: 'p1reg',
        wallet: 'WalletP1',
        claimed_by: null,
        wallets: JSON.stringify({ solana: 'WalletP1' }),
        tags: '[]',
        skills: '[]',
        portfolio: '[]',
        links: '{}',
        metadata: '{}',
        verification_data: JSON.stringify({
          satp_v3: { verified: true, genesisPDA: 'PDA_P1REG', program: 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG' },
        }),
        nft_avatar: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      }],
      explorerAgents: [{
        pda: 'PDA_P1REG',
        agentName: 'OnChain Name Mismatch',
        authority: 'OtherAuth',
        reputationScore: 10,
        verificationLevel: 1,
      }],
    });
    cleanup = loaded.restore;
    loaded.mod.clearSatpExplorerCache();
    const result = await loaded.mod.getSatpAgents();
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.agents[0].profileId, 'p1reg');
    assert.strictEqual(result.agents[0].profileJoined, true);
    assert.strictEqual(result.profileJoin.matched, 1);
  });
});
