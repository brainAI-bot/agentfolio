const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { afterEach, describe, it } = require('node:test');

const ELIGIBILITY_PATH = path.resolve(__dirname, '../src/api/eligibility.js');
const ROOT = path.join(__dirname, '..');

const P1REG_PROFILE = {
  id: 'agent_p1reg_35028542',
  name: 'p1reg_35028542',
  handle: 'p1reg',
  bio: '',
  avatar: '',
  skills: '[]',
  verification: '{}',
  endorsements: '[]',
  portfolio: '[]',
  track_record: '{}',
};

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

function loadEligibilityWithMocks({
  v3Score = null,
  v3ScoreError = null,
  explorerAgents = [],
  explorerError = null,
} = {}) {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'better-sqlite3') {
      return function Database() {
        return {
          prepare() {
            return {
              get() {
                return P1REG_PROFILE;
              },
            };
          },
          close() {},
        };
      };
    }
    if (request === '../v3-score-service') {
      return {
        async getV3Score() {
          if (v3ScoreError) throw v3ScoreError;
          return v3Score;
        },
      };
    }
    if (request === '../v3-explorer') {
      return {
        async fetchAllV3Agents() {
          if (explorerError) throw explorerError;
          return explorerAgents;
        },
      };
    }
    if (request === '../lib/scoring-engine-v2') {
      return {
        getCompleteScore() {
          return {
            verificationLevel: { level: 3, name: 'Established' },
            reputationScore: { score: 320 },
          };
        },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[ELIGIBILITY_PATH];
  const loaded = require(ELIGIBILITY_PATH);
  return {
    ...loaded,
    restore() {
      Module._load = originalLoad;
      delete require.cache[ELIGIBILITY_PATH];
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

async function getBoaEligibility(loaded, agent = 'agent_p1reg_35028542') {
  const routes = [];
  loaded.registerEligibilityRoutes({
    get(route, handler) {
      routes.push({ route, handler });
    },
  });
  const route = routes.find((entry) => entry.route === '/api/boa/eligibility');
  assert.ok(route, 'expected GET /api/boa/eligibility');
  const res = createJsonResponse();
  await route.handler({ query: { agent } }, res);
  return res;
}

describe('eligibility uses explorer / V3 on-chain scores', () => {
  it('v3-score-service pins RPC with resolveSatpMainnetRpcUrl and ignores leftover devnet', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'v3-score-service.js'), 'utf8');
    assert.match(source, /resolveSatpMainnetRpcUrl/);
    assert.match(source, /satp-mainnet-rpc/);
    assert.doesNotMatch(source, /const RPC = process\.env\.SOLANA_RPC_URL \|\| /);
  });

  it('returns explorer-matched verification 2 and reputation 8 from a mocked V3 score', async () => {
    const loaded = loadEligibilityWithMocks({
      v3Score: { verificationLevel: 2, reputationScore: 8, verificationLabel: 'Verified' },
    });
    restoreModules = loaded.restore;

    const res = await getBoaEligibility(loaded);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.eligible, false);
    assert.equal(res.body.requirements.verification_level.current, 2);
    assert.equal(res.body.requirements.reputation.current, 8);
    assert.equal(res.body.requirements.verification_level.required, 3);
    assert.equal(res.body.requirements.reputation.required, 50);
    assert.notEqual(res.body.source, 'scoring_engine_v2');
    assert.equal(res.body.source, 'v3_onchain');
  });

  it('falls back to v3-explorer when getV3Score misses, source explorer not scoring_engine_v2', async () => {
    const loaded = loadEligibilityWithMocks({
      v3Score: null,
      explorerAgents: [{
        agentName: 'p1reg_35028542',
        verificationLevel: 2,
        reputationScore: 8,
        verificationLabel: 'Verified',
      }],
    });
    restoreModules = loaded.restore;

    const res = await getBoaEligibility(loaded);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.eligible, false);
    assert.equal(res.body.requirements.verification_level.current, 2);
    assert.equal(res.body.requirements.reputation.current, 8);
    assert.equal(res.body.source, 'explorer');
    assert.notEqual(res.body.source, 'scoring_engine_v2');
  });
});
