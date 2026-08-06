const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PublicKey } = require('@solana/web3.js');

const SOURCE_PATH = path.resolve(__dirname, '..', 'onchain/escrow_v3/programs/escrow_v3/src/lib.rs');
const IDL_PATH = path.resolve(__dirname, '..', 'onchain/escrow_v3/target/idl/escrow_v3.json');
const ROUTE_PATH = path.resolve(__dirname, '..', 'src/routes/escrow-v3-routes.js');
const USDC_BUILDER_PATH = path.resolve(__dirname, '..', 'src/lib/escrow-onchain.js');
const TREASURY_WALLET = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const CLIENT_WALLET = '11111111111111111111111111111111';
const AGENT_WALLET = 'So11111111111111111111111111111111111111112';
const ESCROW_PDA = 'SysvarRent111111111111111111111111111111111';
const PROGRAM_ID = 'BPFLoaderUpgradeab1e11111111111111111111111';
const escrowV3Router = require('../src/routes/escrow-v3-routes');

function sliceFunction(source, name, nextName) {
  const start = source.indexOf(`pub fn ${name}`);
  const end = source.indexOf(`pub fn ${nextName}`);
  assert.notEqual(start, -1, `${name} missing`);
  assert.notEqual(end, -1, `${nextName} missing`);
  return source.slice(start, end);
}

test('escrow_v3 release and partial_release route platform fee on-chain to treasury', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const release = sliceFunction(source, 'release', 'partial_release');
  const partialRelease = sliceFunction(source, 'partial_release', 'cancel');

  assert.match(source, /const PLATFORM_FEE_BPS: u64 = 500;/);
  assert.match(source, new RegExp(`const PLATFORM_TREASURY: Pubkey = pubkey!\\("${TREASURY_WALLET}"\\);`));
  assert.match(source, /fn calculate_platform_fee_split\(amount: u64\) -> Result<FeeSplit>/);
  assert.match(source, /checked_mul\(PLATFORM_FEE_BPS\)/);
  assert.match(source, /\/ BPS_DENOMINATOR/);
  assert.match(source, /fn transfer_fee_split/);

  for (const fnSource of [release, partialRelease]) {
    const treasuryBinding = fnSource.indexOf('require_keys_eq!(ctx.accounts.treasury.key(), PLATFORM_TREASURY, EscrowError::WrongTreasury)');
    const splitCalculation = fnSource.indexOf('calculate_platform_fee_split(');
    const splitTransfer = fnSource.indexOf('transfer_fee_split(');
    assert.notEqual(treasuryBinding, -1);
    assert.notEqual(splitCalculation, -1);
    assert.notEqual(splitTransfer, -1);
    assert.ok(treasuryBinding < splitTransfer);
    assert.ok(splitCalculation < splitTransfer);
  }
});

test('escrow_v3 IDL requires treasury account for release builders', () => {
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, 'utf8'));
  const release = idl.instructions.find((ix) => ix.name === 'release');
  const partialRelease = idl.instructions.find((ix) => ix.name === 'partial_release');

  for (const instruction of [release, partialRelease]) {
    assert.ok(instruction, 'release instruction missing from IDL');
    assert.deepEqual(
      instruction.accounts.map((account) => account.name),
      ['escrow', 'client', 'agent', 'treasury'],
    );
    assert.equal(instruction.accounts.find((account) => account.name === 'treasury').writable, true);
  }
});

test('escrow_v3 HTTP release builders publish treasury and integer fee readback', () => {
  const routeSource = fs.readFileSync(ROUTE_PATH, 'utf8');

  assert.match(routeSource, new RegExp(`const PLATFORM_TREASURY_WALLET = '${TREASURY_WALLET}'`));
  assert.match(routeSource, /const PLATFORM_FEE_BPS = 500;/);
  assert.match(routeSource, /const platformFee = \(amount \* BigInt\(PLATFORM_FEE_BPS\)\) \/ BigInt\(BPS_DENOMINATOR\);/);
  assert.match(routeSource, /treasuryWallet: PLATFORM_TREASURY_WALLET/);
  assert.match(routeSource, /sub-20-lamport releases produce 0 platform fee/);
});

test('escrow_v3 release instruction binds platform treasury without live Solana writes', () => {
  const { buildEscrowReleaseInstruction } = escrowV3Router.__test;
  const instruction = buildEscrowReleaseInstruction({
    clientWallet: CLIENT_WALLET,
    agentWallet: AGENT_WALLET,
    escrowPDA: ESCROW_PDA,
    programId: PROGRAM_ID,
  });

  assert.equal(instruction.programId.toBase58(), PROGRAM_ID);
  assert.deepEqual(
    instruction.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    [
      { pubkey: ESCROW_PDA, isSigner: false, isWritable: true },
      { pubkey: CLIENT_WALLET, isSigner: true, isWritable: false },
      { pubkey: AGENT_WALLET, isSigner: false, isWritable: true },
      { pubkey: TREASURY_WALLET, isSigner: false, isWritable: true },
    ],
  );
  assert.deepEqual([...instruction.data], [253, 249, 15, 206, 28, 127, 193, 241]);
});

