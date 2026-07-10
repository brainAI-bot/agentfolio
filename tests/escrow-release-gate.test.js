const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const path = require('path');

const {
  CUSTODIAL_ESCROW_DISABLED_CODE,
  ENABLE_LIVE_ESCROW_ENV,
  ENABLE_WRITES_ENV,
  ESCROW_KILL_SWITCH_CODE,
  ESCROW_KILL_SWITCH_ENV,
  LEGACY_ESCROW_ROUTE_DISABLED_CODE,
  LIVE_ESCROW_READ_ONLY_CODE,
} = require('../src/lib/write-surface-gate');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

function freshEscrowModule() {
  const modulePath = require.resolve('../src/lib/escrow');
  delete require.cache[modulePath];
  const previousWallet = process.env.ESCROW_WALLET;
  delete process.env.ESCROW_WALLET;
  const escrow = require('../src/lib/escrow');
  if (previousWallet === undefined) delete process.env.ESCROW_WALLET;
  else process.env.ESCROW_WALLET = previousWallet;
  return escrow;
}

function freshSolanaEscrowModule() {
  const modulePath = require.resolve('../src/lib/solana-escrow');
  delete require.cache[modulePath];
  return require('../src/lib/solana-escrow');
}

async function withEnv(overrides, callback) {
  const previous = new Map();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function assertLiveEscrowBlocked(err, code = LIVE_ESCROW_READ_ONLY_CODE) {
  assert.equal(err.code, code);
  assert.equal(err.statusCode, 423);
  return true;
}

function withMarketplaceDbStub(dbStub, callback) {
  const dbPath = require.resolve('../src/lib/database');
  const marketplacePath = require.resolve('../src/lib/marketplace');
  const previousDbModule = require.cache[dbPath];
  const previousMarketplaceModule = require.cache[marketplacePath];

  delete require.cache[marketplacePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: dbStub,
  };

  try {
    return callback(require('../src/lib/marketplace'));
  } finally {
    delete require.cache[marketplacePath];
    if (previousMarketplaceModule) require.cache[marketplacePath] = previousMarketplaceModule;
    if (previousDbModule) require.cache[dbPath] = previousDbModule;
    else delete require.cache[dbPath];
  }
}

test('dormant Solana custodial signer path is gated by live escrow flag, not Solana/Irys flag', async () => {
  await withEnv({
    [ENABLE_WRITES_ENV]: '1',
    [ENABLE_LIVE_ESCROW_ENV]: undefined,
    [ESCROW_KILL_SWITCH_ENV]: undefined,
  }, async () => {
    const escrow = freshSolanaEscrowModule();

    assert.throws(
      () => escrow.getEscrowKeypair(),
      (err) => assertLiveEscrowBlocked(err),
    );
    assert.throws(
      () => escrow.getClientKeypair(),
      (err) => assertLiveEscrowBlocked(err),
    );
    await assert.rejects(
      () => escrow.depositToEscrow(1),
      (err) => assertLiveEscrowBlocked(err),
    );
    await assert.rejects(
      () => escrow.releaseFromEscrow('11111111111111111111111111111111', 1),
      (err) => assertLiveEscrowBlocked(err),
    );
    await assert.rejects(
      () => escrow.getEscrowBalance(),
      (err) => assertLiveEscrowBlocked(err),
    );
    await assert.rejects(
      () => escrow.getClientBalance(),
      (err) => assertLiveEscrowBlocked(err),
    );
    await assert.rejects(
      () => escrow.verifyDeposit('not-a-signature', 1),
      (err) => assertLiveEscrowBlocked(err),
    );
  });
});

test('custodial Solana escrow honors the live escrow kill switch', async () => {
  await withEnv({
    [ENABLE_WRITES_ENV]: '1',
    [ENABLE_LIVE_ESCROW_ENV]: '1',
    [ESCROW_KILL_SWITCH_ENV]: '1',
  }, async () => {
    const escrow = freshSolanaEscrowModule();
    await assert.rejects(
      () => escrow.depositToEscrow(1),
      (err) => assertLiveEscrowBlocked(err, ESCROW_KILL_SWITCH_CODE),
    );
  });
});

test('admin escrow wallet setup is gated before keypair generation', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../scripts/admin/setup-escrow-wallet.js'),
    'utf8',
  );
  const gateIndex = source.indexOf("assertLiveEscrowWriteEnabled('custodial escrow wallet setup')");
  const generateIndex = source.indexOf('Keypair.generate');

  assert.ok(gateIndex >= 0, 'setup script is missing live escrow gate');
  assert.ok(generateIndex >= 0, 'setup script is missing keypair generation marker');
  assert.ok(gateIndex < generateIndex, 'setup script must gate before keypair generation');
});

