const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');

const satpClient = require('@brainai/satp-client');
const {
  AUTHORITY_PROGRAM_ID,
  getEscrowV3AuthorityReadback,
} = require('../src/lib/escrow-v3-authority');

test('escrow_v3 authority readback names the HQ-selected program id and fails closed on mismatch', () => {
  const readback = getEscrowV3AuthorityReadback({ satpClient });

  assert.equal(readback.label, 'escrow_v3');
  assert.equal(readback.expectedProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(AUTHORITY_PROGRAM_ID, '4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a');
  assert.equal(readback.anchorToml.exists, true);
  assert.equal(readback.programSource.exists, true);
  assert.equal(readback.trackedIdl.exists, true);
  assert.equal(readback.trackedIdl.address, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.trackedIdl.matchesExpectedProgramId, true);
  assert.equal(readback.status, 'blocked_pending_authoritative_source_idl');
  assert.equal(readback.releaseGate.liveEscrowWritesAllowed, false);
  assert.equal(readback.satpArtifact.runtime.available, true);
  assert.equal(readback.satpArtifact.mainnetMatchesExpectedProgramId, false);
  assert.equal(readback.satpArtifact.devnetMatchesExpectedProgramId, false);
});

test('escrow_v3 source and IDL strict verifier confirms the pinned program id', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-escrow-v3-source-idl.mjs', '--strict'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  const evidence = JSON.parse(output);
  assert.equal(evidence.expectedProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(evidence.status, 'verified');
  assert.equal(evidence.checks.anchorProgramIdMatches, true);
  assert.equal(evidence.checks.declareIdMatches, true);
  assert.equal(evidence.checks.idlAddressMatches, true);
});

test('escrow_v3 authority verifier prints JSON evidence and reserves strict failure for release gate', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-escrow-v3-authority.js'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  const evidence = JSON.parse(output);
  assert.equal(evidence.expectedProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(evidence.status, 'blocked_pending_authoritative_source_idl');

  const strict = spawnSync(process.execPath, ['scripts/verify-escrow-v3-authority.js', '--strict'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /blocked_pending_authoritative_source_idl/);
});
