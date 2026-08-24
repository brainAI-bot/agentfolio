const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const { Connection, PublicKey, VersionedTransaction } = require('@solana/web3.js');

const escrowV3Router = require('../src/routes/escrow-v3-routes');
const {
  buildCreateEscrowTxInstructions,
  deriveEscrowPDA,
  deriveUsdcVaultAuthorityPDA,
  deriveUsdcVaultATA,
  ESCROW_PROGRAM_ID,
  USDC_MINT,
  parseUsdcAmountToBaseUnits,
} = require('../src/lib/escrow-onchain');
const {
  AgentFolio,
  buildSolEscrowCreate,
  buildUsdcEscrowCreate,
} = require('../sdk');
const {
  db,
  saveJob,
  saveProfile,
} = require('../src/lib/database');
const {
  ENABLE_LIVE_ESCROW_ENV,
  ENABLE_WRITES_ENV,
  ESCROW_KILL_SWITCH_ENV,
  LIVE_ESCROW_OWNER_AUTHORIZATION_ENV,
  LIVE_ESCROW_OWNER_AUTHORIZATION_VALUE,
} = require('../src/lib/write-surface-gate');

const VALID_CLIENT = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const VALID_AGENT = '11111111111111111111111111111112';
const JOB_ID = 'usdc-job-806be0c8';
const PRECISION_JOB_ID = 'usdc-precision-806be0c8';
const PRECISION_AGENT_ID = 'agent_usdc_precision_806be0c8';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function decodeTransferCheckedAmount(transactionBase64) {
  const tx = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
  const transferIx = tx.message.compiledInstructions.find((ix) => {
    const programId = tx.message.staticAccountKeys[ix.programIdIndex];
    const data = Buffer.from(ix.data);
    return programId?.equals(TOKEN_PROGRAM_ID) && data[0] === 12;
  });

  assert.ok(transferIx, 'unsigned transaction includes SPL transfer_checked');
  const data = Buffer.from(transferIx.data);
  assert.equal(data[9], 6, 'SPL transfer_checked uses USDC mint decimals');
  return Number(data.readBigUInt64LE(1));
}

function seedPrecisionJob() {
  const now = new Date().toISOString();
  saveProfile({
    id: PRECISION_AGENT_ID,
    name: 'USDC Precision Agent',
    handle: 'usdc-precision-agent',
    wallets: { solana: VALID_AGENT },
    createdAt: now,
    updatedAt: now,
  });
  saveJob({
    id: PRECISION_JOB_ID,
    clientId: 'client_usdc_precision_806be0c8',
    title: 'USDC precision route regression',
    description: 'Preserve exact USDC decimal amount through escrow route',
    selectedAgentId: PRECISION_AGENT_ID,
    createdAt: now,
    updatedAt: now,
  });
  db.prepare('UPDATE jobs SET selected_agent_id = ? WHERE id = ?').run(PRECISION_AGENT_ID, PRECISION_JOB_ID);
}

function cleanupPrecisionJob() {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(PRECISION_JOB_ID);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(PRECISION_AGENT_ID);
  const jobJson = path.join(__dirname, '../data/marketplace/jobs', `${PRECISION_JOB_ID}.json`);
  if (fs.existsSync(jobJson)) fs.unlinkSync(jobJson);
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
    client.escrow.buildUsdcCreate({ ...base, jobId: JOB_ID, amountUSDC: '12.34' }).currency,
    'USDC',
  );
  assert.equal(
    buildUsdcEscrowCreate({ ...base, jobId: JOB_ID, amountUSDC: '9000000000.000001' }).amountUSDC,
    '9000000000.000001',
  );
  assert.throws(
    () => buildUsdcEscrowCreate({ ...base, jobId: JOB_ID, amountUSDC: 0 }),
    /amountUSDC must be a positive decimal amount/,
  );
  assert.throws(
    () => buildUsdcEscrowCreate({ ...base, amountUSDC: 12.34 }),
    /jobId is required/,
  );
});

test('USDC amount conversion honors the mint decimals without silent truncation', () => {
  assert.equal(parseUsdcAmountToBaseUnits('12.34'), 12_340_000);
  assert.equal(parseUsdcAmountToBaseUnits('9000000000.000001'), 9_000_000_000_000_001);
  assert.equal(parseUsdcAmountToBaseUnits(1.234567), 1_234_567);
  assert.throws(
    () => parseUsdcAmountToBaseUnits('0.0000001'),
    /amountUSDC must use at most 6 USDC decimal places/,
  );
});

test('USDC V3 environment gates cannot bypass the pinned provenance mismatch', async () => {
  const previousEnable = process.env[ENABLE_LIVE_ESCROW_ENV];
  const previousOwnerAuth = process.env[LIVE_ESCROW_OWNER_AUTHORIZATION_ENV];
  const previousWrites = process.env[ENABLE_WRITES_ENV];
  const previousKill = process.env[ESCROW_KILL_SWITCH_ENV];
  const originalGetAccountInfo = Connection.prototype.getAccountInfo;
  const originalGetLatestBlockhash = Connection.prototype.getLatestBlockhash;

  process.env[ENABLE_LIVE_ESCROW_ENV] = '1';
  process.env[LIVE_ESCROW_OWNER_AUTHORIZATION_ENV] = LIVE_ESCROW_OWNER_AUTHORIZATION_VALUE;
  process.env[ENABLE_WRITES_ENV] = '1';
  delete process.env[ESCROW_KILL_SWITCH_ENV];
  Connection.prototype.getAccountInfo = async () => null;
  Connection.prototype.getLatestBlockhash = async () => ({
    blockhash: '11111111111111111111111111111111',
    lastValidBlockHeight: 1,
  });
  cleanupPrecisionJob();
  seedPrecisionJob();

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
        agentId: PRECISION_AGENT_ID,
        jobId: PRECISION_JOB_ID,
        currency: 'USDC',
        amountUSDC: '9000000000.000001',
        description: 'usdc precision live route regression',
        deadlineUnix: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 423);
    assert.equal(body.code, 'ESCROW_V3_PROVENANCE_MISMATCH');
    assert.equal(body.escrowProvenance.failClosed, true);
    assert.equal(body.escrowProvenance.liveEscrowWritesAllowed, false);
    assert.ok(body.escrowProvenance.mismatches.includes('source_build_deployed_runtime_mismatch'));
    assert.ok(body.escrowProvenance.mismatches.includes('source_idl_published_idl_mismatch'));
    assert.equal(body.transaction, undefined);
  } finally {
    cleanupPrecisionJob();
    Connection.prototype.getAccountInfo = originalGetAccountInfo;
    Connection.prototype.getLatestBlockhash = originalGetLatestBlockhash;
    if (previousEnable === undefined) delete process.env[ENABLE_LIVE_ESCROW_ENV];
    else process.env[ENABLE_LIVE_ESCROW_ENV] = previousEnable;
    if (previousOwnerAuth === undefined) delete process.env[LIVE_ESCROW_OWNER_AUTHORIZATION_ENV];
    else process.env[LIVE_ESCROW_OWNER_AUTHORIZATION_ENV] = previousOwnerAuth;
    if (previousWrites === undefined) delete process.env[ENABLE_WRITES_ENV];
    else process.env[ENABLE_WRITES_ENV] = previousWrites;
    if (previousKill === undefined) delete process.env[ESCROW_KILL_SWITCH_ENV];
    else process.env[ESCROW_KILL_SWITCH_ENV] = previousKill;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
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
    /amountUSDC must be a positive USDC amount/,
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
