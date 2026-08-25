const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
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
