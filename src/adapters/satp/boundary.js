/**
 * AgentFolio SATP Adapter Boundary
 *
 * AgentFolio may store and display SATP references, but must not own
 * protocol account semantics, PDA seed rules, IDL source of truth,
 * trust score formulas, upgrade authority config, or keypairs.
 */

const SATP_REFERENCE_FIELDS = Object.freeze([
  'satp_identity_id',
  'satp_identity_pda',
  'satp_attestation_id',
  'satp_attestation_pda',
  'satp_review_id',
  'satp_reputation_snapshot_id',
  'satp_validation_level',
  'satp_escrow_id',
  'satp_transaction_signature',
  'satp_cluster',
  'satp_program_id',
]);

const DISALLOWED_PROTOCOL_OWNERSHIP = Object.freeze([
  'pda_seed_rules',
  'account_layouts',
  'idl_source_files',
  'score_formula_internals',
  'upgrade_authority_config',
  'program_keypairs',
  'mainnet_authority_keys',
  'protocol_governance_rules',
]);

function pickSatpReferences(source = {}) {
  const refs = {};
  for (const field of SATP_REFERENCE_FIELDS) {
    if (source[field] !== undefined && source[field] !== null && source[field] !== '') {
      refs[field] = source[field];
    }
  }
  return refs;
}

function assertNoProtocolOwnership(source = {}) {
  const present = DISALLOWED_PROTOCOL_OWNERSHIP.filter((field) => source[field] !== undefined);
  if (present.length) {
    throw new Error(
      `AgentFolio SATP boundary violation: protocol-owned fields are not allowed here (${present.join(', ')})`
    );
  }
  return true;
}

function createSatpBoundary(adapter = {}) {
  return {
    referenceFields: SATP_REFERENCE_FIELDS,
    disallowedProtocolOwnership: DISALLOWED_PROTOCOL_OWNERSHIP,
    pickReferences: adapter.pickReferences || pickSatpReferences,
    assertNoProtocolOwnership: adapter.assertNoProtocolOwnership || assertNoProtocolOwnership,
  };
}

module.exports = {
  SATP_REFERENCE_FIELDS,
  DISALLOWED_PROTOCOL_OWNERSHIP,
  pickSatpReferences,
  assertNoProtocolOwnership,
  createSatpBoundary,
};
