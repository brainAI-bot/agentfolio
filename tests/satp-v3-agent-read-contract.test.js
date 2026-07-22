const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const ROUTE_PATH = path.resolve(__dirname, '../src/routes/satp-api.js');
const SAMPLE_AGENT_ID = 'agent_braintest';

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

function loadSatpRoutesWithMocks({ v3Score = null, explorerAgents = [] } = {}) {
  const originalLoad = Module._load;
  const calls = { getV3Score: [], fetchAllV3Agents: 0 };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../satp-identity-client') {
      return {
        listRegisteredAgents: async () => ({ total: 0 }),
        getAgentIdentity: async () => null,
        getAgentScores: async () => null,
        getAgentAttestations: async () => [],
        getPrograms: () => ({}),
        LEGACY_PROGRAMS: {},
      };
    }
    if (request === '../satp-reviews-onchain') return {};
    if (request === '../adapters/satp') {
      return {
        client: {
          loadSatpClient() {
            return {
              createSATPClient() {
                return {};
              },
              getGenesisPDA() {
                return [{ toBase58: () => 'DerivedPda111' }];
              },
            };
          },
        },
      };
    }
    if (request === '../v3-score-service') {
      return {
        getGenesisPDA() {
          return { toBase58: () => 'DerivedPda111' };
        },
        async getV3Score(agentId) {
          calls.getV3Score.push(agentId);
          return v3Score;
        },
      };
    }
    if (request === '../v3-explorer') {
      return {
        async fetchAllV3Agents() {
          calls.fetchAllV3Agents += 1;
          return explorerAgents;
        },
      };
    }
    if (request === '@solana/web3.js') {
      return {
        PublicKey: class PublicKey {
          constructor(value) {
            this.value = value;
          }
          toBase58() {
            return String(this.value);
          }
        },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[ROUTE_PATH];
  const loaded = require(ROUTE_PATH);
  return {
    ...loaded,
    calls,
    restore() {
      Module._load = originalLoad;
      delete require.cache[ROUTE_PATH];
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

describe('SATP V3 per-agent read contract', () => {
  it('resolves agent_braintest through explorer evidence when direct V3 score lookup misses', async () => {
    const loaded = loadSatpRoutesWithMocks({
      v3Score: null,
      explorerAgents: [{
        pda: 'ExplorerPda111',
        authority: 'Authority111',
        agentName: 'brainTEST',
        reputationScore: 620,
        rawReputationScore: 6200000,
        reputationPct: '620.00',
        verificationLevel: 3,
        verificationLabel: 'Established',
        tier: 'established',
        tierLabel: 'L3 · Established',
        isBorn: true,
        isActive: true,
      }],
    });
    restoreModules = loaded.restore;

    const record = await loaded.resolveV3GenesisRecord(SAMPLE_AGENT_ID);

    assert.strictEqual(record.agentId, SAMPLE_AGENT_ID);
    assert.strictEqual(record.resolvedAgentId, SAMPLE_AGENT_ID);
    assert.strictEqual(record.agentName, 'brainTEST');
    assert.strictEqual(record.pda, 'ExplorerPda111');
    assert.strictEqual(record.reputationScore, 620);
    assert.strictEqual(record.verificationLevel, 3);
    assert.strictEqual(record.verificationLabel, 'Established');
    assert.strictEqual(record.isBorn, true);
    assert.strictEqual(record.isActive, true);
    assert.strictEqual(record.onChainRegistered, true);
    assert.strictEqual(record.trustEvidenceBacked, true);
    assert.strictEqual(record.statusContract, 'v3_genesis_record');
    assert.strictEqual(record.source, 'v3-explorer-scan');
    assert.deepStrictEqual(loaded.calls.getV3Score, [
      'agent_braintest',
      'braintest',
    ]);
    assert.strictEqual(loaded.calls.fetchAllV3Agents, 1);
  });

  it('returns evidence-backed status vocabulary from both SATP per-agent routes', async () => {
    const loaded = loadSatpRoutesWithMocks({
      v3Score: null,
      explorerAgents: [{
        pda: 'ExplorerPda111',
        authority: 'Authority111',
        agentName: 'brainTEST',
        reputationScore: 620,
        rawReputationScore: 6200000,
        verificationLevel: 3,
        verificationLabel: 'Established',
        isBorn: true,
        isActive: true,
      }],
    });
    restoreModules = loaded.restore;

    const routes = [];
    loaded.registerSATPRoutes({
      get(route, handler) {
        routes.push({ route, handler });
      },
    });

    const agentRoute = routes.find((entry) => entry.route === '/api/satp/v3/agent/:agentId');
    const scoresRoute = routes.find((entry) => entry.route === '/api/satp/v3/agent/:agentId/scores');
    assert.ok(agentRoute, 'expected per-agent SATP route');
    assert.ok(scoresRoute, 'expected per-agent SATP score route');

    const agentRes = createJsonResponse();
    await agentRoute.handler({ params: { agentId: SAMPLE_AGENT_ID } }, agentRes);

    assert.strictEqual(agentRes.statusCode, 200);
    assert.strictEqual(agentRes.body.ok, true);
    assert.strictEqual(agentRes.body.source, 'satp_v3_genesis_contract');
    assert.strictEqual(agentRes.body.data.onChainRegistered, true);
    assert.strictEqual(agentRes.body.data.trustEvidenceBacked, true);
    assert.strictEqual(agentRes.body.data.isBorn, true);
    assert.strictEqual(agentRes.body.data.isActive, true);
    assert.strictEqual(agentRes.body.data.statusContract, 'v3_genesis_record');

    const scoresRes = createJsonResponse();
    await scoresRoute.handler({ params: { agentId: SAMPLE_AGENT_ID } }, scoresRes);

    assert.strictEqual(scoresRes.statusCode, 200);
    assert.strictEqual(scoresRes.body.ok, true);
    assert.strictEqual(scoresRes.body.source, 'satp_v3_genesis_contract');
    assert.deepStrictEqual(scoresRes.body.data, {
      agentId: SAMPLE_AGENT_ID,
      resolvedAgentId: SAMPLE_AGENT_ID,
      reputationScore: 620,
      reputationPct: '620.00',
      verificationLevel: 3,
      verificationLabel: 'Established',
      isBorn: true,
      isActive: true,
      onChainRegistered: true,
      trustEvidenceBacked: true,
      pda: 'ExplorerPda111',
    });
  });
});
