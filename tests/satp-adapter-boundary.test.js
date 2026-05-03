const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SATP_REFERENCE_FIELDS,
  DISALLOWED_PROTOCOL_OWNERSHIP,
  pickSatpReferences,
  assertNoProtocolOwnership,
  createSatpBoundary,
} = require('../src/adapters/satp');

test('SATP boundary exposes only AgentFolio-owned SATP reference fields', () => {
  assert.ok(SATP_REFERENCE_FIELDS.includes('satp_identity_pda'));
  assert.ok(SATP_REFERENCE_FIELDS.includes('satp_transaction_signature'));
  assert.ok(SATP_REFERENCE_FIELDS.includes('satp_program_id'));
  assert.ok(!SATP_REFERENCE_FIELDS.includes('pda_seed_rules'));
  assert.ok(!SATP_REFERENCE_FIELDS.includes('score_formula_internals'));
});

test('pickSatpReferences keeps SATP references and ignores product/protocol internals', () => {
  const refs = pickSatpReferences({
    name: 'Example Agent',
    satp_identity_id: 'identity-1',
    satp_identity_pda: 'pda-1',
    satp_transaction_signature: 'sig-1',
    score_formula_internals: 'not-agentfolio-owned',
  });

  assert.deepEqual(refs, {
    satp_identity_id: 'identity-1',
    satp_identity_pda: 'pda-1',
    satp_transaction_signature: 'sig-1',
  });
});

test('assertNoProtocolOwnership rejects protocol-owned fields at the AgentFolio boundary', () => {
  assert.equal(assertNoProtocolOwnership({ satp_identity_id: 'identity-1' }), true);
  assert.throws(
    () => assertNoProtocolOwnership({ pda_seed_rules: ['agent', 'wallet'] }),
    /protocol-owned fields are not allowed/
  );
});

test('createSatpBoundary provides the stable adapter interface', () => {
  const boundary = createSatpBoundary();
  assert.equal(typeof boundary.pickReferences, 'function');
  assert.equal(typeof boundary.assertNoProtocolOwnership, 'function');
  assert.deepEqual(boundary.disallowedProtocolOwnership, DISALLOWED_PROTOCOL_OWNERSHIP);
});
