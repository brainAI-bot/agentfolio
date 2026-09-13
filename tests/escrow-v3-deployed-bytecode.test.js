const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const verifierModule = import('../scripts/verify-escrow-v3-deployed-bytecode.mjs');
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';

async function fixture() {
  const { encodeBase58 } = await verifierModule;
  const programDataKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
  const authorityKey = Buffer.from(Array.from({ length: 32 }, (_, index) => 64 - index));
  const bytecode = Buffer.from('deployed escrow bytecode fixture');
  const program = {
    owner: LOADER,
    executable: true,
    data: Buffer.concat([Buffer.alloc(4), programDataKey]),
  };
  const programDataHeader = Buffer.alloc(45);
  programDataHeader.writeBigUInt64LE(42n, 4);
  programDataHeader[12] = 1;
  authorityKey.copy(programDataHeader, 13);
  const programData = {
    owner: LOADER,
    executable: false,
    data: Buffer.concat([programDataHeader, bytecode]),
  };
  const expected = {
    programData: encodeBase58(programDataKey),
    upgradeSlot: 42,
    upgradeAuthority: encodeBase58(authorityKey),
    allocatedBytes: bytecode.length,
    allocatedSha256: crypto.createHash('sha256').update(bytecode).digest('hex'),
  };
  return { program, programData, expected };
}

test('accepts the exact deployed ProgramData bytecode hash', async () => {
  const { verifyDeployment } = await verifierModule;
  const input = await fixture();
  const result = verifyDeployment(input);

  assert.equal(result.verified, true);
  assert.equal(result.checks.deployedBytecodeLengthMatches, true);
  assert.equal(result.checks.deployedBytecodeSha256Matches, true);
  assert.equal(result.observed.deployedBytecodeSha256, input.expected.allocatedSha256);
});

test('fails closed when deployed ProgramData bytecode drifts', async () => {
  const { verifyDeployment } = await verifierModule;
  const input = await fixture();
  input.programData.data[input.programData.data.length - 1] ^= 0xff;
  const result = verifyDeployment(input);

  assert.equal(result.verified, false);
  assert.equal(result.checks.deployedBytecodeLengthMatches, true);
  assert.equal(result.checks.deployedBytecodeSha256Matches, false);
});