test('custodial escrow library fails closed before keypair or funds state changes', async () => {
  const escrow = freshEscrowModule();

  assert.equal(escrow.PLATFORM_ESCROW_WALLET, 'CUSTODIAL_ESCROW_DISABLED');

  const blocked = [
    escrow.createEscrow('job_1', { amount: 1, clientId: 'client' }),
    escrow.confirmDeposit('escrow_1', 'tx'),
    escrow.lockFunds('escrow_1', 'agent', 'wallet'),
    escrow.startWork('escrow_1'),
    escrow.submitWork('escrow_1'),
    escrow.refundClient('escrow_1', 'reason'),
    escrow.openDispute('escrow_1', { openedBy: 'client' }),
    escrow.resolveDispute('dispute_1', 'release_to_agent', 'arbiter'),
    await escrow.cancelWithCompensation('escrow_1', 'reason'),
    await escrow.releaseFunds('escrow_1'),
    await escrow.autoRelease('escrow_1'),
  ];

  for (const result of blocked) {
    assert.equal(result.code, CUSTODIAL_ESCROW_DISABLED_CODE);
    assert.equal(result.statusCode, 423);
    assert.match(result.error, /Custodial escrow writes are permanently disabled/);
  }

  const scanResult = await escrow.scanAutoRelease();
  assert.equal(scanResult[0].code, CUSTODIAL_ESCROW_DISABLED_CODE);
});

test('marketplace job creation does not persist required custodial escrow drafts', () => {
  let saveJobCalls = 0;
  const result = withMarketplaceDbStub({
    loadProfile: () => ({ id: 'client_1', wallets: { solana: 'client_wallet' } }),
    saveJob: (job) => {
      saveJobCalls += 1;
      return job;
    },
  }, (marketplace) => marketplace.createJob({
    clientId: 'client_1',
    title: 'blocked escrow job',
    description: 'must not persist without safe escrow',
    budgetAmount: 1,
  }));

  assert.equal(result.code, CUSTODIAL_ESCROW_DISABLED_CODE);
  assert.equal(result.statusCode, 423);
  assert.equal(saveJobCalls, 0);
});

test('legacy marketplace custodial escrow endpoints return the release gate blocker', async () => {
  const app = express();
  app.use(express.json());
  require('../src/marketplace').registerRoutes(app);
  const server = await listen(app);

  try {
    const { port } = server.address();
    const paths = [
      '/api/marketplace/jobs/job_gate/escrow',
      '/api/marketplace/escrow/escrow_gate/release',
      '/api/marketplace/escrow/escrow_gate/refund',
    ];

    for (const path of paths) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      assert.equal(res.status, 423);
      assert.equal(body.code, CUSTODIAL_ESCROW_DISABLED_CODE);
    }
  } finally {
    await close(server);
  }
});

test('legacy non-V3 escrow transaction builders cannot bypass identity-gated escrow', async () => {
  const previousEnable = process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = '1';

  const app = express();
  app.use(express.json());
  app.use('/api/escrow', require('../src/routes/escrow-routes'));
  const server = await listen(app);

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/escrow/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json();

    assert.equal(res.status, 423);
    assert.equal(body.code, LEGACY_ESCROW_ROUTE_DISABLED_CODE);
    assert.match(body.error, /bypass SATP V3 identity-gated escrow checks/);
  } finally {
    if (previousEnable === undefined) delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    else process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = previousEnable;
    await close(server);
  }
});

test('V3 release and refund-like POST paths stay live-funds gated before validation', async () => {
  const previousEnable = process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  const previousKill = process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
  delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;

  const app = express();
  app.use(express.json());
  app.use('/api/v3/escrow', require('../src/routes/escrow-v3-routes'));
  const server = await listen(app);

  try {
    const { port } = server.address();
    for (const path of ['/release', '/partial-release', '/cancel', '/resolve']) {
      const res = await fetch(`http://127.0.0.1:${port}/api/v3/escrow${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      assert.equal(res.status, 423);
      assert.equal(body.code, LIVE_ESCROW_READ_ONLY_CODE);
    }
  } finally {
    if (previousEnable === undefined) delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    else process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = previousEnable;
    if (previousKill === undefined) delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
    else process.env.AGENTFOLIO_ESCROW_KILL_SWITCH = previousKill;
    await close(server);
  }
});
