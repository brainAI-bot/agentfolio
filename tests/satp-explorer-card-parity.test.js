const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const targetPath = path.resolve(__dirname, '../src/routes/satp-explorer-api.js');
const TWITTER_SIG = '4'.repeat(64);
const GITHUB_SIG = '5'.repeat(64);

function loadWithMocks() {
  const originalLoad = Module._load;

  class PublicKey {
    constructor(value) {
      this.value = String(value || '');
    }
    toBase58() {
      return this.value;
    }
  }

  class Connection {
    async getProgramAccounts() {
      return [
        {
          pubkey: new PublicKey('PDA11111111111111111111111111111111111111111'),
          account: { data: Buffer.alloc(96, 1) },
        },
        {
          pubkey: new PublicKey('PDA22222222222222222222222222222222222222222'),
          account: { data: Buffer.alloc(96, 2) },
        },
      ];
    }
  }

  const db = {
    prepare(sql) {
      if (sql.includes('SELECT * FROM profiles')) {
        return {
          all() {
            return [
              {
                id: 'agent_alice',
                name: 'Alice',
                handle: 'alice',
                wallet: 'Auth11111111111111111111111111111111111111111',
                claimed_by: null,
                wallets: JSON.stringify({ solana: 'Auth11111111111111111111111111111111111111111' }),
                tags: '[]',
                skills: '[]',
                portfolio: '[]',
                links: '{}',
                metadata: '{}',
                verification_data: '{}',
                nft_avatar: JSON.stringify({ image: 'https://example.com/alice.png' }),
                avatar: null,
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-02T00:00:00.000Z',
              },
            ];
          },
        };
      }

      if (sql.includes('FROM reviews')) {
        return { all() { return []; } };
      }

      if (sql.includes('FROM attestations')) {
        return { all() { return []; } };
      }

      if (sql.includes('FROM verifications')) {
        return { all() { return []; } };
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
    close() {},
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@solana/web3.js') {
      return { Connection, PublicKey };
    }
    if (request === '../profile-store') {
      return {};
    }
    if (request === '../lib/unified-trust-score') {
      return {
        computeUnifiedTrustScore() {
          return {
            score: 612,
            breakdown: { demo: true },
            verifications: [
              { platform: 'twitter', verified: true, txSignature: TWITTER_SIG, timestamp: '2026-01-03T00:00:00.000Z' },
            ],
          };
        },
      };
    }
    if (request === '../v3-score-service') {
      let parseCalls = 0;
      return {
        parseGenesisRecord() {
          parseCalls += 1;
          return {
            agentName: 'Alice',
            authority: 'Auth11111111111111111111111111111111111111111',
            reputationScore: parseCalls === 1 ? 13 : 6,
            verificationLevel: parseCalls === 1 ? 3 : 2,
            verificationLabel: parseCalls === 1 ? 'Established' : 'Verified',
            isBorn: true,
            faceImage: '',
            faceMint: '',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          };
        },
        async getV3Scores(agentIds) {
          return new Map(agentIds.map((id) => [id, {
            reputationScore: 60,
            rawReputationScore: 600000,
            verificationLevel: 2,
            verificationLabel: 'Verified',
            createdAt: '2026-01-01T00:00:00.000Z',
          }]));
        },
      };
    }
    if (request === 'better-sqlite3') {
      return function Database() {
        return db;
      };
    }
    if (request === '../lib/chain-cache') {
      return {
        getVerifications() {
          return [
            {
              platform: 'github',
              txSignature: GITHUB_SIG,
              memo: 'GitHub verified',
              timestamp: '2026-01-04T00:00:00.000Z',
            },
          ];
        },
      };
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
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
});

describe('satp explorer card parity regression guard', () => {
  it('preserves attestation/platform enrichment for explorer cards', async () => {
    const loaded = loadWithMocks();
    cleanup = loaded.restore;

    loaded.mod.clearSatpExplorerCache();
    const result = await loaded.mod.getSatpAgents();

    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.source, 'solana-mainnet-v3');

    const [agent] = result.agents;
    assert.strictEqual(agent.profileId, 'agent_alice');
    assert.strictEqual(agent.verificationLevel, 2);
    assert.strictEqual(agent.verificationLabel, 'Verified');
    assert.strictEqual(agent.trustScore, 60);
    assert.strictEqual(agent.computedTrustScore, 612);
    assert.deepStrictEqual(agent.platforms.sort(), ['github', 'x']);
    assert.strictEqual(agent.onChainAttestations, 1);
    assert.ok(Array.isArray(agent.attestationMemos));
    assert.strictEqual(agent.attestationMemos.length, 1);
    assert.strictEqual(agent.attestationMemos[0].platform, 'github');
    assert.strictEqual(agent.attestationMemos[0].txSignature, GITHUB_SIG);
    assert.strictEqual(agent.attestationMemos[0].memo, 'GitHub verified');
    assert.strictEqual(agent.verifications[0].platform, 'x');
    assert.strictEqual(agent.verifications[0].txSignature, TWITTER_SIG);
  });
});
