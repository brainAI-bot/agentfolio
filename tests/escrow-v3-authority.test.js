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
  AUTHORITATIVE_SOURCE,
  SATP_ESCROW_IDL_FALLBACK_BLOB_SHA,
  SATP_ESCROW_IDL_FALLBACK_COMMIT,
  SATP_ESCROW_IDL_FALLBACK_PATH,
  SATP_ESCROW_IDL_FALLBACK_SOURCE,
  SATP_ESCROW_IDL_PACKAGE_PATH,
  ADVERTISED_ESCROW_PROGRAM_ID,
  ADVERTISED_NETWORK,
  HOST_ENV_SPLIT_NOTE,
  LEFTOVER_RUNTIME_ESCROW_PROGRAM_ID,
  LEFTOVER_RUNTIME_NETWORK,
  PROVENANCE_RECEIPT_PATH,
  getEscrowV3AuthorityReadback,
  getEscrowV3ProvenanceReadback,
  isValidEscrowV3ProvenanceReceipt,
  loadEscrowV3ProvenanceReceipt,
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
      path: SATP_ESCROW_IDL_PACKAGE_PATH,
      address: AUTHORITY_PROGRAM_ID,
      sha256: 'packaged-idl-sha',
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
  assert.match(readback.expectedProgramIdProvenance, /240dba99dc4e555e9dd221d93f76f2726bd8159e/);
  assert.match(readback.expectedProgramIdProvenance, /satp-client/);
  assert.doesNotMatch(readback.expectedProgramIdProvenance, /AgentFolio onchain is the authority/);
  assert.equal(AUTHORITY_PROGRAM_ID, 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C');
  assert.equal(readback.anchorToml.exists, true);
  assert.equal(readback.programSource.exists, true);
  assert.equal(readback.trackedIdl.exists, true);
  assert.equal(readback.trackedIdl.address, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.trackedIdl.matchesExpectedProgramId, true);
  assert.match(readback.packagedSatpEscrowIdl.path, /idls\/v3\/escrow_v3\.json$/);
  assert.equal(readback.packagedSatpEscrowIdl.exists, true);
  assert.equal(readback.packagedSatpEscrowIdl.address, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.packagedSatpEscrowIdl.matchesExpectedProgramId, true);
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
  assert.equal(readback.advertisedNetwork, ADVERTISED_NETWORK);
  assert.equal(readback.advertisedNetwork, 'mainnet-beta');
  assert.equal(readback.advertisedEscrowProgramId, ADVERTISED_ESCROW_PROGRAM_ID);
  assert.equal(readback.advertisedEscrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.leftoverInventory.leftoverRuntimeNetwork, LEFTOVER_RUNTIME_NETWORK);
  assert.equal(readback.leftoverInventory.leftoverRuntimeProgramId, LEFTOVER_RUNTIME_ESCROW_PROGRAM_ID);
  assert.equal(readback.leftoverInventory.leftoverRuntimeProgramId, 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg');
  assert.match(readback.hostEnvSplit, /host env split/);
  assert.match(readback.hostEnvSplit, /not a missing IDL/);
  assert.equal(readback.hostEnvSplit, HOST_ENV_SPLIT_NOTE);
  assert.match(readback.leftoverInventory.note, /host env split/);
  assert.match(readback.leftoverInventory.note, /not a missing IDL/);
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

test('escrow_v3 provenance readback exposes the PR 270 negative three-way binding and fails closed', () => {
  const provenance = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture(),
    network: 'mainnet',
  });

  assert.equal(provenance.escrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(provenance.advertisedNetwork, 'mainnet-beta');
  assert.equal(provenance.advertisedEscrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(provenance.leftoverRuntimeNetwork, 'devnet');
  assert.equal(provenance.leftoverRuntimeProgramId, AUTHORITY_PROGRAM_ID);
  assert.match(provenance.hostEnvSplit, /host env split/);
  assert.equal(provenance.authoritativeSource, null);
  assert.equal(provenance.consumerInterfaceSource, AUTHORITATIVE_SOURCE);
  assert.equal(provenance.provenanceReceiptPath, PROVENANCE_RECEIPT_PATH);
  assert.equal(provenance.provenanceStatus, 'provenance_gap');
  assert.equal(provenance.receiptBaseline.agentfolioPullRequest, 270);
  assert.equal(provenance.receiptBaseline.receiptObservedAt, '2026-08-24T07:47:44.921Z');
  assert.equal(provenance.artifactCommit, '0bf088e5618f173dff7e0fba622bc2911212c52e');
  assert.equal(provenance.sourceHash, 'f4696cc27c5e2ff6163a90f877fd4431efa8809d2f6ae4c792c3c7cd18193c4d');
  assert.equal(provenance.idlHash, '3d7e7a14788449f65c1a187a96543f7677bf08937e61638734ed3886dcf60a5a');
  assert.equal(provenance.publishedIdlHash, '864e8af057c1b196156222ecda5853936bf4c6e0f3ae9f5c1e2ca2e53ed6c768');
  assert.equal(provenance.rebuiltArtifactHash, '4f21da13659cbe99a606b408a5f1d3523c0e41de20538028939bbb1b54c3cc0d');
  assert.equal(provenance.deployedRuntime.allocatedSha256, '53e922d8792d3ec2d447c497f37dfe8e4ffd1d9bde0f9d6edc0bb3578e67c17f');
  assert.equal(provenance.deployedRuntime.trimmedSha256, '88058f4322bb8cbb9227b6f35ae3c78baf2be9c01a3bd70523f803f9bfa7f078');
  assert.equal(provenance.bindings.sourceEqualsDeployedEqualsPublishedIdl, false);
  assert.equal(provenance.idlProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(provenance.runtimeProgramId, AUTHORITY_PROGRAM_ID);
  assert.deepEqual(provenance.runtimeProgramIds, {
    mainnet: AUTHORITY_PROGRAM_ID,
    devnet: AUTHORITY_PROGRAM_ID,
  });
  assert.equal(provenance.mismatchStatus, 'mismatch');
  assert.deepEqual(provenance.mismatches, [
    'source_build_deployed_runtime_mismatch',
    'source_idl_published_idl_mismatch',
  ]);
  assert.equal(provenance.failClosed, true);
  assert.equal(provenance.liveEscrowWritesAllowed, false);
});

test('escrow_v3 provenance receipt pins all source, build, runtime, and IDL hashes', () => {
  const receipt = loadEscrowV3ProvenanceReceipt();

  assert.equal(receipt.baseline.mergeCommit, 'b4f3b0c020ee06743245db6e756270f3777d85e4');
  assert.match(receipt.buildInputs.cargoLockSha256, /^[0-9a-f]{64}$/);
  assert.match(receipt.buildInputs.rustToolchainTomlSha256, /^[0-9a-f]{64}$/);
  assert.match(receipt.buildInputs.anchorTomlSha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.toolchain.rust, '1.86.0');
  assert.equal(receipt.toolchain.solanaCli, '2.1.21');
  assert.equal(receipt.toolchain.sbfPlatformTools, 'v1.52');
  assert.notEqual(receipt.rebuild.sha256, receipt.deployedRuntime.allocatedSha256);
  assert.notEqual(receipt.rebuild.sha256, receipt.deployedRuntime.trimmedSha256);
  assert.notEqual(receipt.sourceIdl.sha256, receipt.publishedIdl.inflatedSha256);
  assert.equal(receipt.bindings.sourceEqualsDeployedEqualsPublishedIdl, false);
  assert.match(receipt.residualGate, /Owner-gated mainnet program upgrade/);
});

test('escrow_v3 provenance receipt cannot self-assert equality that its pinned hashes disprove', () => {
  const receipt = structuredClone(loadEscrowV3ProvenanceReceipt());
  receipt.bindings.rebuiltArtifactMatchesAllocatedRuntime = true;
  receipt.bindings.sourceIdlMatchesPublishedIdl = true;
  receipt.bindings.sourceEqualsDeployedEqualsPublishedIdl = true;

  assert.equal(isValidEscrowV3ProvenanceReceipt(receipt), false);

  const provenance = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture(),
    provenanceReceipt: receipt,
  });
  assert.ok(provenance.mismatches.includes('invalid_provenance_receipt'));
  assert.equal(provenance.authoritativeSource, null);
  assert.equal(provenance.liveEscrowWritesAllowed, false);
});

test('escrow_v3 provenance receipt status cannot claim verified over a false three-way binding', () => {
  const receipt = structuredClone(loadEscrowV3ProvenanceReceipt());
  assert.equal(receipt.bindings.sourceEqualsDeployedEqualsPublishedIdl, false);
  receipt.status = 'verified';

  assert.equal(isValidEscrowV3ProvenanceReceipt(receipt), false);

  const provenance = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture(),
    provenanceReceipt: receipt,
  });
  assert.equal(provenance.provenanceStatus, 'unverified');
  assert.ok(provenance.mismatches.includes('invalid_provenance_receipt'));
  assert.equal(provenance.authoritativeSource, null);
  assert.equal(provenance.liveEscrowWritesAllowed, false);
});

