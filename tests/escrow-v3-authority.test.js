const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile, execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const satpClient = require('@brainai/satp-client');
const {
  AUTHORITY_PROGRAM_ID,
  AUTHORITY_PROGRAM_ID_PROVENANCE,
  getEscrowV3AuthorityReadback,
  getEscrowV3ProvenanceReadback,
} = require('../src/lib/escrow-v3-authority');

function authorityReadbackFixture(overrides = {}) {
  const base = {
    label: 'escrow_v3',
    expectedProgramId: AUTHORITY_PROGRAM_ID,
    status: 'verified',
    anchorToml: {
      exists: true,
    },
    programSource: {
      exists: true,
      sha256: 'source-sha',
    },
    trackedIdl: {
      exists: true,
      address: AUTHORITY_PROGRAM_ID,
      sha256: 'idl-sha',
      matchesExpectedProgramId: true,
    },
    packagedSatpEscrowIdl: {
      exists: true,
      address: AUTHORITY_PROGRAM_ID,
      matchesExpectedProgramId: true,
    },
    satpArtifact: {
      commit: 'artifact-commit',
      runtime: {
        available: true,
        mainnetEscrowProgramId: AUTHORITY_PROGRAM_ID,
        devnetEscrowProgramId: AUTHORITY_PROGRAM_ID,
      },
      mainnetMatchesExpectedProgramId: true,
      devnetMatchesExpectedProgramId: true,
    },
    releaseGate: {
      liveEscrowWritesAllowed: true,
    },
  };

  return {
    ...base,
    ...overrides,
    anchorToml: { ...base.anchorToml, ...overrides.anchorToml },
    programSource: { ...base.programSource, ...overrides.programSource },
    trackedIdl: { ...base.trackedIdl, ...overrides.trackedIdl },
    packagedSatpEscrowIdl: { ...base.packagedSatpEscrowIdl, ...overrides.packagedSatpEscrowIdl },
    satpArtifact: {
      ...base.satpArtifact,
      ...overrides.satpArtifact,
      runtime: {
        ...base.satpArtifact.runtime,
        ...overrides.satpArtifact?.runtime,
      },
    },
    releaseGate: { ...base.releaseGate, ...overrides.releaseGate },
  };
}

function verifierEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (/^SATP_MAINNET_[A-Z0-9_]+_PROGRAM_ID$/.test(key)) {
      delete env[key];
    }
  }
  return { ...env, ...extra };
}

function execFileAsync(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      resolve({
        status: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

function withMockSolanaRpc(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const body = {
        jsonrpc: '2.0',
        id: payload.id,
        result: payload.method === 'getGenesisHash'
          ? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
          : {
              context: { slot: 123 },
              value: null,
            },
      };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      try {
        const { port } = server.address();
        resolve(await handler(`http://127.0.0.1:${port}`));
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

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

test('escrow_v3 source and IDL strict verifier confirms the pinned program id', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-escrow-v3-source-idl.mjs', '--strict'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  const evidence = JSON.parse(output);
  assert.equal(evidence.label, 'escrow_v3_source_idl');
  assert.equal(evidence.expectedProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(evidence.status, 'verified');
  assert.equal(evidence.checks.anchorProgramIdMatches, true);
  assert.equal(evidence.checks.declareIdMatches, true);
  assert.equal(evidence.checks.idlAddressMatches, true);
  assert.equal(evidence.checks.idlNameMatches, true);
  assert.equal(evidence.checks.createEscrowValidatesIdentityBeforeFunding, true);
  assert.equal(evidence.checks.createEscrowValidatesIdentityBeforeRecordingRequirements, true);
  assert.equal(evidence.checks.identityPdaBoundToAgentIdHash, true);
  assert.equal(evidence.checks.identityOwnedBySatpProgram, true);
  assert.equal(evidence.checks.minVerificationLevelEnforced, true);
  assert.equal(evidence.checks.requireBornEnforced, true);
});

test('escrow_v3 provenance readback exposes hashes, artifact commit, runtime id, and matched status', () => {
  const provenance = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture(),
    network: 'mainnet',
  });

  assert.equal(provenance.escrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(provenance.artifactCommit, 'artifact-commit');
  assert.equal(provenance.sourceHash, 'source-sha');
  assert.equal(provenance.idlHash, 'idl-sha');
  assert.equal(provenance.idlProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(provenance.runtimeProgramId, AUTHORITY_PROGRAM_ID);
  assert.deepEqual(provenance.runtimeProgramIds, {
    mainnet: AUTHORITY_PROGRAM_ID,
    devnet: AUTHORITY_PROGRAM_ID,
  });
  assert.equal(provenance.mismatchStatus, 'matched');
  assert.deepEqual(provenance.mismatches, []);
  assert.equal(provenance.failClosed, false);
  assert.equal(provenance.liveEscrowWritesAllowed, true);
});

test('escrow_v3 provenance readback fails closed when source, IDL, or runtime disagree', () => {
  const sourceMissing = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture({
      programSource: { exists: false, sha256: null },
    }),
  });
  assert.equal(sourceMissing.mismatchStatus, 'mismatch');
  assert.equal(sourceMissing.failClosed, true);
  assert.equal(sourceMissing.liveEscrowWritesAllowed, false);
  assert.deepEqual(sourceMissing.mismatches, ['missing_source_hash']);

  const idlMismatch = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture({
      trackedIdl: {
        address: '11111111111111111111111111111111',
        matchesExpectedProgramId: false,
      },
    }),
  });
  assert.equal(idlMismatch.mismatchStatus, 'mismatch');
  assert.equal(idlMismatch.failClosed, true);
  assert.equal(idlMismatch.liveEscrowWritesAllowed, false);
  assert.deepEqual(idlMismatch.mismatches, ['tracked_idl_program_id_mismatch']);

  const runtimeMismatch = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture({
      satpArtifact: {
        mainnetMatchesExpectedProgramId: false,
        runtime: {
          mainnetEscrowProgramId: '11111111111111111111111111111111',
        },
      },
    }),
    network: 'mainnet',
  });
  assert.equal(runtimeMismatch.mismatchStatus, 'mismatch');
  assert.equal(runtimeMismatch.failClosed, true);
  assert.equal(runtimeMismatch.liveEscrowWritesAllowed, false);
  assert.deepEqual(runtimeMismatch.mismatches, ['mainnet_runtime_program_id_mismatch']);
});

