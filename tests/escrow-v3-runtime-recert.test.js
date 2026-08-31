const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const receipt = require('../config/escrow-v3-provenance-ef7e4581.json');

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

test('current receipt binds the reproducible artifact to the allocated prefix and zero padding', () => {
  assert.equal(receipt.schemaVersion, 2);
  assert.equal(receipt.deployedRuntime.allocatedSha256, '7672bd30bf01134bc56e088013a5cafd65ff850c402a56e532be3e28a3d5b4c9');
  assert.equal(receipt.deployedRuntime.trimmedSha256, '85e71adf087b268b199c933918a1b8bb2b0a5f67f9e71b1467b3ca8357b8458a');
  assert.equal(receipt.rebuild.sha256, receipt.deployedRuntime.sourceArtifactPrefixSha256);
  assert.equal(receipt.rebuild.bytes, receipt.deployedRuntime.sourceArtifactPrefixBytes);
  assert.equal(
    receipt.deployedRuntime.allocatedBytes,
    receipt.deployedRuntime.sourceArtifactPrefixBytes + receipt.deployedRuntime.allocationPaddingBytes,
  );
  assert.equal(
    receipt.deployedRuntime.allocationPaddingSha256,
    crypto.createHash('sha256')
      .update(Buffer.alloc(receipt.deployedRuntime.allocationPaddingBytes))
      .digest('hex'),
  );
  assert.equal(receipt.bindings.sourceBuildMatchesDeployedRuntime, true);
});

test('current receipt records both published IDL surfaces as stale and keeps three-way binding false', () => {
  assert.equal(receipt.sourceIdl.sha256, '9bb7e2a441af653108b21360a8aa14daa9bd8d54eebbc5eef88e7f3de881ba10');
  assert.equal(receipt.publishedIdl.programMetadata.instructionCount, 14);
  assert.deepEqual(receipt.publishedIdl.programMetadata.missingRequiredFeeRoutingAccounts, {
    release: ['treasury'],
    partial_release: ['treasury'],
  });
  assert.equal(receipt.publishedIdl.programMetadata.matchesCanonicalSource, false);
  assert.equal(receipt.publishedIdl.legacyAnchor.instructionCount, 9);
  assert.equal(receipt.publishedIdl.legacyAnchor.matchesCanonicalSource, false);
  assert.equal(receipt.bindings.sourceIdlMatchesPublishedIdl, false);
  assert.equal(receipt.bindings.sourceEqualsDeployedEqualsPublishedIdl, false);
  assert.equal(receipt.status, 'source_build_verified_published_idl_mismatch');
});