test('escrow_v3 provenance readback fails closed when its pinned receipt is absent', () => {
  const provenance = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture(),
    provenanceReceipt: null,
  });

  assert.ok(provenance.mismatches.includes('missing_provenance_receipt'));
  assert.equal(provenance.authoritativeSource, null);
  assert.equal(provenance.failClosed, true);
  assert.equal(provenance.liveEscrowWritesAllowed, false);
});

test('escrow_v3 provenance readback fails closed when packaged IDL or runtime disagree', () => {
  const leftoverAfMissing = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture({
      programSource: { exists: false, sha256: null },
      trackedIdl: { exists: false, sha256: null, address: null, matchesExpectedProgramId: false },
      anchorToml: { exists: false },
    }),
  });
  assert.equal(leftoverAfMissing.mismatchStatus, 'mismatch');
  assert.equal(leftoverAfMissing.failClosed, true);
  assert.ok(!leftoverAfMissing.mismatches.includes('missing_source_hash'));
  assert.ok(!leftoverAfMissing.mismatches.includes('missing_idl_hash'));
  assert.ok(!leftoverAfMissing.mismatches.includes('missing_anchor_toml'));
  assert.ok(!leftoverAfMissing.mismatches.includes('tracked_idl_program_id_mismatch'));
  assert.equal(leftoverAfMissing.authoritativeSource, null);
  assert.equal(leftoverAfMissing.consumerInterfaceSource, 'satp-client-package');
  assert.match(leftoverAfMissing.sourceHash, /^[0-9a-f]{64}$/);
  assert.match(leftoverAfMissing.idlHash, /^[0-9a-f]{64}$/);

  const sourceMissing = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture({
      packagedSatpEscrowIdl: { exists: false, sha256: null, address: null, matchesExpectedProgramId: false },
    }),
  });
  assert.equal(sourceMissing.mismatchStatus, 'mismatch');
  assert.equal(sourceMissing.failClosed, true);
  assert.equal(sourceMissing.liveEscrowWritesAllowed, false);
  assert.ok(sourceMissing.mismatches.includes('missing_packaged_idl'));
  assert.ok(sourceMissing.mismatches.includes('source_build_deployed_runtime_mismatch'));

  const idlMismatch = getEscrowV3ProvenanceReadback({
    authorityReadback: authorityReadbackFixture({
      packagedSatpEscrowIdl: {
        address: '11111111111111111111111111111111',
        matchesExpectedProgramId: false,
      },
    }),
  });
  assert.equal(idlMismatch.mismatchStatus, 'mismatch');
  assert.equal(idlMismatch.failClosed, true);
  assert.equal(idlMismatch.liveEscrowWritesAllowed, false);
  assert.ok(idlMismatch.mismatches.includes('packaged_idl_program_id_mismatch'));

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
  assert.ok(runtimeMismatch.mismatches.includes('mainnet_runtime_program_id_mismatch'));
});

