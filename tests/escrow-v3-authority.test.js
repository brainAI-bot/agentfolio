const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const satpClient = require('@brainai/satp-client');
const {
  AUTHORITY_PROGRAM_ID,
  AUTHORITY_PROGRAM_ID_PROVENANCE,
  getEscrowV3AuthorityReadback,
} = require('../src/lib/escrow-v3-authority');

test('escrow_v3 authority readback names the HQ-selected program id from SATP mainnet runtime', () => {
  const readback = getEscrowV3AuthorityReadback({ satpClient });

  assert.equal(readback.label, 'escrow_v3');
  assert.equal(readback.expectedProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.expectedProgramIdProvenance, AUTHORITY_PROGRAM_ID_PROVENANCE);
  assert.match(readback.expectedProgramIdProvenance, /2752dcc99b7ece9f5452c7273123232a92d7067f/);
  assert.equal(AUTHORITY_PROGRAM_ID, 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C');
  assert.equal(readback.anchorToml.exists, true);
  assert.equal(readback.programSource.exists, true);
  assert.equal(readback.trackedIdl.exists, true);
  assert.equal(readback.trackedIdl.address, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.trackedIdl.matchesExpectedProgramId, true);
  assert.equal(readback.status, 'blocked_pending_authoritative_source_idl');
  assert.equal(readback.releaseGate.liveEscrowWritesAllowed, false);
  assert.equal(readback.releaseGate.ownerAuthorizationRequired, true);
  assert.equal(readback.releaseGate.ownerAuthorizationStatus, 'missing_owner_authorization');
  assert.equal(readback.releaseGate.ownerAuthorizationEnv, 'AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION');
  assert.match(readback.releaseGate.readOnlyPosture, /PDA derivation routes remain read-only HTTP 200/);
  assert.equal(readback.satpArtifact.runtime.available, true);
  assert.equal(readback.satpArtifact.runtime.mainnetEscrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.satpArtifact.runtime.devnetEscrowProgramId, 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg');
  assert.equal(readback.satpArtifact.mainnetMatchesExpectedProgramId, true);
  assert.equal(readback.satpArtifact.devnetMatchesExpectedProgramId, false);
});

test('SATP mainnet program verifier checks every registry id and can fail closed', () => {
  const owner = 'BPFLoaderUpgradeab1e11111111111111111111111';
  const fixture = {
    IDENTITY: { slot: 100, owner, exists: true, executable: true, status: 'verified' },
    REVIEWS: { slot: 101, owner, exists: true, executable: true, status: 'verified' },
    REPUTATION: { slot: 102, owner, exists: true, executable: true, status: 'verified' },
    ATTESTATIONS: { slot: 103, owner, exists: true, executable: true, status: 'verified' },
    VALIDATION: { slot: 104, owner, exists: true, executable: true, status: 'verified' },
    ESCROW: { slot: 105, owner, exists: true, executable: true, status: 'verified' },
  };
  const fixturePath = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'af-satp-programs-')), 'accounts.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));

  const output = execFileSync(process.execPath, ['scripts/verify-escrow-v3-source-idl.mjs', '--strict'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: {
      ...process.env,
      AGENTFOLIO_SATP_PROGRAM_VERIFY_FIXTURE: fixturePath,
    },
    encoding: 'utf8',
  });
  const evidence = JSON.parse(output);
  assert.equal(evidence.label, 'satp_mainnet_program_registry_onchain');
  assert.equal(evidence.status, 'verified');
  assert.equal(evidence.programs.length, 6);
  for (const program of evidence.programs) {
    assert.equal(program.owner, owner);
    assert.equal(program.exists, true);
    assert.equal(program.executable, true);
    assert.match(program.id, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  }

  fixture.IDENTITY = {
    slot: 106,
    owner: null,
    exists: false,
    executable: false,
    status: 'blocked_onchain_program_mismatch',
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));

  const red = spawnSync(process.execPath, ['scripts/verify-escrow-v3-source-idl.mjs', '--strict'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: {
      ...process.env,
      AGENTFOLIO_SATP_PROGRAM_VERIFY_FIXTURE: fixturePath,
    },
    encoding: 'utf8',
  });
  assert.equal(red.status, 1);
  assert.match(red.stdout, /blocked_onchain_program_mismatch/);
});

test('escrow_v3 source binds dispute recipients and enforces SATP identity requirements', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'onchain/escrow_v3/programs/escrow_v3/src/lib.rs'),
    'utf8',
  );
  const resolveDispute = source.slice(
    source.indexOf('pub fn resolve_dispute'),
    source.indexOf('pub fn extend_deadline'),
  );
  const agentBinding = /require_keys_eq!\(\s*escrow\.agent,\s*ctx\.accounts\.agent\.key\(\),\s*EscrowError::WrongAgent\s*\)/;
  const clientBinding = /require_keys_eq!\(\s*escrow\.client,\s*ctx\.accounts\.client\.key\(\),\s*EscrowError::Unauthorized\s*\)/;
  const agentBindingMatch = resolveDispute.match(agentBinding);
  const clientBindingMatch = resolveDispute.match(clientBinding);
  const firstTransfer = resolveDispute.indexOf('transfer_from_escrow(');
  const createEscrow = source.slice(
    source.indexOf('pub fn create_escrow'),
    source.indexOf('pub fn submit_work'),
  );
  const identityValidationIndex = createEscrow.indexOf('validate_agent_identity(');
  const fundingTransferIndex = createEscrow.indexOf('system_instruction::transfer');
  const minRequirementRecordIndex = createEscrow.indexOf('escrow.min_verification_level = min_verification_level');
  const requireBornRecordIndex = createEscrow.indexOf('escrow.require_born = require_born');

  assert.match(source, /validate_agent_identity\(/);
  assert.match(source, /SATP_V3_IDENTITY_PROGRAM_ID/);
  assert.match(source, /Pubkey::find_program_address\(\s*&\[b"genesis", agent_id_hash\]/);
  assert.notEqual(identityValidationIndex, -1);
  assert.notEqual(fundingTransferIndex, -1);
  assert.notEqual(minRequirementRecordIndex, -1);
  assert.notEqual(requireBornRecordIndex, -1);
  assert.ok(identityValidationIndex < fundingTransferIndex);
  assert.ok(identityValidationIndex < minRequirementRecordIndex);
  assert.ok(identityValidationIndex < requireBornRecordIndex);
  assert.ok(agentBindingMatch);
  assert.ok(clientBindingMatch);
  assert.notEqual(firstTransfer, -1);
  assert.ok(agentBindingMatch.index < firstTransfer);
  assert.ok(clientBindingMatch.index < firstTransfer);
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
