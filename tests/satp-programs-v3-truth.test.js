const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

const ROUTE_PATH = path.resolve(__dirname, '../src/routes/satp-api.js');
const V3 = {
  IDENTITY: 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG',
  REVIEWS: 'r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4',
  REPUTATION: '2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ',
  ATTESTATIONS: '6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD',
  VALIDATION: '6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV',
  ESCROW: 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C',
};
const V2 = {
  IDENTITY: '97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq',
  REVIEWS: 'Ge1sD2qwmH8QaaKCPZzZERvsFXNVMvKbAgTp2p17yjLK',
  REPUTATION: 'C9ogv8TBrvFy4pLKDoGQg9B73Q5rKPPsQ4kzkcDk6Jd',
  ATTESTATIONS: 'ENvaD19QzwWWMJFu5r5xJ9SmHqWN6GvyzxACRejqbdug',
  VALIDATION: '9p795d2j3eGqzborG2AncucWBaU6PieKxmhKVroV3LNh',
  ESCROW: 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C',
};

function asKeys(map) {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { toBase58: () => v }]));
}

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

function loadSatpRoutes() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../satp-identity-client') {
      return {
        listRegisteredAgents: async () => ({ total: 0 }),
        getAgentIdentity: async () => null,
        getAgentScores: async () => null,
        getAgentAttestations: async () => [],
        getPrograms: () => asKeys(V2),
        getAdvertisedPrograms: () => asKeys(V3),
        getV3ProgramIds: () => asKeys(V3),
        SATP_V3_DESCRIPTION: 'SATP v3 — Solana Agent Trust Protocol. 6-program mainnet cluster (identity, reviews, reputation, attestations, validation, one escrow).',
        LEGACY_PROGRAMS: {
          IDENTITY_V1: { toBase58: () => 'BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr' },
        },
      };
    }
    if (request === '../satp-reviews-onchain') return {};
    if (request === '../adapters/satp') {
      return {
        client: {
          loadSatpClient() {
            return {
              createSATPClient() { return {}; },
              getGenesisPDA() { return [{ toBase58: () => 'DerivedPda111' }]; },
            };
          },
        },
      };
    }
    if (request === '../v3-score-service') return { getGenesisPDA() { return { toBase58: () => 'DerivedPda111' }; } };
    if (request === '../v3-explorer') return { async fetchAllV3Agents() { return []; } };
    if (request === '@solana/web3.js') {
      return { PublicKey: class PublicKey { constructor(value) { this.value = value; } toBase58() { return String(this.value); } } };
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[ROUTE_PATH];
  const loaded = require(ROUTE_PATH);
  return {
    ...loaded,
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

describe('GET /api/satp/programs advertises the V3 cluster', () => {
  it('returns the V3 set, one escrow, and a V3 description', async () => {
    const loaded = loadSatpRoutes();
    restoreModules = loaded.restore;
    const routes = [];
    loaded.registerSATPRoutes({
      get(route, handler) { routes.push({ route, handler }); },
    });
    const programsRoute = routes.find((entry) => entry.route === '/api/satp/programs');
    assert.ok(programsRoute, 'expected /api/satp/programs route');

    const res = createJsonResponse();
    programsRoute.handler({ query: { network: 'mainnet' } }, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.deepStrictEqual(res.body.data.programs, {
      identity: V3.IDENTITY,
      reviews: V3.REVIEWS,
      reputation: V3.REPUTATION,
      attestations: V3.ATTESTATIONS,
      validation: V3.VALIDATION,
      escrow: V3.ESCROW,
    });
    assert.strictEqual(res.body.data.programs.escrow, V3.ESCROW);
    assert.strictEqual(Object.keys(res.body.data.programs).filter((k) => k === 'escrow').length, 1);
    assert.strictEqual(res.body.data.version, 'v3');
    assert.match(res.body.data.description, /SATP v3/);
    assert.doesNotMatch(res.body.data.description, /SATP v2/);
    assert.doesNotMatch(res.body.data.description, /5-program cluster/);
    assert.strictEqual(res.body.data.v2.identity, V2.IDENTITY);
  });
});

describe('backend and frontend V3 registries stay aligned', () => {
  it('keeps src/lib/satp-mainnet-programs.js in lockstep with the TS registry', () => {
    const js = require('../src/lib/satp-mainnet-programs');
    const ts = fs.readFileSync(path.join(__dirname, '../frontend/src/lib/satp-mainnet-programs.ts'), 'utf8');
    for (const [name, id] of Object.entries(js.SATP_MAINNET_PROGRAMS)) {
      assert.match(ts, new RegExp(`${name}:\\s*"${id}"`));
    }
    assert.equal(js.SATP_MAINNET_PROGRAMS.ESCROW, V3.ESCROW);
    assert.equal(Object.values(js.SATP_MAINNET_PROGRAMS).filter((id) => id === V3.ESCROW).length, 1);
  });
});

describe('GET /api/satp/registry labels V1 leftover', () => {
  it('marks BY4j as legacy and points at the V3 explorer list', async () => {
    const loaded = loadSatpRoutes();
    restoreModules = loaded.restore;
    const routes = [];
    loaded.registerSATPRoutes({
      get(route, handler) { routes.push({ route, handler }); },
    });
    const registryRoute = routes.find((entry) => entry.route === '/api/satp/registry');
    assert.ok(registryRoute, 'expected /api/satp/registry route');
    const res = createJsonResponse();
    await registryRoute.handler({ query: { limit: '10', offset: '0' } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.data.legacy, true);
    assert.strictEqual(res.body.data.programVersion, 'v1-legacy');
    assert.strictEqual(res.body.data.programId, 'BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr');
    assert.strictEqual(res.body.data.current.version, 'v3');
    assert.strictEqual(res.body.data.current.programId, V3.IDENTITY);
    assert.strictEqual(res.body.data.current.list, '/api/satp/explorer/agents');
  });
});
