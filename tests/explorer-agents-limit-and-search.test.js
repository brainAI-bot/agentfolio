const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const targetPath = path.resolve(__dirname, '../src/routes/explorer-api.js');

function buildDb() {
  return {
    prepare(sql) {
      if (sql.includes('SELECT id, name, wallet, claimed_by, wallets, verification_data FROM profiles')) {
        return {
          all() {
            return [
              {
                id: 'agent_alpha',
                name: 'Alpha',
                wallet: 'AuthAlpha',
                claimed_by: null,
                wallets: JSON.stringify({ solana: 'AuthAlpha' }),
                verification_data: '{}',
              },
              {
                id: 'agent_beta',
                name: 'Beta',
                wallet: 'AuthBeta',
                claimed_by: null,
                wallets: JSON.stringify({ solana: 'AuthBeta' }),
                verification_data: '{}',
              },
              {
                id: 'agent_braintest007',
                name: 'brainTEST007',
                wallet: 'AuthBrain',
                claimed_by: null,
                wallets: JSON.stringify({ solana: 'AuthBrain' }),
                verification_data: '{}',
              },
            ];
          },
        };
      }

      if (sql.includes('FROM attestations')) {
        return { all() { return []; } };
      }

      if (sql.includes('FROM verifications')) {
        return { all() { return []; } };
      }

      if (sql.includes('SELECT verification_data FROM profiles')) {
        return { get() { return { verification_data: '{}' }; } };
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
}

function loadWithMocks() {
  const originalLoad = Module._load;
  let verificationLookups = 0;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'express') {
      return {
        Router() {
          const stack = [];
          return {
            stack,
            get(path, handler) {
              stack.push({ route: { path, stack: [{ handle: handler }] } });
              return this;
            },
          };
        },
      };
    }

    if (request === '../v3-explorer') {
      return {
        async fetchAllV3Agents() {
          return [
            {
              pda: 'PDA_ALPHA',
              authority: 'AuthAlpha',
              agentName: 'Alpha',
              description: 'Alpha agent',
              category: 'AI',
              capabilities: ['search'],
              reputationScore: 700,
              verificationLevel: 4,
              tier: 'Trusted',
              tierLabel: 'Trusted',
              faceImage: null,
              faceMint: null,
              soulbound: false,
              isBorn: true,
              bornAt: '2026-04-21T00:00:00.000Z',
            },
            {
              pda: 'PDA_BETA',
              authority: 'AuthBeta',
              agentName: 'Beta',
              description: 'Beta agent',
              category: 'AI',
              capabilities: ['build'],
              reputationScore: 650,
              verificationLevel: 3,
              tier: 'Established',
              tierLabel: 'Established',
              faceImage: null,
              faceMint: null,
              soulbound: false,
              isBorn: true,
              bornAt: '2026-04-20T00:00:00.000Z',
            },
            {
              pda: 'PDA_BRAIN',
              authority: 'AuthBrain',
              agentName: 'brainTEST007',
              description: 'Brain agent',
              category: 'AI',
              capabilities: ['code'],
              reputationScore: 600,
              verificationLevel: 2,
              tier: 'Verified',
              tierLabel: 'Verified',
              faceImage: null,
              faceMint: null,
              soulbound: false,
              isBorn: false,
              bornAt: '2026-04-19T00:00:00.000Z',
            },
          ];
        },
      };
    }

    if (request === '../lib/chain-cache') {
      return {
        getVerifications() {
          verificationLookups += 1;
          return [];
        },
        getStats() {
          return { cacheHits: 0 };
        },
      };
    }

    if (request === '../profile-store') {
      return {
        getDb() {
          return buildDb();
        },
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[targetPath];
  const router = require(targetPath);

  return {
    router,
    getVerificationLookups() {
      return verificationLookups;
    },
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

describe('explorer agents query parity', () => {
  it('enriches only the requested slice while preserving total count', async () => {
    const loaded = loadWithMocks();
    cleanup = loaded.restore;

    const layer = loaded.router.stack.find((entry) => entry.route && entry.route.path === '/agents');
    assert.ok(layer, 'expected /agents route to exist');
    const handler = layer.route.stack[0].handle;

    const req = { query: { limit: '1' } };
    let payload = null;
    const res = {
      json(body) {
        payload = body;
        return body;
      },
      status(code) {
        throw new Error(`unexpected status ${code}`);
      },
    };

    await handler(req, res);

    assert.ok(payload, 'expected JSON response');
    assert.strictEqual(payload.count, 1);
    assert.strictEqual(payload.total, 3);
    assert.strictEqual(payload.agents.length, 1);
    assert.strictEqual(payload.agents[0].profileId, 'agent_alpha');
    assert.strictEqual(loaded.getVerificationLookups(), 1);
  });

  it('applies search filtering before enrichment and returns only matching agents', async () => {
    const loaded = loadWithMocks();
    cleanup = loaded.restore;

    const layer = loaded.router.stack.find((entry) => entry.route && entry.route.path === '/agents');
    assert.ok(layer, 'expected /agents route to exist');
    const handler = layer.route.stack[0].handle;

    const req = { query: { search: 'brainTEST' } };
    let payload = null;
    const res = {
      json(body) {
        payload = body;
        return body;
      },
      status(code) {
        throw new Error(`unexpected status ${code}`);
      },
    };

    await handler(req, res);

    assert.ok(payload, 'expected JSON response');
    assert.strictEqual(payload.count, 1);
    assert.strictEqual(payload.total, 1);
    assert.strictEqual(payload.search, 'brainTEST');
    assert.deepStrictEqual(payload.agents.map((agent) => agent.name), ['brainTEST007']);
    assert.strictEqual(loaded.getVerificationLookups(), 1);
  });
});
