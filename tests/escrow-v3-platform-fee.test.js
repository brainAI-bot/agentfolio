const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_PATH = path.resolve(__dirname, '..', 'onchain/escrow_v3/programs/escrow_v3/src/lib.rs');
const IDL_PATH = path.resolve(__dirname, '..', 'onchain/escrow_v3/target/idl/escrow_v3.json');
const ROUTE_PATH = path.resolve(__dirname, '..', 'src/routes/escrow-v3-routes.js');
const TREASURY_WALLET = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';

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
