const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  const leadingZeroes = Buffer.from(bytes).findIndex((byte) => byte !== 0);
  const count = leadingZeroes === -1 ? bytes.length : leadingZeroes;
  return '1'.repeat(count) + (encoded || '1');
}

function instructionData(name, amount = null) {
  const prefix = crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
  if (amount === null) return encodeBase58(prefix);
  const data = Buffer.alloc(16);
  prefix.copy(data);
  data.writeBigUInt64LE(BigInt(amount), 8);
  return encodeBase58(data);
}

function transactionFixture({ route = 'release', gross, agentDelta, treasuryDelta }) {
  const keys = [
    'ClientFeePayer111111111111111111111111111111',
    'Escrow11111111111111111111111111111111111',
    'Agent111111111111111111111111111111111111',
    'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be',
    'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C',
  ];
  const preBalances = [10_000, 1_000, 100, 200];
  const postBalances = [10_000, 1_000 - Number(gross), 100 + Number(agentDelta),
    200 + Number(treasuryDelta)];
  return {
    signatureRecord: { signature: 'SyntheticReleaseSignature', slot: 441_423_818 },
    transaction: {
      transaction: { message: { accountKeys: keys, instructions: [] } },
      meta: { err: null, preBalances, postBalances, innerInstructions: [] },
    },
    instruction: {
      programIdIndex: 4,
      accounts: [1, 0, 2, 3],
      data: instructionData(route, route === 'partial_release' ? gross : null),
    },
  };
}

test('live fee proof detects the certified runtime interface has no treasury account', async () => {
  const { feeRouteInterface } = await import('../scripts/verify-escrow-v3-live-fee-proof.mjs');
  const certifiedIdl = readJson('third_party/satp/93fc6c0d/idls/v3/escrow_v3.json');
  const result = feeRouteInterface(certifiedIdl);

  assert.equal(result.feeRoutingSupported, false);
  assert.deepEqual(result.routes.release.accounts, ['escrow', 'client', 'agent']);
  assert.deepEqual(result.routes.partial_release.accounts, ['escrow', 'client', 'agent']);
  assert.equal(result.routes.release.treasuryAccountPresent, false);
  assert.equal(result.routes.partial_release.treasuryAccountPresent, false);
});

test('live fee proof recognizes the undeployed AgentFolio fee-routing interface', async () => {
  const { feeRouteInterface } = await import('../scripts/verify-escrow-v3-live-fee-proof.mjs');
  const trackedIdl = readJson('onchain/escrow_v3/target/idl/escrow_v3.json');
  const result = feeRouteInterface(trackedIdl);

  assert.equal(result.feeRoutingSupported, true);
  assert.deepEqual(result.routes.release.accounts, ['escrow', 'client', 'agent', 'treasury']);
  assert.deepEqual(
    result.routes.partial_release.accounts,
    ['escrow', 'client', 'agent', 'treasury'],
  );
});

test('release proof requires a positive treasury delta above the rounding threshold', async () => {
  const { analyzeInstruction } = await import('../scripts/verify-escrow-v3-live-fee-proof.mjs');
  const fixture = transactionFixture({ gross: 19, agentDelta: 19, treasuryDelta: 0 });
  const result = analyzeInstruction(
    fixture.signatureRecord,
    fixture.transaction,
    fixture.instruction,
    19n,
  );

  assert.equal(result.grossSource, 'owner_approved_signature_binding');
  assert.equal(result.checks.grossMeetsNonZeroFeeMinimum, false);
  assert.equal(result.checks.treasuryDeltaPositive, false);
  assert.equal(result.proofPassed, false);
});

test('release proof binds gross to the Owner-approved amount and rejects a short payout', async () => {
  const { analyzeInstruction } = await import('../scripts/verify-escrow-v3-live-fee-proof.mjs');
  const fixture = transactionFixture({ gross: 40, agentDelta: 38, treasuryDelta: 2 });
  const unbound = analyzeInstruction(
    fixture.signatureRecord,
    fixture.transaction,
    fixture.instruction,
  );
  const shortPayout = analyzeInstruction(
    fixture.signatureRecord,
    fixture.transaction,
    fixture.instruction,
    100n,
  );

  assert.equal(unbound.grossSource, 'missing_owner_approved_binding');
  assert.equal(unbound.checks.grossBoundToIndependentSource, false);
  assert.equal(unbound.proofPassed, false);
  assert.equal(shortPayout.grossAmountLamports, '100');
  assert.equal(shortPayout.checks.escrowRawDeltaMatchesGross, false);
  assert.equal(shortPayout.checks.treasuryDeltaMatchesFee, false);
  assert.equal(shortPayout.checks.agentDeltaMatchesNet, false);
  assert.equal(shortPayout.proofPassed, false);
});

test('release proof accepts an exact non-zero split bound to the approved gross', async () => {
  const { analyzeInstruction } = await import('../scripts/verify-escrow-v3-live-fee-proof.mjs');
  const fixture = transactionFixture({ gross: 100, agentDelta: 95, treasuryDelta: 5 });
  const result = analyzeInstruction(
    fixture.signatureRecord,
    fixture.transaction,
    fixture.instruction,
    100n,
  );

  assert.equal(result.proofPassed, true);
  assert.equal(result.expectedAgentDeltaLamports, '95');
  assert.equal(result.expectedTreasuryDeltaLamports, '5');
});

test('release proof rejects escrow closure instead of treating rent as settlement', async () => {
  const { analyzeInstruction } = await import('../scripts/verify-escrow-v3-live-fee-proof.mjs');
  const fixture = transactionFixture({ gross: 100, agentDelta: 95, treasuryDelta: 5 });
  fixture.transaction.meta.postBalances[1] = 0;
  const result = analyzeInstruction(
    fixture.signatureRecord,
    fixture.transaction,
    fixture.instruction,
    100n,
  );

  assert.equal(result.checks.escrowRemainedOpenWithoutRentClosure, false);
  assert.equal(result.checks.escrowRawDeltaMatchesGross, false);
  assert.equal(result.proofPassed, false);
});