test('escrow_v3 provenance readback derives fail-closed state from full authority booleans', () => {
  const cases = [
    {
      name: 'missing Anchor.toml',
      overrides: {
        status: 'blocked_pending_authoritative_source_idl',
        anchorToml: { exists: false },
      },
      mismatch: 'missing_anchor_toml',
    },
    {
      name: 'missing packaged IDL',
      overrides: {
        status: 'blocked_pending_authoritative_source_idl',
        packagedSatpEscrowIdl: {
          exists: false,
          address: null,
          matchesExpectedProgramId: false,
        },
      },
      mismatch: 'missing_packaged_idl',
    },
    {
      name: 'packaged IDL mismatch',
      overrides: {
        status: 'blocked_pending_authoritative_source_idl',
        packagedSatpEscrowIdl: {
          address: '11111111111111111111111111111111',
          matchesExpectedProgramId: false,
        },
      },
      mismatch: 'packaged_idl_program_id_mismatch',
    },
    {
      name: 'devnet runtime mismatch',
      overrides: {
        status: 'blocked_pending_authoritative_source_idl',
        satpArtifact: {
          devnetMatchesExpectedProgramId: false,
          runtime: {
            devnetEscrowProgramId: '11111111111111111111111111111111',
          },
        },
      },
      mismatch: 'devnet_runtime_program_id_mismatch',
    },
    {
      name: 'runtime unavailable',
      overrides: {
        status: 'blocked_pending_authoritative_source_idl',
        satpArtifact: {
          mainnetMatchesExpectedProgramId: false,
          devnetMatchesExpectedProgramId: false,
          runtime: {
            available: false,
            error: '@brainai/satp-client missing getV3ProgramIds export',
            mainnetEscrowProgramId: null,
            devnetEscrowProgramId: null,
          },
        },
      },
      mismatch: 'runtime_unavailable',
    },
    {
      name: 'status blocked without a named boolean mismatch',
      overrides: {
        status: 'blocked_pending_authoritative_source_idl',
      },
      mismatch: 'authority_status_not_verified',
    },
  ];

  for (const { name, overrides, mismatch } of cases) {
    const provenance = getEscrowV3ProvenanceReadback({
      authorityReadback: authorityReadbackFixture(overrides),
    });

    assert.equal(provenance.mismatchStatus, 'mismatch', name);
    assert.equal(provenance.failClosed, true, name);
    assert.equal(provenance.liveEscrowWritesAllowed, false, name);
    assert.ok(provenance.mismatches.includes(mismatch), name);
  }
});

test('escrow_v3 provenance readback denies live writes when release gate is absent', () => {
  const authorityReadback = authorityReadbackFixture();
  delete authorityReadback.releaseGate;

  const provenance = getEscrowV3ProvenanceReadback({
    authorityReadback,
  });

  assert.equal(provenance.mismatchStatus, 'matched');
  assert.equal(provenance.failClosed, false);
  assert.equal(provenance.liveEscrowWritesAllowed, false);
});

