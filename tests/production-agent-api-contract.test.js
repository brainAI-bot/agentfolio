const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const KNOWN_AGENT_ID = 'agent_braintest007';
const KNOWN_AGENT_NAME = 'brainTEST007';

function createJsonResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function extractProfileHandler() {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/profile-store.js'), 'utf8');
  const routeStart = source.indexOf("app.get('/api/profile/:id', async (req, res) => {");
  assert.notStrictEqual(routeStart, -1, 'expected /api/profile/:id route');

  const callbackStart = source.indexOf('async (req, res) => {', routeStart);
  assert.notStrictEqual(callbackStart, -1, 'expected async profile callback');

  const openBrace = source.indexOf('{', callbackStart);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      const handlerSource = source.slice(callbackStart, index + 1);
      return new Function('getDb', 'v3ScoreService', 'enrichProfile', 'buildReputationSurface', `return ${handlerSource};`);
    }
  }

  assert.fail('expected /api/profile/:id callback to terminate');
}

function buildProfileDb() {
  const row = {
    id: KNOWN_AGENT_ID,
    name: KNOWN_AGENT_NAME,
    api_key: 'private-write-key',
    avatar: 'https://agentfolio.bot/avatar.png',
    links: JSON.stringify({ x: '@brainTEST007', github: 'brainAI-bot' }),
    wallets: JSON.stringify({ solana: 'AuthBrain' }),
    skills: JSON.stringify([{ name: 'code', category: 'engineering' }]),
    verification_data: JSON.stringify({
      github: { verified: true, identifier: 'brainAI-bot' },
      solana: { verified: true, address: 'AuthBrain' },
    }),
  };

  return {
    prepare(sql) {
      return {
        get(value) {
          if (sql.includes('WHERE id = ?') && value === KNOWN_AGENT_ID) return row;
          if (sql.includes('LOWER(name)') && String(value).toLowerCase() === KNOWN_AGENT_NAME.toLowerCase()) return row;
          if (sql.includes('WHERE id = ?') && value === `agent_${KNOWN_AGENT_NAME.toLowerCase()}`) return null;
          return null;
        },
      };
    },
  };
}

function buildTrustDb() {
  return {
    prepare(sql) {
      assert.ok(sql.includes('SELECT * FROM profiles WHERE id = ?'), `unexpected SQL: ${sql}`);
      return {
        get(agentId) {
          if (agentId !== KNOWN_AGENT_ID) return null;
          return {
            id: KNOWN_AGENT_ID,
            name: KNOWN_AGENT_NAME,
            verification_data: JSON.stringify({
              github: { verified: true, identifier: 'brainAI-bot' },
              solana: { verified: true, address: 'AuthBrain' },
            }),
            wallets: JSON.stringify({ solana: 'AuthBrain' }),
            tags: JSON.stringify(['production']),
            skills: JSON.stringify([{ name: 'code', category: 'engineering' }]),
          };
        },
      };
    },
  };
}

let restoreModules = null;

afterEach(() => {
  if (restoreModules) {
    restoreModules();
    restoreModules = null;
  }
});

