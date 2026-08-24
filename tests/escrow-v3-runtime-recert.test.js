const assert = require('node:assert/strict');
const test = require('node:test');

const invariantModule = import('../scripts/lib/allocated-payload-invariant.mjs');
const forensicsModule = import('../scripts/lib/escrow-v3-provenance-forensics.mjs');

const CANONICAL_PAYLOAD = Buffer.from('canonical allocated program payload');
const EXPECTED = Object.freeze({
  length: 35,
  sha256: '7b4af508c2601dc8e7262d42c2ce7f9323e742fd821474f23728bd42fceb93c7',
});

test('accepts the canonical allocated payload', async () => {
  const { allocatedPayloadInvariant } = await invariantModule;

  assert.deepEqual(allocatedPayloadInvariant(CANONICAL_PAYLOAD, EXPECTED), {
    allocatedBinaryLengthMatches: true,
    allocatedBinarySha256Matches: true,
  });
});

test('fails closed when account padding drifts', async () => {
  const { allocatedPayloadInvariant } = await invariantModule;
  const payloadWithPaddingDrift = Buffer.concat([CANONICAL_PAYLOAD, Buffer.from([0])]);

  assert.deepEqual(allocatedPayloadInvariant(payloadWithPaddingDrift, EXPECTED), {
    allocatedBinaryLengthMatches: false,
    allocatedBinarySha256Matches: false,
  });
});

function syntheticElf(textByte = 0xaa) {
  const bytes = Buffer.alloc(0x180);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(bytes);
  bytes.writeBigUInt64LE(0xc0n, 40);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(3, 60);
  bytes.writeUInt16LE(2, 62);

  const textHeader = 0xc0 + 64;
  bytes.writeUInt32LE(1, textHeader);
  bytes.writeUInt32LE(1, textHeader + 4);
  bytes.writeBigUInt64LE(6n, textHeader + 8);
  bytes.writeBigUInt64LE(0x120n, textHeader + 16);
  bytes.writeBigUInt64LE(0x80n, textHeader + 24);
  bytes.writeBigUInt64LE(4n, textHeader + 32);
  bytes.fill(textByte, 0x80, 0x84);

  const namesHeader = 0xc0 + 128;
  bytes.writeUInt32LE(7, namesHeader);
  bytes.writeUInt32LE(3, namesHeader + 4);
  bytes.writeBigUInt64LE(0x90n, namesHeader + 24);
  bytes.writeBigUInt64LE(17n, namesHeader + 32);
  Buffer.from('\0.text\0.shstrtab\0').copy(bytes, 0x90);
  return bytes;
}

test('records byte drift without confusing identical ELF layout for equality', async () => {
  const { elfForensics } = await forensicsModule;
  const candidate = syntheticElf(0xaa);
  const deployed = syntheticElf(0xbb);

  const result = elfForensics(candidate, deployed);
  assert.equal(result.byteDifferenceCount, 4);
  assert.equal(result.sectionLayoutMatches, true);
  assert.deepEqual(result.candidateSections, result.deployedSections);
});

test('fails closed on invalid ELF section metadata', async () => {
  const { elf64SectionLayout } = await forensicsModule;
  const malformed = syntheticElf();
  malformed.writeBigUInt64LE(0xffffn, 40);

  assert.throws(() => elf64SectionLayout(malformed), /outside the ELF/);
});

test('finds compiled Anchor instruction labels in deployed bytes', async () => {
  const { instructionLabelPresence } = await forensicsModule;
  const idl = {
    instructions: [
      { name: 'create_escrow' },
      { name: 'release_usdc' },
    ],
  };

  const deployed = Buffer.from('prefixCreateEscrowInstruction:suffix');
  assert.deepEqual(instructionLabelPresence(idl, deployed), [
    { name: 'create_escrow', compiledLabel: 'CreateEscrowInstruction:', present: true },
    { name: 'release_usdc', compiledLabel: 'ReleaseUsdcInstruction:', present: false },
  ]);
});