test('escrow_v3 partial_release instruction binds treasury and encodes gross milestone amount', () => {
  const { buildEscrowReleaseInstruction, calculatePlatformFeeSplit } = escrowV3Router.__test;
  const grossAmount = 250000n;
  const feeSplit = calculatePlatformFeeSplit(grossAmount);
  const instruction = buildEscrowReleaseInstruction({
    clientWallet: CLIENT_WALLET,
    agentWallet: AGENT_WALLET,
    escrowPDA: ESCROW_PDA,
    amountLamports: grossAmount,
    programId: new PublicKey(PROGRAM_ID),
  });

  assert.equal(feeSplit.treasuryWallet, TREASURY_WALLET);
  assert.equal(feeSplit.grossAmountLamports, '250000');
  assert.equal(feeSplit.agentAmountLamports, '237500');
  assert.equal(feeSplit.platformFeeLamports, '12500');
  assert.equal(instruction.keys[3].pubkey.toBase58(), TREASURY_WALLET);
  assert.deepEqual([...instruction.data.subarray(0, 8)], [20, 4, 101, 245, 53, 131, 213, 8]);
  assert.equal(instruction.data.readBigUInt64LE(8), grossAmount);
});

test('escrow_v3 fee split preserves full and partial release payout correctness', () => {
  const { calculatePlatformFeeSplit } = escrowV3Router.__test;

  assert.deepEqual(
    calculatePlatformFeeSplit(1_000_000n),
    {
      grossAmountLamports: '1000000',
      agentAmountLamports: '950000',
      platformFeeLamports: '50000',
      platformFeeBps: 500,
      treasuryWallet: TREASURY_WALLET,
      rounding: 'integer floor in lamports; sub-20-lamport releases produce 0 platform fee',
    },
  );
  assert.deepEqual(
    calculatePlatformFeeSplit('250000'),
    {
      grossAmountLamports: '250000',
      agentAmountLamports: '237500',
      platformFeeLamports: '12500',
      platformFeeBps: 500,
      treasuryWallet: TREASURY_WALLET,
      rounding: 'integer floor in lamports; sub-20-lamport releases produce 0 platform fee',
    },
  );
});

test('escrow_v3 author validation executes fee path vectors for reviewer readback', () => {
  const { calculatePlatformFeeSplit } = escrowV3Router.__test;
  const vectors = [
    ['full release', 1_000_000n, '950000', '50000'],
    ['partial milestone release', 250000n, '237500', '12500'],
    ['dust release', 19n, '19', '0'],
  ];

  for (const [label, grossAmountLamports, agentAmountLamports, platformFeeLamports] of vectors) {
    assert.deepEqual(
      calculatePlatformFeeSplit(grossAmountLamports),
      {
        grossAmountLamports: grossAmountLamports.toString(),
        agentAmountLamports,
        platformFeeLamports,
        platformFeeBps: 500,
        treasuryWallet: TREASURY_WALLET,
        rounding: 'integer floor in lamports; sub-20-lamport releases produce 0 platform fee',
      },
      label,
    );
  }
});

test('escrow_v3 fee split floors treasury dust and fails closed on non-positive releases', () => {
  const { calculatePlatformFeeSplit, validatePositiveLamports } = escrowV3Router.__test;

  assert.deepEqual(
    calculatePlatformFeeSplit(19n),
    {
      grossAmountLamports: '19',
      agentAmountLamports: '19',
      platformFeeLamports: '0',
      platformFeeBps: 500,
      treasuryWallet: TREASURY_WALLET,
      rounding: 'integer floor in lamports; sub-20-lamport releases produce 0 platform fee',
    },
  );
  assert.throws(() => calculatePlatformFeeSplit(0n), /amountLamports must be a positive number/);
  assert.throws(() => validatePositiveLamports(0, 'amountLamports'), /must be a positive integer/);
  assert.throws(() => validatePositiveLamports('1.5', 'amountLamports'), /must be a positive integer/);
});

test('escrow_v3 release builders fail closed when treasury/config prerequisites are absent', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const routeSource = fs.readFileSync(ROUTE_PATH, 'utf8');
  const release = sliceFunction(source, 'release', 'partial_release');
  const partialRelease = sliceFunction(source, 'partial_release', 'cancel');

  for (const fnSource of [release, partialRelease]) {
    assert.match(fnSource, /require_keys_eq!\(ctx\.accounts\.treasury\.key\(\), PLATFORM_TREASURY, EscrowError::WrongTreasury\)/);
  }
  assert.match(routeSource, /throw satpProgramIdUnavailable\(`SATP V3 escrow program ID is not configured for \$\{network\}`\);/);
  assert.match(routeSource, /const treasury = new PublicKey\(PLATFORM_TREASURY_WALLET\);/);
  assert.match(routeSource, /\{ pubkey: treasury, isSigner: false, isWritable: true \}/);
});

test('USDC release builder includes treasury token account and SPL token prerequisites', () => {
  const source = fs.readFileSync(USDC_BUILDER_PATH, 'utf8');
  const releaseStart = source.indexOf('async function buildReleaseTx');
  const refundStart = source.indexOf('async function buildRefundTx');
  assert.notEqual(releaseStart, -1, 'buildReleaseTx missing');
  assert.notEqual(refundStart, -1, 'buildRefundTx missing');
  const release = source.slice(releaseStart, refundStart);

  assert.match(release, /assertSolanaIrysWriteEnabled\('Solana escrow release transaction build'\)/);
  assert.match(release, /const treasuryToken = await getAssociatedTokenAddress\(USDC_MINT, TREASURY_WALLET\);/);
  assert.match(release, /\{ pubkey: treasuryToken, isSigner: false, isWritable: true \}/);
  assert.match(release, /\{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false \}/);
});