test('escrow_v3 provenance readback derives fail-closed state from full authority booleans', () => {
  const cases = [
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

  assert.equal(provenance.mismatchStatus, 'mismatch');
  assert.equal(provenance.failClosed, true);
  assert.equal(provenance.liveEscrowWritesAllowed, false);
});

test('packaged SATP escrow IDL at idls/v3/escrow_v3.json with empty address matches mainnet HXCU', () => {
  const readback = getEscrowV3AuthorityReadback({ satpClient });
  const provenance = getEscrowV3ProvenanceReadback({
    authorityReadback: readback,
    network: 'mainnet',
  });

  assert.equal(SATP_ESCROW_IDL_PACKAGE_PATH, 'node_modules/@brainai/satp-client/idls/v3/escrow_v3.json');
  assert.equal(readback.packagedSatpEscrowIdl.path, SATP_ESCROW_IDL_PACKAGE_PATH);
  assert.match(readback.packagedSatpEscrowIdl.path, /idls\/v3\/escrow_v3\.json$/);
  assert.equal(readback.packagedSatpEscrowIdl.exists, true);
  assert.equal(readback.packagedSatpEscrowIdl.packagedMissing, false);
  assert.equal(readback.packagedSatpEscrowIdl.source, AUTHORITATIVE_SOURCE);
  assert.equal(readback.packagedSatpEscrowIdl.fallback.used, false);
  assert.equal(readback.packagedSatpEscrowIdl.addressField, '');
  assert.equal(readback.packagedSatpEscrowIdl.address, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.packagedSatpEscrowIdl.matchesExpectedProgramId, true);
  assert.match(readback.packagedSatpEscrowIdl.sha256, /^[0-9a-f]{64}$/);
  assert.equal(readback.satpArtifact.runtime.mainnetEscrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.satpArtifact.runtime.devnetEscrowProgramId, 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg');
  assert.equal(readback.satpArtifact.devnetMatchesExpectedProgramId, false);
  assert.equal(provenance.authoritativeSource, null);
  assert.equal(provenance.consumerInterfaceSource, 'satp-client-package');
  assert.notEqual(provenance.sourceHash, readback.packagedSatpEscrowIdl.sha256);
  assert.equal(provenance.idlHash, readback.packagedSatpEscrowIdl.sha256);
  assert.equal(provenance.idlProgramId, AUTHORITY_PROGRAM_ID);
  assert.ok(!provenance.mismatches.includes('missing_packaged_idl'));
  assert.ok(!provenance.mismatches.includes('packaged_idl_program_id_mismatch'));
  assert.equal(readback.releaseGate.liveEscrowWritesAllowed, false);
  assert.equal(provenance.liveEscrowWritesAllowed, false);
  assert.equal(readback.status, 'blocked_pending_authoritative_source_idl');
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

test('repo-checked SATP escrow IDL fallback is used when packaged file is missing', () => {
  const missingPackaged = path.join(
    fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'af-g10-missing-packaged-')),
    'escrow_v3.json',
  );
  const readback = getEscrowV3AuthorityReadback({
    satpClient,
    packagedSatpEscrowIdlPath: missingPackaged,
  });
  const provenance = getEscrowV3ProvenanceReadback({
    authorityReadback: readback,
    network: 'mainnet',
  });

  assert.equal(readback.packagedSatpEscrowIdl.exists, true);
  assert.equal(readback.packagedSatpEscrowIdl.packagedMissing, true);
  assert.equal(readback.packagedSatpEscrowIdl.source, SATP_ESCROW_IDL_FALLBACK_SOURCE);
  assert.equal(readback.packagedSatpEscrowIdl.path, SATP_ESCROW_IDL_FALLBACK_PATH);
  assert.equal(readback.packagedSatpEscrowIdl.fallback.used, true);
  assert.equal(readback.packagedSatpEscrowIdl.fallback.path, SATP_ESCROW_IDL_FALLBACK_PATH);
  assert.equal(readback.packagedSatpEscrowIdl.fallback.satpCommit, SATP_ESCROW_IDL_FALLBACK_COMMIT);
  assert.equal(readback.packagedSatpEscrowIdl.fallback.blobSha, SATP_ESCROW_IDL_FALLBACK_BLOB_SHA);
  assert.match(readback.packagedSatpEscrowIdl.sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    readback.packagedSatpEscrowIdl.sha256,
    require('node:crypto').createHash('sha256')
      .update(fs.readFileSync(path.resolve(__dirname, '..', SATP_ESCROW_IDL_FALLBACK_PATH)))
      .digest('hex'),
  );
  assert.equal(readback.packagedSatpEscrowIdl.addressField, '');
  assert.equal(readback.packagedSatpEscrowIdl.address, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.packagedSatpEscrowIdl.matchesExpectedProgramId, true);
  assert.equal(provenance.authoritativeSource, null);
  assert.equal(provenance.consumerInterfaceSource, 'satp-client-package');
  assert.notEqual(provenance.sourceHash, readback.packagedSatpEscrowIdl.sha256);
  assert.equal(provenance.idlHash, readback.packagedSatpEscrowIdl.sha256);
  assert.equal(provenance.idlProgramId, AUTHORITY_PROGRAM_ID);
  assert.ok(!provenance.mismatches.includes('missing_packaged_idl'));
  assert.ok(!provenance.mismatches.includes('packaged_idl_program_id_mismatch'));
  assert.equal(readback.releaseGate.liveEscrowWritesAllowed, false);
  assert.equal(provenance.liveEscrowWritesAllowed, false);
  assert.equal(readback.status, 'blocked_pending_authoritative_source_idl');
});

test('packaged SATP escrow IDL path still wins when the file exists', () => {
  const packagedPath = path.resolve(__dirname, '..', SATP_ESCROW_IDL_PACKAGE_PATH);
  assert.equal(fs.existsSync(packagedPath), true);

  const readback = getEscrowV3AuthorityReadback({ satpClient });

  assert.equal(readback.packagedSatpEscrowIdl.path, SATP_ESCROW_IDL_PACKAGE_PATH);
  assert.equal(readback.packagedSatpEscrowIdl.exists, true);
  assert.equal(readback.packagedSatpEscrowIdl.packagedMissing, false);
  assert.equal(readback.packagedSatpEscrowIdl.source, 'satp-client-package');
  assert.equal(readback.packagedSatpEscrowIdl.fallback.used, false);
  assert.notEqual(readback.packagedSatpEscrowIdl.path, SATP_ESCROW_IDL_FALLBACK_PATH);
});

test('fallback IDL does not ungate fail-closed live escrow writes', () => {
  const missingPackaged = path.join(
    fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'af-g10-fallback-gate-')),
    'escrow_v3.json',
  );
  const env = {
    ...process.env,
  };
  delete env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  delete env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
  delete env.AGENTFOLIO_ESCROW_KILL_SWITCH;

  const readback = getEscrowV3AuthorityReadback({
    satpClient,
    env,
    packagedSatpEscrowIdlPath: missingPackaged,
  });
  const provenance = getEscrowV3ProvenanceReadback({
    authorityReadback: readback,
    network: 'mainnet',
  });

  assert.equal(readback.packagedSatpEscrowIdl.exists, true);
  assert.equal(readback.packagedSatpEscrowIdl.source, SATP_ESCROW_IDL_FALLBACK_SOURCE);
  assert.equal(readback.releaseGate.liveEscrowWritesAllowed, false);
  assert.equal(readback.releaseGate.ownerAuthorizationRequired, true);
  assert.equal(readback.releaseGate.ownerAuthorizationStatus, 'missing_owner_authorization');
  assert.equal(provenance.liveEscrowWritesAllowed, false);
  assert.equal(provenance.authoritativeSource, null);
  assert.equal(provenance.consumerInterfaceSource, 'satp-client-package');
});