describe('known production agent API contracts', () => {
  it('keeps /api/profile/:id response shape stable for brainTEST007 alias lookups', async () => {
    const buildHandler = extractProfileHandler();
    const v3ScoreService = {
      async getV3Scores(ids) {
        assert.deepStrictEqual(new Set(ids), new Set([KNOWN_AGENT_NAME, KNOWN_AGENT_ID]));
        return new Map();
      },
      async getV3Score(id) {
        if (id !== KNOWN_AGENT_ID) return null;
        return {
          reputationScore: 600,
          reputationPct: '0.75',
          verificationLevel: 2,
          verificationLabel: 'Verified',
          isBorn: false,
        };
      },
    };
    const enrichProfile = (row) => ({
      ...row,
      links: JSON.parse(row.links),
      wallets: JSON.parse(row.wallets),
      skills: JSON.parse(row.skills),
      verification_data: JSON.parse(row.verification_data),
    });
    const { buildReputationSurface } = require('../src/lib/reputation-surface');

    const handler = buildHandler(() => buildProfileDb(), v3ScoreService, enrichProfile, buildReputationSurface);
    const res = createJsonResponse();

    await handler({ params: { id: KNOWN_AGENT_NAME } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.id, KNOWN_AGENT_ID);
    assert.strictEqual(res.body.name, KNOWN_AGENT_NAME);
    assert.strictEqual(res.body.api_key, undefined);
    assert.deepStrictEqual(res.body.wallets, { solana: 'AuthBrain' });
    assert.strictEqual(res.body.verification_data.github.verified, true);
    assert.deepStrictEqual(res.body.trust_score, {
      source: 'v3_score_service',
      reputationScore: 600,
      reputationPct: '0.75',
      verificationLevel: 2,
      verificationLabel: 'Verified',
      isBorn: false,
    });
    assert.strictEqual(res.body.level, 2);
    assert.strictEqual(res.body.score, 600);
    assert.strictEqual(res.body.levelName, 'Verified');
    assert.strictEqual(res.body.verificationLevel, 2);
    assert.strictEqual(res.body.tier, 'Verified');
  });

  it('keeps /api/trust-credential/:agentId JSON response stable for brainTEST007', async () => {
    const originalLoad = Module._load;
    const routePath = path.resolve(__dirname, '../src/routes/trust-credential.js');

    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'jsonwebtoken') {
        return {
          sign() { return 'mock.jwt'; },
          verify() { return {}; },
          decode() { return {}; },
        };
      }
      if (request === 'tweetnacl') return {};
      if (request === 'bs58') return { encode() { return 'MockPublicKey'; } };
      if (request === '../profile-store') {
        return { getDb() { return buildTrustDb(); } };
      }
      if (request === '../scoring') {
        return {
          async computeScoreWithOnChain() {
            return {
              score: 72,
              maxScore: 100,
              level: 'PRO',
              trustScore: 72,
              verificationCount: 2,
              breakdown: {
                trustScore: {
                  categories: {
                    profileCompleteness: 20,
                    socialProof: 15,
                    marketplace: 0,
                    onchain: 25,
                    tenure: 12,
                  },
                },
              },
            };
          },
        };
      }
      if (request === '../v3-score-service') {
        return {
          async getV3Score(agentId) {
            assert.strictEqual(agentId, KNOWN_AGENT_ID);
            return {
              reputationScore: 600,
              verificationLabel: 'Verified',
              verificationLevel: 2,
              reputationPct: '0.75',
              isBorn: false,
            };
          },
        };
      }
      return originalLoad(request, parent, isMain);
    };
    delete require.cache[routePath];
    restoreModules = () => {
      Module._load = originalLoad;
      delete require.cache[routePath];
    };

    const routes = [];
    const app = {
      get(route, handler) {
        routes.push({ route, handler });
      },
    };
    const { registerTrustCredentialRoutes } = require(routePath);
    registerTrustCredentialRoutes(app);

    const trustRoute = routes.find((entry) => entry.route === '/api/trust-credential/:agentId');
    assert.ok(trustRoute, 'expected trust credential route');

    const res = createJsonResponse();
    await trustRoute.handler({ params: { agentId: KNOWN_AGENT_ID }, query: { format: 'json' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.format, 'json');
    assert.strictEqual(res.body.issuer, 'did:web:agentfolio.bot');
    assert.deepStrictEqual(res.body.credential['@context'], [
      'https://www.w3.org/2018/credentials/v1',
      'https://agentfolio.bot/schemas/trust-credential/v1',
    ]);
    assert.deepStrictEqual(res.body.credential.type, [
      'VerifiableCredential',
      'AgentFolioTrustCredential',
    ]);
    assert.strictEqual(res.body.credential.issuer.url, 'https://agentfolio.bot');
    assert.strictEqual(res.body.credential.credentialSubject.id, `did:agentfolio:${KNOWN_AGENT_ID}`);
    assert.strictEqual(res.body.credential.credentialSubject.agentId, KNOWN_AGENT_ID);
    assert.strictEqual(res.body.credential.credentialSubject.name, KNOWN_AGENT_NAME);
    assert.strictEqual(res.body.credential.credentialSubject.trustScore, 600);
    assert.strictEqual(res.body.credential.credentialSubject.maxScore, 800);
    assert.strictEqual(res.body.credential.credentialSubject.tier, 'VERIFIED');
    assert.strictEqual(res.body.credential.credentialSubject.scoreVersion, 'v3');
    assert.strictEqual(res.body.credential.credentialSubject.verificationCount, 2);
    assert.strictEqual(res.body.credential.credentialSubject.onChainRegistered, true);
  });
});
