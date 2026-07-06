const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const { PublicKey } = require('@solana/web3.js');

const escrowV3Router = require('../src/routes/escrow-v3-routes');
const {
  buildCreateEscrowTxInstructions,
  deriveEscrowPDA,
  deriveUsdcVaultAuthorityPDA,
  deriveUsdcVaultATA,
  ESCROW_PROGRAM_ID,
  USDC_MINT,
} = require('../src/lib/escrow-onchain');
const {
  AgentFolio,
  buildSolEscrowCreate,
  buildUsdcEscrowCreate,
} = require('../sdk');

const VALID_CLIENT = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const VALID_AGENT = '11111111111111111111111111111112';
const JOB_ID = 'usdc-job-806be0c8';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('SDK builders require explicit SOL or USDC currency construction', () => {
  const base = {
    clientWallet: VALID_CLIENT,
    agentWallet: VALID_AGENT,
    agentId: 'agent_selected',
    description: 'dual currency builder regression',
    deadlineUnix: 2_000_000_000,
  };
  const client = new AgentFolio({ apiKey: 'test' });

  assert.deepEqual(
    client.escrow.buildSolCreate({ ...base, amountLamports: 10_000 }),
    buildSolEscrowCreate({ ...base, amountLamports: 10_000 }),
  );
  assert.equal(client.escrow.buildSolCreate({ ...base, amountLamports: 10_000 }).currency, 'SOL');
  assert.equal(
    client.escrow.buildUsdcCreate({ ...base, jobId: JOB_ID, amountUSDC: 12.34 }).currency,
    'USDC',
  );
  assert.equal(
    buildUsdcEscrowCreate({ ...base, jobId: JOB_ID, amountUSDC: 12.34 }).amountUSDC,
    12.34,
  );
  assert.throws(
    () => buildUsdcEscrowCreate({ ...base, jobId: JOB_ID, amountUSDC: 0 }),
    /amountUSDC must be a positive number/,
  );
});

test('USDC escrow builder derives SPL vault PDA, ATAs, and transfer_checked path', async () => {
  const client = new PublicKey(VALID_CLIENT);
  const [escrowPDA] = deriveEscrowPDA(JOB_ID);
  const [vaultAuthorityPDA] = deriveUsdcVaultAuthorityPDA(JOB_ID);
  const vaultATA = await deriveUsdcVaultATA(JOB_ID);
  const clientATA = await getAssociatedTokenAddress(USDC_MINT, client);

  const build = await buildCreateEscrowTxInstructions({
    clientWallet: VALID_CLIENT,
    jobId: JOB_ID,
    amountUSDC: 12.34,
    deadlineUnix: 2_000_000_000,
    vaultAtaExists: false,
  });

  assert.equal(build.amountRaw, 12_340_000);
  assert.equal(build.escrowPDA.toBase58(), escrowPDA.toBase58());
  assert.equal(build.vaultPDA.toBase58(), vaultAuthorityPDA.toBase58());
  assert.equal(build.vaultATA.toBase58(), vaultATA.toBase58());
  assert.equal(build.clientATA.toBase58(), clientATA.toBase58());
  assert.equal(build.mint.toBase58(), USDC_MINT.toBase58());
  assert.equal(build.instructions.length, 3);

  const [createAtaIx, transferIx, programIx] = build.instructions;
  assert.equal(createAtaIx.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
  assert.equal(transferIx.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.equal(transferIx.data[0], 12, 'SPL Token transfer_checked instruction');
  assert.equal(programIx.programId.toBase58(), ESCROW_PROGRAM_ID.toBase58());
  assert.equal(programIx.keys[0].pubkey.toBase58(), escrowPDA.toBase58());
  assert.equal(programIx.keys[1].pubkey.toBase58(), vaultATA.toBase58());
  assert.equal(programIx.keys[2].pubkey.toBase58(), clientATA.toBase58());
  assert.equal(programIx.keys[3].pubkey.toBase58(), USDC_MINT.toBase58());
  assert.equal(programIx.keys[5].pubkey.toBase58(), vaultAuthorityPDA.toBase58());
});

test('USDC escrow builder skips vault ATA creation when the vault ATA already exists', async () => {
  const build = await buildCreateEscrowTxInstructions({
    clientWallet: VALID_CLIENT,
    jobId: JOB_ID,
    amountUSDC: 1,
    deadlineUnix: 2_000_000_000,
    vaultAtaExists: true,
  });

  assert.equal(build.instructions.length, 2);
  assert.equal(build.instructions[0].programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.equal(build.instructions[0].data[0], 12, 'SPL Token transfer_checked instruction');
});

test('USDC escrow builder rejects amounts below one USDC base unit', async () => {
  await assert.rejects(
    () => buildCreateEscrowTxInstructions({
      clientWallet: VALID_CLIENT,
      jobId: JOB_ID,
      amountUSDC: 0.0000001,
      deadlineUnix: 2_000_000_000,
      vaultAtaExists: true,
    }),
    /amountUSDC must convert to a positive safe integer/,
  );
});

test('USDC V3 create remains fail-closed behind the live escrow gate', async () => {
  const previousEnable = process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  const previousKill = process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
  delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;

  const app = express();
  app.use(express.json());
  app.use('/api/v3/escrow', escrowV3Router);
  const server = await listen(app);

  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/v3/escrow/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientWallet: VALID_CLIENT,
        agentWallet: VALID_AGENT,
        agentId: 'agent_selected',
        jobId: JOB_ID,
        currency: 'USDC',
        amountUSDC: 12.34,
        description: 'usdc gate regression',
        deadlineUnix: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 423);
    assert.equal(body.code, 'LIVE_ESCROW_WRITES_READ_ONLY');
    assert.equal(body.liveEscrow.enabled, false);
    assert.equal(body.liveEscrow.mainnetLiveFundsCleared, false);
    assert.equal(body.transaction, undefined);
  } finally {
    if (previousEnable === undefined) delete process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
    else process.env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES = previousEnable;
    if (previousKill === undefined) delete process.env.AGENTFOLIO_ESCROW_KILL_SWITCH;
    else process.env.AGENTFOLIO_ESCROW_KILL_SWITCH = previousKill;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
