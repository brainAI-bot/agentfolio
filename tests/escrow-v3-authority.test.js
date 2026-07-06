const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const satpClient = require('@brainai/satp-client');
const {
  AUTHORITY_PROGRAM_ID,
  getEscrowV3AuthorityReadback,
} = require('../src/lib/escrow-v3-authority');

test('escrow_v3 authority readback names the HQ-selected program id and fails closed on mismatch', () => {
  const readback = getEscrowV3AuthorityReadback({ satpClient });

  assert.equal(readback.label, 'escrow_v3');
  assert.equal(readback.expectedProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(AUTHORITY_PROGRAM_ID, 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C');
  assert.equal(readback.anchorToml.exists, true);
  assert.equal(readback.programSource.exists, true);
  assert.equal(readback.trackedIdl.exists, true);
  assert.equal(readback.trackedIdl.address, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.trackedIdl.matchesExpectedProgramId, true);
  assert.equal(readback.status, 'blocked_pending_authoritative_source_idl');
  assert.equal(readback.releaseGate.liveEscrowWritesAllowed, false);
  assert.equal(readback.satpArtifact.runtime.available, true);
  assert.equal(readback.satpArtifact.mainnetMatchesExpectedProgramId, true);
  assert.equal(readback.satpArtifact.devnetMatchesExpectedProgramId, true);
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

test('escrow_v3 source binds dispute recipients and enforces SATP identity requirements', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'onchain/escrow_v3/programs/escrow_v3/src/lib.rs'),
    'utf8',
  );

  assert.match(source, /validate_agent_identity\(/);
  assert.match(source, /SATP_V3_IDENTITY_PROGRAM_ID/);
  assert.match(source, /Pubkey::find_program_address\(\s*&\[b"genesis", agent_id_hash\]/);
  assert.match(source, /require_keys_eq!\(ctx\.accounts\.escrow\.agent, ctx\.accounts\.agent\.key\(\), EscrowError::WrongAgent\)/);
  assert.match(source, /require_keys_eq!\(ctx\.accounts\.escrow\.client, ctx\.accounts\.client\.key\(\), EscrowError::Unauthorized\)/);
  assert.match(source, /EscrowError::AgentVerificationTooLow/);
  assert.match(source, /EscrowError::AgentNotBorn/);
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