test('escrow health authority advertises mainnet HXCU next to leftover B1Se host env split', () => {
  const env = { ...process.env };
  delete env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  delete env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
  delete env.AGENTFOLIO_ESCROW_KILL_SWITCH;

  const readback = getEscrowV3AuthorityReadback({ satpClient, env });
  const leftoverProvenance = getEscrowV3ProvenanceReadback({
    authorityReadback: readback,
    network: 'devnet',
  });
  const advertisedProvenance = getEscrowV3ProvenanceReadback({
    authorityReadback: readback,
    network: 'mainnet',
  });

  assert.equal(ADVERTISED_NETWORK, 'mainnet-beta');
  assert.equal(ADVERTISED_ESCROW_PROGRAM_ID, 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C');
  assert.equal(LEFTOVER_RUNTIME_NETWORK, 'devnet');
  assert.equal(LEFTOVER_RUNTIME_ESCROW_PROGRAM_ID, 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg');
  assert.equal(readback.advertisedNetwork, 'mainnet-beta');
  assert.equal(readback.advertisedEscrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(readback.leftoverInventory.leftoverRuntimeNetwork, 'devnet');
  assert.equal(readback.leftoverInventory.leftoverRuntimeProgramId, 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg');
  assert.match(readback.hostEnvSplit, /HXCU-vs-B1Se is a host env split/);
  assert.match(readback.hostEnvSplit, /not a missing IDL/);
  assert.equal(readback.packagedSatpEscrowIdl.exists, true);
  assert.equal(typeof readback.packagedSatpEscrowIdl.fallback.used, 'boolean');
  assert.equal(readback.packagedSatpEscrowIdl.fallback.path, SATP_ESCROW_IDL_FALLBACK_PATH);
  assert.ok(['satp-client-package', SATP_ESCROW_IDL_FALLBACK_SOURCE].includes(readback.packagedSatpEscrowIdl.source));
  assert.equal(leftoverProvenance.runtimeProgramId, 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg');
  assert.equal(leftoverProvenance.advertisedNetwork, 'mainnet-beta');
  assert.equal(leftoverProvenance.advertisedEscrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(leftoverProvenance.leftoverRuntimeProgramId, 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg');
  assert.ok(leftoverProvenance.mismatches.includes('devnet_runtime_program_id_mismatch'));
  assert.ok(!leftoverProvenance.mismatches.includes('missing_packaged_idl'));
  assert.equal(advertisedProvenance.advertisedEscrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(advertisedProvenance.runtimeProgramIds.mainnet, AUTHORITY_PROGRAM_ID);
  assert.equal(advertisedProvenance.runtimeProgramIds.devnet, 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg');
  assert.equal(readback.releaseGate.liveEscrowWritesAllowed, false);
  assert.equal(leftoverProvenance.liveEscrowWritesAllowed, false);
  assert.equal(advertisedProvenance.liveEscrowWritesAllowed, false);
  assert.equal(readback.status, 'blocked_pending_authoritative_source_idl');
});

test('IDL fallback stays labeled and does not hide advertised mainnet HXCU', () => {
  const missingPackaged = path.join(
    fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'af-health-001-fallback-')),
    'escrow_v3.json',
  );
  const env = { ...process.env };
  delete env.AGENTFOLIO_ENABLE_LIVE_ESCROW_WRITES;
  delete env.AGENTFOLIO_LIVE_ESCROW_OWNER_AUTHORIZATION;
  delete env.AGENTFOLIO_ESCROW_KILL_SWITCH;

  const readback = getEscrowV3AuthorityReadback({
    satpClient,
    env,
    packagedSatpEscrowIdlPath: missingPackaged,
  });
  const provenance = getEscrowV3ProvenanceReadback({
    authorityReadback: readback,
    network: 'devnet',
  });

  assert.equal(readback.packagedSatpEscrowIdl.source, SATP_ESCROW_IDL_FALLBACK_SOURCE);
  assert.equal(readback.packagedSatpEscrowIdl.fallback.used, true);
  assert.equal(readback.packagedSatpEscrowIdl.packagedMissing, true);
  assert.equal(readback.advertisedNetwork, 'mainnet-beta');
  assert.equal(readback.advertisedEscrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(provenance.advertisedEscrowProgramId, AUTHORITY_PROGRAM_ID);
  assert.equal(provenance.leftoverRuntimeProgramId, 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg');
  assert.match(provenance.hostEnvSplit, /not a missing IDL/);
  assert.equal(readback.releaseGate.liveEscrowWritesAllowed, false);
  assert.equal(provenance.liveEscrowWritesAllowed, false);
});