test('SATP mainnet program verifier checks every registry id in explicit fixture mode and can fail closed', () => {
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

  const output = execFileSync(process.execPath, ['scripts/verify-satp-mainnet-programs.mjs', '--allow-fixture'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: verifierEnv({
      CI: '',
      AGENTFOLIO_SATP_PROGRAM_VERIFY_FIXTURE: fixturePath,
    }),
    encoding: 'utf8',
  });
  const evidence = JSON.parse(output);
  assert.equal(evidence.label, 'satp_mainnet_program_registry_onchain');
  assert.equal(evidence.status, 'verified');
  assert.equal(evidence.mode.strict, false);
  assert.equal(evidence.mode.allowFixture, true);
  assert.equal(evidence.rpcGenesisHash, null);
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

  const red = spawnSync(process.execPath, ['scripts/verify-satp-mainnet-programs.mjs', '--allow-fixture'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: verifierEnv({
      CI: '',
      AGENTFOLIO_SATP_PROGRAM_VERIFY_FIXTURE: fixturePath,
    }),
    encoding: 'utf8',
  });
  assert.equal(red.status, 1);
  assert.match(red.stdout, /blocked_onchain_program_mismatch/);
});

test('SATP mainnet strict verifier rejects fixture evidence before checking accounts', () => {
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

  const strict = spawnSync(process.execPath, ['scripts/verify-satp-mainnet-programs.mjs', '--strict'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: verifierEnv({
      AGENTFOLIO_SATP_PROGRAM_VERIFY_FIXTURE: fixturePath,
    }),
    encoding: 'utf8',
  });
  const evidence = JSON.parse(strict.stdout);

  assert.equal(strict.status, 1);
  assert.equal(evidence.status, 'blocked_fixture_in_strict_mode');
  assert.equal(evidence.fixtureEnvKey, 'AGENTFOLIO_SATP_PROGRAM_VERIFY_FIXTURE');
  assert.equal(evidence.mode.strict, true);
  assert.equal(evidence.mode.allowFixture, false);
  assert.equal(evidence.programs.length, 6);
});

test('SATP mainnet strict verifier rejects env overrides before checking accounts', () => {
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
  const override = '11111111111111111111111111111111';
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));

  const strict = spawnSync(process.execPath, ['scripts/verify-satp-mainnet-programs.mjs', '--strict'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: verifierEnv({
      AGENTFOLIO_SATP_PROGRAM_VERIFY_FIXTURE: fixturePath,
      SATP_MAINNET_IDENTITY_PROGRAM_ID: override,
    }),
    encoding: 'utf8',
  });
  const evidence = JSON.parse(strict.stdout);
  const identity = evidence.programs.find((program) => program.name === 'IDENTITY');

  assert.equal(strict.status, 1);
  assert.equal(evidence.status, 'blocked_env_override_in_strict_mode');
  assert.deepEqual(evidence.overrideEnvKeys, ['SATP_MAINNET_IDENTITY_PROGRAM_ID']);
  assert.equal(evidence.mode.allowFixture, false);
  assert.notEqual(identity.id, override);
  assert.equal(identity.provenance, 'frontend/src/lib/satp-mainnet-programs.ts');
});

test('SATP mainnet verifier fails closed on on-chain mismatch in CI mode without strict flag', async () => {
  await withMockSolanaRpc(async (rpcUrl) => {
    const ci = await execFileAsync(process.execPath, ['scripts/verify-satp-mainnet-programs.mjs'], {
      cwd: require('node:path').resolve(__dirname, '..'),
      env: verifierEnv({
        CI: 'true',
        SOLANA_RPC_URL: rpcUrl,
      }),
      encoding: 'utf8',
      timeout: 5000,
    });
    const evidence = JSON.parse(ci.stdout);

    assert.equal(ci.status, 1);
    assert.equal(evidence.status, 'blocked_onchain_program_mismatch');
    assert.equal(evidence.mode.strict, false);
    assert.equal(evidence.mode.ci, true);
    assert.equal(evidence.rpcGenesisHash, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
    assert.equal(evidence.programs.length, 6);
    assert.ok(evidence.programs.every((program) => program.exists === false));
  });
});

test('SATP mainnet verifier pins evidence to Solana mainnet genesis in strict mode', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts/verify-satp-mainnet-programs.mjs'),
    'utf8',
  );

  assert.match(source, /expectedGenesisHash = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'/);
  assert.match(source, /getGenesisHash\(\)/);
  assert.match(source, /blocked_rpc_network_mismatch/);
  assert.doesNotMatch(source, /rpcUrl,\s*$/m);
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
