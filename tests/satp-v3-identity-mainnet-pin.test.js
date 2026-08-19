const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const ROOT = path.join(__dirname, '..');
const IDENTITY_PATH = path.resolve(ROOT, 'src/routes/satp-auto-identity-v3.js');
const { READ_ONLY_CODE, LIVE_ESCROW_READ_ONLY_CODE, BOA_READ_ONLY_CODE } = require('../src/lib/write-surface-gate');

const TEST_WALLET = '2op4BBEhNBEf3qSv9S4p8ph1QSkJFuC4wgrhNFxDJncZ';
const TEST_PROFILE = 'agent_p1reg_35028542';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

function loadIdentityModule({ satpNetwork, solanaRpcUrl } = {}) {
  const previousSATP = process.env.SATP_NETWORK;
  const previousRPC = process.env.SOLANA_RPC_URL;

  if (satpNetwork === undefined) delete process.env.SATP_NETWORK;
  else process.env.SATP_NETWORK = satpNetwork;

  if (solanaRpcUrl === undefined) delete process.env.SOLANA_RPC_URL;
  else process.env.SOLANA_RPC_URL = solanaRpcUrl;

  delete require.cache[IDENTITY_PATH];
  const mod = require(IDENTITY_PATH);
  return {
    mod,
    restore() {
      delete require.cache[IDENTITY_PATH];
      if (previousSATP === undefined) delete process.env.SATP_NETWORK;
      else process.env.SATP_NETWORK = previousSATP;
      if (previousRPC === undefined) delete process.env.SOLANA_RPC_URL;
      else process.env.SOLANA_RPC_URL = previousRPC;
    },
  };
}

function stubIdentityRpc(connection) {
  const calls = [];
  const originals = {};
  const stubs = {
    async getAccountInfo() {
      calls.push({ method: 'getAccountInfo', rpc: connection.rpcEndpoint });
      return null;
    },
    async getLatestBlockhash() {
      calls.push({ method: 'getLatestBlockhash', rpc: connection.rpcEndpoint });
      return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 };
    },
    async getProgramAccounts() {
      calls.push({ method: 'getProgramAccounts', rpc: connection.rpcEndpoint });
      return [];
    },
    async getMinimumBalanceForRentExemption() {
      calls.push({ method: 'getMinimumBalanceForRentExemption', rpc: connection.rpcEndpoint });
      return 2039280;
    },
    async getFeeForMessage() {
      calls.push({ method: 'getFeeForMessage', rpc: connection.rpcEndpoint });
      return { value: 5000 };
    },
    async getBalance() {
      calls.push({ method: 'getBalance', rpc: connection.rpcEndpoint });
      return 50_000_000;
    },
  };

  for (const [method, impl] of Object.entries(stubs)) {
    originals[method] = connection[method].bind(connection);
    connection[method] = impl;
  }

  return {
    calls,
    restore() {
      for (const [method, impl] of Object.entries(originals)) {
        connection[method] = impl;
      }
    },
  };
}

function assertNotDevnetRpc(rpc) {
  assert.ok(rpc, 'expected an RPC endpoint to be recorded');
  assert.doesNotMatch(String(rpc), /api\.devnet\.solana\.com/);
  assert.doesNotMatch(String(rpc), /devnet/i);
}

let loaded = null;
afterEach(() => {
  if (loaded) {
    loaded.restore();
    loaded = null;
  }
});

