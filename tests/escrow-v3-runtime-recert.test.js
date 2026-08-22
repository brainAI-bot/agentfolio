const assert = require('node:assert/strict');
const test = require('node:test');

const invariantModule = import('../scripts/lib/allocated-payload-invariant.mjs');

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
