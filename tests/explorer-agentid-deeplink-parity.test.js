const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const targetPath = path.resolve(__dirname, '../src/server.js');
const TWITTER_SIG = '4'.repeat(64);
const GITHUB_SIG = '5'.repeat(64);

function loadServerWithMocks() {
  const originalLoad = Module._load;
  const routeMap = new Map();

  const app = {
    use() {},
    get(route, ...handlers) { routeMap.set(`GET ${route}`, handlers.length === 1 ? handlers[0] : handlers); },
    post() {},
    put() {},
    delete() {},
    patch() {},
    listen(_port, cb) { if (cb) cb(); return { close() {} }; },
  };

  const expressStub = () => app;
  expressStub.json = () => (_req, _res, next) => next && next();
  expressStub.urlencoded = () => (_req, _res, next) => next && next();
  expressStub.static = () => (_req, _res, next) => next && next();

  const fakeProfile = {
    id: 'agent_alice',
    name: 'Alice',
    handle: 'alice',
    wallet: 'Auth11111111111111111111111111111111111111111',
    claimed_by: null,
    claimed: 1,
    hidden: 0,
    status: 'active',
    verification_data: JSON.stringify({ github: { verified: true } }),
    wallets: JSON.stringify({ solana: 'Auth11111111111111111111111111111111111111111' }),
    tags: JSON.stringify(['agents']),
    skills: JSON.stringify(['shipping']),
    nft_avatar: JSON.stringify({ image: 'https://node1.irys.xyz/alice.png', permanent: true }),
    avatar: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  };

  const fakeDb = {
    prepare(sql) {
      if (sql.includes('SELECT * FROM profiles WHERE id = ?')) {
        return { get(value) { return value === 'agent_alice' ? fakeProfile : null; } };
      }
      if (sql.includes('SELECT * FROM profiles WHERE handle = ?')) {
        return { get() { return null; } };
      }
      if (sql.includes('SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)')) {
        return { get() { return null; } };
      }
      if (sql.includes("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'satp_trust_scores'")) {
        return { get() { return { name: 'satp_trust_scores' }; } };
      }
      if (sql.includes('PRAGMA table_info(satp_trust_scores)')) {
        return { all() { return [{ name: 'overall_score' }, { name: 'level' }, { name: 'score_breakdown' }]; } };
      }
      if (sql.includes('FROM profiles p') && sql.includes('leaderboard_score')) {
        return {
          all() {
            return [
              {
                ...fakeProfile,
                leaderboard_score: 777,
                leaderboard_level: 4,
                leaderboard_breakdown: JSON.stringify({ trust: 777 }),
              },
            ];
          },
        };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };

  const noOpProvider = {
    initiateDiscordVerification: () => ({ success: false }),
    verifyDiscordChallenge: () => ({ verified: false }),
    initiateTelegramVerification: () => ({ success: false }),
    verifyTelegramChallenge: () => ({ verified: false }),
    getTelegramVerificationStatus: () => ({ found: false }),
    initiateDomainVerification: () => ({ success: false }),
    verifyDomainChallenge: () => ({ verified: false }),
    getDomainVerificationStatus: () => ({ found: false }),
    initiateWebsiteVerification: () => ({ success: false }),
    verifyWebsiteChallenge: () => ({ verified: false }),
    getWebsiteVerificationStatus: () => ({ found: false }),
    initiateETHVerification: () => ({ success: false }),
    verifyETHChallenge: () => ({ verified: false }),
    getETHVerificationStatus: () => ({ found: false }),
    initiateENSVerification: () => ({ success: false }),
    verifyENSChallenge: () => ({ verified: false }),
    getENSVerificationStatus: () => ({ found: false }),
    initiateFarcasterVerification: () => ({ success: false }),
    verifyFarcasterChallenge: () => ({ verified: false }),
    getFarcasterVerificationStatus: () => ({ found: false }),
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'express') return expressStub;
    if (request === 'cors') return () => (_req, _res, next) => next && next();
    if (request === './satp-reviews') return { registerRoutes() {} };
    if (request === './routes/satp-api') return { registerSATPRoutes() {} };
    if (request === './routes/satp-write-api') return { registerSATPWriteRoutes() {} };
    if (request === './profile-store') return { getDb() { return fakeDb; }, registerRoutes() {} };
    if (request === './scoring') {
      return {
        computeScore() { return 0; },
        computeScoreWithOnChain() { return 0; },
        computeLeaderboard() { return []; },
        fetchOnChainData() { return null; },
      };
    }
    if (request === './lib/unified-trust-score') {
      return {
        computeUnifiedTrustScore() {
          return {
            score: 612,
            level: 2,
            levelName: 'Verified',
            badge: '🔵',
            source: 'unified-test',
            hasSatpIdentity: true,
            breakdown: { demo: true },
            verifications: [
              { platform: 'twitter', verified: true, txSignature: TWITTER_SIG, timestamp: '2026-01-03T00:00:00.000Z' },
              { platform: 'github', verified: true, txSignature: null, timestamp: '2026-01-04T00:00:00.000Z' },
              { platform: 'satp', verified: true, txSignature: '6'.repeat(64), timestamp: '2026-01-05T00:00:00.000Z' },
            ],
          };
        },
      };
    }
    if (request === './lib/chain-cache') {
      return {
        start() {},
        getVerifications() {
          return [
            {
              platform: 'github',
              pda: 'AttestationPda1111111111111111111111111111111',
              timestamp: '2026-01-04T00:00:00.000Z',
            },
          ];
        },
        async resolveAttestationTxHintByPda() {
          return {
            txSignature: GITHUB_SIG,
            solscanUrl: `https://solana.fm/tx/${GITHUB_SIG}`,
          };
        },
      };
    }
    if (request === '../v3-score-service' || request === './v3-score-service') {
      return { getV3Score: async () => null };
    }
    if (request === '@x402/express') {
      return {
        paymentMiddleware: () => (_req, _res, next) => next && next(),
        x402ResourceServer: class { register() {} },
      };
    }
    if (request === '@x402/core/server') return { HTTPFacilitatorClient: class {} };
    if (request === '@x402/evm/exact/server') return { ExactEvmScheme: class {} };
    if (request === './discord-verify-hardened') return noOpProvider;
    if (request === './telegram-verify') return noOpProvider;
    if (request === './domain-verify') return noOpProvider;
    if (request === './website-verify') return noOpProvider;
    if (request === './eth-verify-hardened') return noOpProvider;
    if (request === './ens-verify') return noOpProvider;
    if (request === './farcaster-verify') return noOpProvider;
    if (request === './routes/explorer-api') return (_req, _res, next) => next && next();
    if (request === './v3-explorer') {
      return {
        async fetchAllV3Agents() {
          return [
            {
              pda: 'PdaAlice11111111111111111111111111111111111111',
              authority: 'Auth11111111111111111111111111111111111111111',
              agentName: 'Alice',
              reputationScore: 800,
              verificationLevel: 4,
              verificationLabel: 'Trusted',
              isBorn: true,
              bornAt: '2026-01-01T00:00:00.000Z',
              faceMint: 'FaceMint111111111111111111111111111111111111',
            },
          ];
        },
      };
    }
    if (request === './satp-identity-client') return {};
    if (request === './routes/burn-to-become-public') return { handleBurnToBecome() { return false; } };
    if (request === './marketplace') return { registerRoutes() {} };
    if (request === './verification-challenges') return { generateChallenge() { return { id: 'challenge', challengeData: {} }; } };
    if (request === './routes/trust-credential') return { registerTrustCredentialRoutes() {} };
    if (request === './routes/batch-register') return { registerBatchRoutes() {} };
    if (request === './routes/v3-api-index') return (_req, _res, next) => next && next();
    if (request === './api/eligibility') return { registerEligibilityRoutes() {} };
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[targetPath];
  require(targetPath);

  return {
    routeMap,
    restore() {
      Module._load = originalLoad;
      delete require.cache[targetPath];
    },
  };
}

function getLastRouteHandler(routeEntry) {
  return Array.isArray(routeEntry) ? routeEntry[routeEntry.length - 1] : routeEntry;
}

let cleanup = null;

afterEach(() => {
  if (cleanup) {
    cleanup();
    cleanup = null;
  }
});

describe('explorer agent deep-link parity regression guard', () => {
  it('keeps /api/leaderboard as a free public route distinct from the paid scores route', async () => {
    const loaded = loadServerWithMocks();
    cleanup = loaded.restore;

    const freeRoute = loaded.routeMap.get('GET /api/leaderboard');
    const paidHandler = loaded.routeMap.get('GET /api/leaderboard/scores');
    assert.ok(freeRoute, 'expected /api/leaderboard handler to be registered');
    assert.ok(paidHandler, 'expected /api/leaderboard/scores handler to remain registered');
    assert.ok(Array.isArray(freeRoute), 'expected /api/leaderboard to include a rate limiter and handler');
    assert.strictEqual(freeRoute.length, 2);
    const freeHandler = getLastRouteHandler(freeRoute);
    assert.notStrictEqual(freeHandler, paidHandler);

    const req = { query: { limit: '1' } };
    let statusCode = 200;
    let jsonBody = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { jsonBody = payload; return this; },
    };

    await freeHandler(req, res);

    assert.strictEqual(statusCode, 200);
    assert.ok(jsonBody);
    assert.strictEqual(jsonBody.ok, true);
    assert.strictEqual(jsonBody.limit, 1);
    assert.strictEqual(jsonBody.count, 1);
    assert.strictEqual(jsonBody.total, 1);
    assert.strictEqual(jsonBody.leaderboard.length, 1);
    assert.deepStrictEqual(jsonBody.leaderboard[0], {
      agentId: 'agent_alice',
      id: 'agent_alice',
      name: 'Alice',
      handle: 'alice',
      avatar: 'https://gateway.irys.xyz/alice.png',
      score: 777,
      reputationScore: 777,
      level: 4,
      levelName: 'Trusted',
      verificationLevel: 4,
      verificationLabel: 'Trusted',
      source: 'satp_trust_scores',
      isBorn: true,
      claimed: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    assert.deepStrictEqual(jsonBody.payment, {
      required: false,
      paidEndpoint: '/api/leaderboard/scores',
    });
  });

  it('keeps the x402 pricing catalog aligned with trust-score and leaderboard contracts', async () => {
    const loaded = loadServerWithMocks();
    cleanup = loaded.restore;

    const pricingHandler = loaded.routeMap.get('GET /api/x402/pricing');
    const trustScoreRoute = loaded.routeMap.get('GET /api/profile/:id/trust-score');
    assert.ok(pricingHandler, 'expected /api/x402/pricing handler to be registered');
    assert.ok(Array.isArray(trustScoreRoute), 'expected /api/profile/:id/trust-score to include x402 middleware and handler');
    assert.strictEqual(trustScoreRoute.length, 2);

    let jsonBody = null;
    const res = {
      json(payload) { jsonBody = payload; return this; },
    };

    pricingHandler({}, res);

    assert.ok(jsonBody);
    const freePaths = jsonBody.endpoints.free.map((endpoint) => endpoint.path);
    const paidPaths = jsonBody.endpoints.paid.map((endpoint) => endpoint.path);
    assert.ok(freePaths.includes('/api/leaderboard'), 'expected public leaderboard in free catalog');
    assert.ok(paidPaths.includes('/api/profile/:id/trust-score'), 'expected direct trust-score in paid catalog');
    assert.ok(paidPaths.includes('/api/leaderboard/scores'), 'expected scored leaderboard in paid catalog');
    assert.ok(!freePaths.includes('/api/profile/:id/trust-score'), 'direct trust-score must not appear in free catalog');
  });

  it('preserves public verification/platform shaping for /api/explorer/:agentId', async () => {
    const loaded = loadServerWithMocks();
    cleanup = loaded.restore;

    const handler = loaded.routeMap.get('GET /api/explorer/:agentId');
    assert.ok(handler, 'expected /api/explorer/:agentId handler to be registered');

    const req = { params: { agentId: 'agent_alice' } };
    let statusCode = 200;
    let jsonBody = null;
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { jsonBody = payload; return this; },
    };

    await handler(req, res);

    assert.strictEqual(statusCode, 200);
    assert.ok(jsonBody);
    assert.strictEqual(jsonBody.agentId, 'agent_alice');
    assert.strictEqual(jsonBody.trustScore, 800);
    assert.strictEqual(jsonBody.level, 4);
    assert.strictEqual(jsonBody.verificationLabel, 'Trusted');
    assert.deepStrictEqual(jsonBody.platforms.sort(), ['github', 'x']);
    assert.strictEqual(jsonBody.verifications.length, 2);
    assert.strictEqual(jsonBody.verifications[0].platform, 'x');
    assert.strictEqual(jsonBody.verifications[0].txSignature, TWITTER_SIG);
    const githubVerification = jsonBody.verifications.find((entry) => entry.platform === 'github');
    assert.ok(githubVerification);
    assert.strictEqual(githubVerification.txSignature, GITHUB_SIG);
    assert.ok(githubVerification.solscanUrl.endsWith(GITHUB_SIG));
    assert.ok(!jsonBody.platforms.includes('satp'));
    assert.strictEqual(jsonBody.v3.reputationScore, 800);
    assert.strictEqual(jsonBody.v3.verificationLevel, 4);
    assert.strictEqual(jsonBody.authority, 'Auth11111111111111111111111111111111111111111');
  });
});