describe('SATP V3 identity join is pinned to mainnet', () => {
  it('does not follow SATP_NETWORK=devnet for the GTpp join path', () => {
    const source = fs.readFileSync(IDENTITY_PATH, 'utf8');
    assert.match(source, /const NETWORK = 'mainnet-beta'/);
    assert.match(source, /resolveIdentityMainnetRpcUrl/);
    assert.doesNotMatch(source, /NETWORK === ['"]devnet['"]/);
    assert.doesNotMatch(source, /api\.devnet\.solana\.com/);
    assert.ok(!source.includes("process.env.SATP_NETWORK || 'mainnet'"));
  });

  it('uses SOLANA_RPC_URL only when it is a mainnet URL', () => {
    loaded = loadIdentityModule({ satpNetwork: 'devnet' });
    const { isMainnetRpcUrl, resolveIdentityMainnetRpcUrl, MAINNET_BETA_RPC } = loaded.mod;
    assert.equal(isMainnetRpcUrl('https://api.mainnet-beta.solana.com'), true);
    assert.equal(isMainnetRpcUrl('https://mainnet.helius-rpc.com/?api-key=test'), true);
    assert.equal(isMainnetRpcUrl('https://api.devnet.solana.com'), false);
    assert.equal(isMainnetRpcUrl('https://api.testnet.solana.com'), false);
    assert.equal(isMainnetRpcUrl(''), false);
    assert.equal(resolveIdentityMainnetRpcUrl('https://api.devnet.solana.com'), MAINNET_BETA_RPC);
    assert.equal(resolveIdentityMainnetRpcUrl('https://api.mainnet-beta.solana.com'), 'https://api.mainnet-beta.solana.com');
    assert.equal(resolveIdentityMainnetRpcUrl(undefined), MAINNET_BETA_RPC);
  });

  it('check and create report mainnet-beta when SATP_NETWORK=devnet', async () => {
    loaded = loadIdentityModule({
      satpNetwork: 'devnet',
      solanaRpcUrl: 'https://api.devnet.solana.com',
    });
    const { mod } = loaded;
    assert.equal(mod.NETWORK, 'mainnet-beta');
    assertNotDevnetRpc(mod.RPC_URL);
    assertNotDevnetRpc(mod.connection.rpcEndpoint);

    const rpc = stubIdentityRpc(mod.connection);
    const app = express();
    app.use(express.json());
    mod.registerSATPAutoIdentityV3Routes(app);
    const server = await listen(app);

    try {
      const { port } = server.address();
      const checkRes = await fetch(`http://127.0.0.1:${port}/api/satp-auto/v3/identity/check/${TEST_PROFILE}`);
      const checkBody = await checkRes.json();
      assert.equal(checkRes.status, 200);
      assert.equal(checkBody.ok, true);
      assert.equal(checkBody.network, 'mainnet-beta');
      assert.notEqual(checkBody.network, 'devnet');
      assert.equal(checkBody.v3.program, 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');

      const createRes = await fetch(`http://127.0.0.1:${port}/api/satp-auto/v3/identity/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: TEST_WALLET,
          profileId: TEST_PROFILE,
        }),
      });
      const createBody = await createRes.json();
      assert.notEqual(createRes.status, 423);
      assert.equal(createRes.status, 200, createBody.detail || createBody.error || JSON.stringify(createBody));
      assert.equal(createBody.ok, true);
      assert.equal(createBody.data.network, 'mainnet-beta');
      assert.notEqual(createBody.data.network, 'devnet');
      assert.equal(createBody.data.program, 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
      assert.equal(createBody.data.alreadyExists, false);
      assert.ok(createBody.data.transaction);

      const accountInfoCalls = rpc.calls.filter((c) => c.method === 'getAccountInfo');
      const blockhashCalls = rpc.calls.filter((c) => c.method === 'getLatestBlockhash');
      assert.ok(accountInfoCalls.length >= 1, 'expected getAccountInfo to run');
      assert.ok(blockhashCalls.length >= 1, 'expected getLatestBlockhash to run');
      for (const call of [...accountInfoCalls, ...blockhashCalls]) {
        assertNotDevnetRpc(call.rpc);
      }
    } finally {
      rpc.restore();
      await close(server);
    }
  });

  it('unsigned SATP join is still not 423 while escrow and BOA POSTs stay 423', async () => {
    const previousIrys = process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES;
    const previousEnable = process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    const previousOwner = process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
    const previousKill = process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
    delete process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES;
    delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    delete process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
    delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;

    loaded = loadIdentityModule({ satpNetwork: 'devnet' });
    const app = express();
    app.use(express.json());
    loaded.mod.registerSATPAutoIdentityV3Routes(app);
    app.use('/api/v3/escrow', require('../src/routes/escrow-v3-routes'));
    app.post('/api/boa/mint', (req, res) => {
      const { sendBoaWriteGateResponse } = require('../src/lib/write-surface-gate');
      if (sendBoaWriteGateResponse(res, 'BOA mint transaction build')) return;
      res.json({ ok: true });
    });
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
        escrowBody.code === LIVE_ESCROW_READ_ONLY_CODE
          || escrowBody.code === 'ESCROW_KILL_SWITCH_ACTIVE'
          || String(escrowBody.code || '').includes('ESCROW')
          || String(escrowBody.code || '').includes('READ_ONLY'),
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
      if (previousIrys === undefined) delete process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES;
      else process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES = previousIrys;
      if (previousEnable === undefined) delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
      else process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = previousEnable;
      if (previousOwner === undefined) delete process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
      else process.env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION = previousOwner;
      if (previousKill === undefined) delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
      else process.env.AGENTFOLIO_ESCROW_KILL_SWITCH = previousKill;
    }
  });
});
