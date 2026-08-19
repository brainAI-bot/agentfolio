const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const { isOnChainIdentity } = require('../src/lib/onchain-identity');
const { isFixtureIdentity } = require('../src/lib/public-traction');
const { READ_ONLY_CODE, LIVE_ESCROW_READ_ONLY_CODE, BOA_READ_ONLY_CODE } = require('../src/lib/write-surface-gate');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe('SATP V3 join restore', () => {
  it('mounts V3 auto-identity routes from server.js', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
    assert.match(source, /registerSATPAutoIdentityV3Routes\(app\)/);
    assert.match(source, /satp-auto-identity-v3/);
    assert.doesNotMatch(source, /registerRestoredRoutes\(/);
  });

  it('frontend uses V3 program and mounted V3 routes, not V2 97yL33 auto-create', () => {
    const verify = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'app', 'verify', 'page.tsx'), 'utf8');
    const register = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'app', 'register', 'page.tsx'), 'utf8');
    const v3Client = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'lib', 'satp-identity-v3.ts'), 'utf8');
    const programs = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'lib', 'satp-mainnet-programs.ts'), 'utf8');

    assert.match(programs, /GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG/);
    assert.match(v3Client, /\/api\/satp-auto\/v3\/identity\/create/);
    assert.match(v3Client, /\/api\/satp-auto\/v3\/identity\/confirm/);
    assert.match(v3Client, /\/api\/satp-auto\/v3\/identity\/check\//);
    assert.doesNotMatch(v3Client, /97yL33/);
    assert.doesNotMatch(v3Client, /assertFrontendSolanaIrysWriteEnabled/);

    assert.match(verify, /satp-identity-v3/);
    assert.match(verify, /\/api\/satp-auto\/v3\/identity\/confirm/);
    assert.doesNotMatch(verify, /satp-identity-v2/);
    assert.doesNotMatch(verify, /97yL33/);
    assert.doesNotMatch(verify, /assertFrontendSolanaIrysWriteEnabled\("frontend SATP identity auto-create"\)/);
    assert.doesNotMatch(verify, /assertFrontendSolanaIrysWriteEnabled\("frontend manual SATP identity registration"\)/);

    assert.match(register, /\/api\/satp-auto\/v3\/identity\/create/);
    assert.match(register, /\/api\/satp-auto\/v3\/identity\/confirm/);
    assert.doesNotMatch(register, /assertFrontendSolanaIrysWriteEnabled/);
  });

  it('unsigned SATP identity/genesis builders are not Irys-gated; server-signed register stays gated', () => {
    const writeApi = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'satp-write-api.js'), 'utf8');
    const writeClient = fs.readFileSync(path.join(ROOT, 'src', 'satp-write-client.js'), 'utf8');
    const profileStore = fs.readFileSync(path.join(ROOT, 'src', 'profile-store.js'), 'utf8');
    const v3 = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'satp-auto-identity-v3.js'), 'utf8');

    const buildStart = writeApi.indexOf("app.post('/api/satp/register/build'");
    const buildEnd = writeApi.indexOf("app.post('/api/satp/reputation/submit'");
    assert.notEqual(buildStart, -1);
    const buildRoute = writeApi.slice(buildStart, buildEnd);
    assert.ok(!buildRoute.includes('sendSolanaIrysWriteGateResponse'), 'register/build must not be Irys gated');

    const registerStart = writeApi.indexOf("app.post('/api/satp/register'");
    const registerRoute = writeApi.slice(registerStart, buildStart);
    assert.ok(registerRoute.includes('sendSolanaIrysWriteGateResponse'), 'server-signed /api/satp/register stays gated');

    const genesisStart = profileStore.indexOf("app.post('/api/satp/genesis/prepare'");
    const genesisEnd = profileStore.indexOf("app.get('/api/profiles'");
    assert.notEqual(genesisStart, -1);
    const genesisRoute = profileStore.slice(genesisStart, genesisEnd);
    assert.ok(!genesisRoute.includes('sendSolanaIrysWriteGateResponse'), 'genesis/prepare must not be Irys gated');

    assert.ok(!writeClient.includes("assertSolanaIrysWriteEnabled('SATP identity registration transaction build')"));
    assert.ok(!writeClient.includes("assertSolanaIrysWriteEnabled('SATP V3 genesis transaction build')"));
    assert.ok(writeClient.includes("assertSolanaIrysWriteEnabled('SATP identity registration')"));
    assert.ok(writeClient.includes("assertSolanaIrysWriteEnabled('SATP V3 genesis registration')"));

    assert.match(v3, /app\.post\('\/api\/satp-auto\/v3\/identity\/create'/);
    assert.match(v3, /app\.post\('\/api\/satp-auto\/v3\/identity\/confirm'/);
    assert.match(v3, /app\.get\('\/api\/satp-auto\/v3\/identity\/check\/:agentId'/);
    assert.ok(!v3.includes('sendSolanaIrysWriteGateResponse'));
    assert.ok(!v3.includes('410'));
  });

  it('mounted V3 create is not 423 when Irys writes are disabled', async () => {
    const previous = process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES;
    delete process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES;

    const app = express();
    app.use(express.json());
    const { registerSATPAutoIdentityV3Routes } = require('../src/routes/satp-auto-identity-v3');
    registerSATPAutoIdentityV3Routes(app);
    const { registerSATPWriteRoutes } = require('../src/routes/satp-write-api');
    registerSATPWriteRoutes(app);
    const server = await listen(app);

    try {
      const { port } = server.address();
      const createRes = await fetch(`http://127.0.0.1:${port}/api/satp-auto/v3/identity/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const createBody = await createRes.json();
      assert.notEqual(createRes.status, 423);
      assert.equal(createRes.status, 400);
      assert.equal(createBody.error, 'walletAddress required');
      assert.notEqual(createBody.code, READ_ONLY_CODE);

      const confirmRes = await fetch(`http://127.0.0.1:${port}/api/satp-auto/v3/identity/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const confirmBody = await confirmRes.json();
      assert.notEqual(confirmRes.status, 423);
      assert.notEqual(confirmRes.status, 410);
      assert.equal(confirmRes.status, 400);
      assert.notEqual(confirmBody.code, READ_ONLY_CODE);

      const buildRes = await fetch(`http://127.0.0.1:${port}/api/satp/register/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const buildBody = await buildRes.json();
      assert.notEqual(buildRes.status, 423);
      assert.equal(buildRes.status, 400);
      assert.notEqual(buildBody.code, READ_ONLY_CODE);

      const registerRes = await fetch(`http://127.0.0.1:${port}/api/satp/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', description: 'y', category: 'z' }),
      });
      const registerBody = await registerRes.json();
      assert.equal(registerRes.status, 423);
      assert.equal(registerBody.code, READ_ONLY_CODE);
    } finally {
      await close(server);
      if (previous === undefined) delete process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES;
      else process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES = previous;
    }
  });

  it('escrow and BOA POSTs stay 423', async () => {
    const previousEnable = process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    const previousOwner = process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
    const previousKill = process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
    delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    delete process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
    delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;

    const app = express();
    app.use(express.json());
    app.use('/api/v3/escrow', require('../src/routes/escrow-v3-routes'));
    app.post('/api/boa/mint', (req, res) => {
      const { sendBoaWriteGateResponse } = require('../src/lib/write-surface-gate');
      if (sendBoaWriteGateResponse(res, 'BOA mint transaction build')) return;
      res.json({ ok: true });
    });
    const server = await listen(app);

    try {
      const { port } = server.address();
      const escrowRes = await fetch(`http://127.0.0.1:${port}/api/v3/escrow/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientWallet: 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be',
          selectedAgent: '11111111111111111111111111111112',
          amount: 1,
        }),
      });
      const escrowBody = await escrowRes.json();
      assert.equal(escrowRes.status, 423);
      assert.ok(
        escrowBody.code === LIVE_ESCROW_READ_ONLY_CODE || escrowBody.code === 'ESCROW_KILL_SWITCH_ACTIVE'
        || String(escrowBody.code || '').includes('ESCROW') || String(escrowBody.code || '').includes('READ_ONLY'),
      );

      const boaRes = await fetch(`http://127.0.0.1:${port}/api/boa/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be' }),
      });
      const boaBody = await boaRes.json();
      assert.equal(boaRes.status, 423);
      assert.equal(boaBody.code, BOA_READ_ONLY_CODE);
    } finally {
      await close(server);
      if (previousEnable === undefined) delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
      else process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = previousEnable;
      if (previousOwner === undefined) delete process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
      else process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION = previousOwner;
      if (previousKill === undefined) delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
      else process.env.AGENTFOLIO_ESCROW_KILL_SWITCH = previousKill;
    }
  });

  it('onChain counts only real SATP-joined or solana-verified non-fixtures', () => {
    const rows = [
      { id: 'agent_real_satp', name: 'RealSatp', handle: 'realsatp', verification_data: { satp_v3: { verified: true, genesisPDA: 'PDA1' } } },
      { id: 'agent_real_solana', name: 'RealSolana', handle: 'realsolana', verification_data: { solana: { verified: true, address: 'So1' } } },
      { id: 'agent_github_only', name: 'GithubOnly', handle: 'githubonly', verification_data: { github: { verified: true } } },
      { id: 'agent_sm423064591', name: 'Smoke', handle: 'smoke', verification_data: { satp_v3: { verified: true, genesisPDA: 'PDA2' } } },
      { id: 'forgetest', name: 'forgetest', handle: 'forgetest', verification_data: { solana: { verified: true } } },
    ];
    const publicRows = rows.filter((row) => !isFixtureIdentity(row.id, row.name, row.handle));
    const onChain = publicRows.filter((row) => isOnChainIdentity(row.verification_data)).length;
    assert.equal(onChain, 2);
    assert.equal(isOnChainIdentity({ satp_v3: { verified: true, genesisPDA: 'x' } }), true);
    assert.equal(isOnChainIdentity({ solana: { verified: true } }), true);
    assert.equal(isOnChainIdentity({ github: { verified: true } }), false);
    assert.equal(isOnChainIdentity({}), false);
    assert.equal(isFixtureIdentity('agent_sm423064591'), true);
    assert.equal(isFixtureIdentity('agent_brainforge', 'brainForge'), false);
  });

  it('stats payload uses isOnChainIdentity instead of solana.verified only', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
    assert.match(source, /isOnChainIdentity\(row\.verification_data\)/);
    assert.doesNotMatch(source, /if \(vd\.solana\?\.verified\) onChain\+\+/);
  });

  it('V3 identity join is pinned to mainnet even when SATP_NETWORK=devnet', () => {
    const v3 = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'satp-auto-identity-v3.js'), 'utf8');
    assert.match(v3, /const NETWORK = 'mainnet-beta'/);
    assert.match(v3, /resolveV3IdentityRpcUrl/);
    assert.doesNotMatch(v3, /NETWORK === 'devnet'/);
    assert.doesNotMatch(v3, /api\.devnet\.solana\.com/);
  });

  it('identity check/create advertise mainnet-beta when SATP_NETWORK=devnet', async () => {
    const previousNet = process.env.SATP_NETWORK;
    const previousRpc = process.env.SOLANA_RPC_URL;
    process.env.SATP_NETWORK = 'devnet';
    process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
    const resolved = require.resolve('../src/routes/satp-auto-identity-v3');
    delete require.cache[resolved];
    const mod = require('../src/routes/satp-auto-identity-v3');
    const app = express();
    app.use(express.json());
    mod.registerSATPAutoIdentityV3Routes(app);
    const server = await listen(app);
    try {
      assert.equal(mod.NETWORK, 'mainnet-beta');
      assert.notEqual(mod.RPC_URL, 'https://api.devnet.solana.com');
      assert.match(mod.RPC_URL, /mainnet/);

      const { port } = server.address();
      const checkRes = await fetch(`http://127.0.0.1:${port}/api/satp-auto/v3/identity/check/agent_p1reg_35028542`);
      const checkBody = await checkRes.json();
      assert.equal(checkRes.status, 200);
      assert.equal(checkBody.network, 'mainnet-beta');
      assert.notEqual(checkBody.network, 'devnet');
      assert.equal(checkBody.v3.program, 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
      assert.equal(checkBody.v3.genesisPDA, 'HmuetLjwGoZ3kHt2TKj83pqPYVX9j62mSJWhRw8xAdWg');
    } finally {
      await close(server);
      delete require.cache[resolved];
      if (previousNet === undefined) delete process.env.SATP_NETWORK;
      else process.env.SATP_NETWORK = previousNet;
      if (previousRpc === undefined) delete process.env.SOLANA_RPC_URL;
      else process.env.SOLANA_RPC_URL = previousRpc;
    }
  });


  it('register/build is V3 GTpp mainnet, not leftover SATP_NETWORK', () => {
    const writeApi = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'satp-write-api.js'), 'utf8');
    const buildStart = writeApi.indexOf("app.post('/api/satp/register/build'");
    const buildEnd = writeApi.indexOf("app.post('/api/satp/reputation/submit'");
    const buildRoute = writeApi.slice(buildStart, buildEnd);
    assert.match(buildRoute, /buildCreateIdentityV3Tx/);
    assert.doesNotMatch(buildRoute, /buildRegisterIdentityTx/);
    assert.doesNotMatch(buildRoute, /buildRegisterIdentityTx\([\s\S]*NETWORK/);
    assert.doesNotMatch(buildRoute, /,\s*NETWORK\s*\)/);
  });

  it('register/build returns GTpp mainnet-beta for the persisted p1reg profile', async () => {
    const previousNet = process.env.SATP_NETWORK;
    const previousRpc = process.env.SOLANA_RPC_URL;
    process.env.SATP_NETWORK = 'devnet';
    process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
    const identityPath = require.resolve('../src/routes/satp-auto-identity-v3');
    const writePath = require.resolve('../src/routes/satp-write-api');
    delete require.cache[identityPath];
    delete require.cache[writePath];
    const app = express();
    app.use(express.json());
    const { registerSATPWriteRoutes } = require('../src/routes/satp-write-api');
    registerSATPWriteRoutes(app);
    const server = await listen(app);
    try {
      const { port } = server.address();
      const buildRes = await fetch(`http://127.0.0.1:${port}/api/satp/register/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: '2op4BBEhNBEf3qSv9S4p8ph1QSkJFuC4wgrhNFxDJncZ',
          name: 'p1reg_35028542',
          description: 'x',
          category: 'ai-agent',
        }),
      });
      const buildBody = await buildRes.json();
      assert.equal(buildRes.status, 200);
      assert.equal(buildBody.ok, true);
      assert.equal(buildBody.data.network, 'mainnet-beta');
      assert.notEqual(buildBody.data.network, 'devnet');
      assert.equal(buildBody.data.alreadyExists, true);
      assert.equal(buildBody.data.genesisPDA, 'HmuetLjwGoZ3kHt2TKj83pqPYVX9j62mSJWhRw8xAdWg');
      assert.equal(buildBody.data.identityPDA, 'HmuetLjwGoZ3kHt2TKj83pqPYVX9j62mSJWhRw8xAdWg');
      assert.equal(buildBody.data.program, 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
      assert.equal(buildBody.data.transaction, null);
    } finally {
      await close(server);
      delete require.cache[identityPath];
      delete require.cache[writePath];
      if (previousNet === undefined) delete process.env.SATP_NETWORK;
      else process.env.SATP_NETWORK = previousNet;
      if (previousRpc === undefined) delete process.env.SOLANA_RPC_URL;
      else process.env.SOLANA_RPC_URL = previousRpc;
    }
  });

});
