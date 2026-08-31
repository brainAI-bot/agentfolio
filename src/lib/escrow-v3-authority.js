'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  ADVERTISED_ESCROW_PROGRAM_ID,
  ADVERTISED_NETWORK,
  HOST_ENV_SPLIT_NOTE,
  LEFTOVER_RUNTIME_ESCROW_PROGRAM_ID,
  LEFTOVER_RUNTIME_NETWORK,
  liveEscrowGateStatus,
} = require('./write-surface-gate');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUTHORITY_PROGRAM_ID = 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C';
const AUTHORITY_PROGRAM_ID_PROVENANCE = 'HQ task AGENTFOLIO-SATP-ESCROW-V3-AUTHORITATIVE-RUNTIME-REFRESH-20260824: finalized SATP mainnet runtime from git-pinned @brainai/satp-client commit 93fc6c0d86302cfe8b0d8c798ba2817d7eeace44 (packaged idls/v3/escrow_v3.json + getV3ProgramIds(\'mainnet\').ESCROW); AgentFolio onchain/escrow_v3 and the B1Se devnet runtime are leftover inventory, not the mainnet IDL or program source of truth';
const AUTHORITY_INSTRUCTION_COUNT = 14;
const AUTHORITY_IDL_SHA256 = 'e8c142f27e225d8edc2f8f41e6fb698ebbb73f69d2fc078d5bf963234ebc8fa9';
const AUTHORITY_LABEL = 'escrow_v3';
const AUTHORITY_SOURCE_WORKSPACE = 'onchain/escrow_v3';
const AUTHORITY_ANCHOR_TOML = 'onchain/escrow_v3/Anchor.toml';
const AUTHORITY_IDL_PATH = 'onchain/escrow_v3/target/idl/escrow_v3.json';
const AUTHORITY_PROGRAM_SOURCE = 'onchain/escrow_v3/programs/escrow_v3/src/lib.rs';
const PROVENANCE_RECEIPT_PATH = 'config/escrow-v3-provenance-ef7e4581.json';
const PROVENANCE_SOURCE_COMMIT = '3f8188bec89db0d4a081931f35272e10185d1c0d';
const CURRENT_ALLOCATED_RUNTIME_SHA256 = '7672bd30bf01134bc56e088013a5cafd65ff850c402a56e532be3e28a3d5b4c9';
const CURRENT_TRIMMED_RUNTIME_SHA256 = '85e71adf087b268b199c933918a1b8bb2b0a5f67f9e71b1467b3ca8357b8458a';
const SATP_ESCROW_IDL_PACKAGE_RELATIVE = 'idls/v3/escrow_v3.json';
const SATP_ESCROW_IDL_PACKAGE_PATH = 'node_modules/@brainai/satp-client/idls/v3/escrow_v3.json';
const AUTHORITATIVE_SOURCE = 'satp-client-package';
// Repo-checked fallback is a byte-for-byte copy of SATP idls/v3/escrow_v3.json
// at commit 93fc6c0d86302cfe8b0d8c798ba2817d7eeace44
// (git blob 3d3d675926b6d4e8259adde5783a18827a7a946f, 20548 bytes).
// The git-pinned satp-client install does not currently ship idls/, so the
// repo-checked, hash-pinned copy is the expected consumer path in that layout.
// It supports read-only consumers but cannot satisfy live-write provenance;
// the authoritative package path must be present for authority verification.
const SATP_ESCROW_IDL_FALLBACK_PATH = 'third_party/satp/93fc6c0d/idls/v3/escrow_v3.json';
const SATP_ESCROW_IDL_FALLBACK_COMMIT = '93fc6c0d86302cfe8b0d8c798ba2817d7eeace44';
const SATP_ESCROW_IDL_FALLBACK_BLOB_SHA = '3d3d675926b6d4e8259adde5783a18827a7a946f';
const SATP_ESCROW_IDL_FALLBACK_SOURCE = 'repo-checked-fallback';
const ESCROW_V3_FEE_ROUTING_ROUTES = ['release', 'partial_release'];
const ESCROW_V3_FEE_ROUTING_TREASURY_ACCOUNT = 'treasury';

function toPosixRelative(from, to) {
  const rel = path.relative(from, to);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function resolvePackagedSatpEscrowIdlPath() {
  const candidates = [];

  try {
    const pkgJson = require.resolve('@brainai/satp-client/package.json');
    candidates.push(path.join(path.dirname(pkgJson), SATP_ESCROW_IDL_PACKAGE_RELATIVE));
  } catch {
    // package.json not resolvable from this process
  }

  try {
    let dir = path.dirname(require.resolve('@brainai/satp-client'));
    for (let i = 0; i < 8; i += 1) {
      candidates.push(path.join(dir, SATP_ESCROW_IDL_PACKAGE_RELATIVE));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // package entry not resolvable from this process
  }

  candidates.push(path.join(REPO_ROOT, SATP_ESCROW_IDL_PACKAGE_PATH));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] || path.join(REPO_ROOT, SATP_ESCROW_IDL_PACKAGE_PATH);
}

function resolveSatpEscrowIdl({ packagedSatpEscrowIdlPath, repoCheckedFallbackPath } = {}) {
  const packagedPath = packagedSatpEscrowIdlPath || resolvePackagedSatpEscrowIdlPath();
  const fallbackPath = repoCheckedFallbackPath
    || path.join(REPO_ROOT, SATP_ESCROW_IDL_FALLBACK_PATH);

  if (fs.existsSync(packagedPath)) {
    return {
      usedPath: packagedPath,
      displayPath: SATP_ESCROW_IDL_PACKAGE_PATH,
      packagedMissing: false,
      source: AUTHORITATIVE_SOURCE,
      fallbackUsed: false,
    };
  }

  if (fs.existsSync(fallbackPath)) {
    const fallbackDisplay = toPosixRelative(REPO_ROOT, fallbackPath)
      || SATP_ESCROW_IDL_FALLBACK_PATH;
    return {
      usedPath: fallbackPath,
      displayPath: fallbackDisplay,
      packagedMissing: true,
      source: SATP_ESCROW_IDL_FALLBACK_SOURCE,
      fallbackUsed: true,
    };
  }

  return {
    usedPath: packagedPath,
    displayPath: SATP_ESCROW_IDL_PACKAGE_PATH,
    packagedMissing: true,
    source: null,
    fallbackUsed: false,
  };
}

function readJsonIfPresent(targetPath) {
  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(REPO_ROOT, targetPath);
  if (!fs.existsSync(fullPath)) return null;
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function getEscrowV3ReleaseFeeRoutingReadback({
  idl,
  idlPath = null,
  idlSha256 = null,
  interfaceSource = null,
} = {}) {
  const instructions = Array.isArray(idl?.instructions) ? idl.instructions : [];
  const routes = Object.fromEntries(ESCROW_V3_FEE_ROUTING_ROUTES.map((routeName) => {
    const instruction = instructions.find(({ name }) => name === routeName);
    const accounts = Array.isArray(instruction?.accounts)
      ? instruction.accounts.map(({ name }) => name)
      : [];
    const treasury = Array.isArray(instruction?.accounts)
      ? instruction.accounts.find(({ name }) => name === ESCROW_V3_FEE_ROUTING_TREASURY_ACCOUNT)
      : null;

    return [routeName, {
      present: Boolean(instruction),
      accounts,
      treasuryAccountPresent: Boolean(treasury),
      treasuryAccountWritable: treasury?.writable === true || treasury?.isMut === true,
    }];
  }));
  const supported = ESCROW_V3_FEE_ROUTING_ROUTES.every((routeName) => (
    routes[routeName].present
      && routes[routeName].treasuryAccountPresent
      && routes[routeName].treasuryAccountWritable
  ));

  return {
    status: supported ? 'supported' : 'unsupported',
    supported,
    failClosed: !supported,
    requiredAccount: ESCROW_V3_FEE_ROUTING_TREASURY_ACCOUNT,
    interfaceSource,
    idlPath,
    idlSha256,
    routes,
  };
}

function loadEscrowV3ProvenanceReceipt() {
  return readJsonIfPresent(PROVENANCE_RECEIPT_PATH);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isValidEscrowV3ProvenanceReceipt(receipt) {
  const runtime = receipt?.deployedRuntime || {};
  const rebuild = receipt?.rebuild || {};
  const programMetadataIdl = receipt?.publishedIdl?.programMetadata || {};
  const legacyAnchorIdl = receipt?.publishedIdl?.legacyAnchor || {};
  const rebuiltMatchesAllocated = rebuild.sha256 === runtime.allocatedSha256
    && rebuild.bytes === runtime.allocatedBytes;
  const rebuiltMatchesTrimmed = rebuild.sha256 === runtime.trimmedSha256
    && rebuild.bytes === runtime.trimmedBytes;
  const rebuiltMatchesAllocatedPrefix = rebuild.sha256 === runtime.sourceArtifactPrefixSha256
    && rebuild.bytes === runtime.sourceArtifactPrefixBytes;
  const allocationPaddingIsAllZero = Number.isInteger(runtime.allocationPaddingBytes)
    && runtime.allocationPaddingBytes >= 0
    && runtime.allocationPaddingSha256 === crypto
      .createHash('sha256')
      .update(Buffer.alloc(runtime.allocationPaddingBytes))
      .digest('hex')
    && runtime.allocatedBytes
      === runtime.sourceArtifactPrefixBytes + runtime.allocationPaddingBytes;
  const sourceBuildMatchesDeployedRuntime = rebuiltMatchesAllocatedPrefix
    && allocationPaddingIsAllZero;
  const programMetadataMatchesSource = programMetadataIdl.matchesCanonicalSource === true
    && programMetadataIdl.canonicalJsonSha256 === receipt?.sourceIdl?.sha256
    && programMetadataIdl.instructionCount === receipt?.sourceIdl?.instructionCount;
  const legacyAnchorMatchesSource = legacyAnchorIdl.matchesCanonicalSource === true
    && legacyAnchorIdl.inflatedSha256 === receipt?.sourceIdl?.sha256
    && legacyAnchorIdl.instructionCount === receipt?.sourceIdl?.instructionCount;
  const sourceIdlMatchesPublished = programMetadataMatchesSource && legacyAnchorMatchesSource;
  const threeWayBindingVerified = sourceBuildMatchesDeployedRuntime
    && sourceIdlMatchesPublished;
  const expectedStatus = threeWayBindingVerified
    ? 'verified'
    : sourceBuildMatchesDeployedRuntime
      ? 'source_build_verified_published_idl_mismatch'
      : 'provenance_gap';

  return receipt?.schemaVersion === 2
    && receipt.marker === '[#ef7e4581]'
    && receipt.program?.programId === AUTHORITY_PROGRAM_ID
    && receipt.program?.upgradeSlot === 442907465
    && receipt.source?.commit === PROVENANCE_SOURCE_COMMIT
    && isSha256(receipt.source?.sha256)
    && isSha256(receipt.rebuild?.sha256)
    && isSha256(receipt.deployedRuntime?.allocatedSha256)
    && isSha256(receipt.deployedRuntime?.trimmedSha256)
    && isSha256(receipt.deployedRuntime?.sourceArtifactPrefixSha256)
    && isSha256(receipt.deployedRuntime?.allocationPaddingSha256)
    && isSha256(receipt.sourceIdl?.sha256)
    && isSha256(programMetadataIdl.canonicalJsonSha256)
    && isSha256(legacyAnchorIdl.inflatedSha256)
    && receipt.deployedRuntime.allocatedSha256 === CURRENT_ALLOCATED_RUNTIME_SHA256
    && receipt.deployedRuntime.trimmedSha256 === CURRENT_TRIMMED_RUNTIME_SHA256
    && typeof receipt.bindings?.rebuiltArtifactMatchesAllocatedRuntime === 'boolean'
    && typeof receipt.bindings?.rebuiltArtifactMatchesTrimmedRuntime === 'boolean'
    && typeof receipt.bindings?.rebuiltArtifactMatchesAllocatedPrefix === 'boolean'
    && typeof receipt.bindings?.allocationPaddingIsAllZero === 'boolean'
    && typeof receipt.bindings?.sourceBuildMatchesDeployedRuntime === 'boolean'
    && typeof receipt.bindings?.sourceIdlMatchesPublishedIdl === 'boolean'
    && typeof receipt.bindings?.sourceEqualsDeployedEqualsPublishedIdl === 'boolean'
    && receipt.bindings.rebuiltArtifactMatchesAllocatedRuntime === rebuiltMatchesAllocated
    && receipt.bindings.rebuiltArtifactMatchesTrimmedRuntime === rebuiltMatchesTrimmed
    && receipt.bindings.rebuiltArtifactMatchesAllocatedPrefix === rebuiltMatchesAllocatedPrefix
    && receipt.bindings.allocationPaddingIsAllZero === allocationPaddingIsAllZero
    && receipt.bindings.sourceBuildMatchesDeployedRuntime === sourceBuildMatchesDeployedRuntime
    && receipt.bindings.sourceIdlMatchesPublishedIdl === sourceIdlMatchesPublished
    && receipt.bindings.sourceEqualsDeployedEqualsPublishedIdl === threeWayBindingVerified
    && receipt.status === expectedStatus;
}

function fileInfo(targetPath, displayPath = null) {
  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(REPO_ROOT, targetPath);
  const reportedPath = displayPath
    || toPosixRelative(REPO_ROOT, fullPath)
    || (path.isAbsolute(targetPath) ? targetPath : targetPath);

  if (!fs.existsSync(fullPath)) return { path: reportedPath, exists: false };

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return {
      path: reportedPath,
      exists: true,
      type: 'directory',
    };
  }

  const body = fs.readFileSync(fullPath);
  return {
    path: reportedPath,
    exists: true,
    type: 'file',
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    bytes: body.length,
  };
}

function getSatpClientCommit() {
  const lock = readJsonIfPresent('package-lock.json');
  const dep = lock?.packages?.['']?.dependencies?.['@brainai/satp-client'];
  if (typeof dep !== 'string') return null;
  const match = dep.match(/#([0-9a-f]{7,40})$/i);
  return match ? match[1] : dep;
}

function publicKeyToString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toBase58 === 'function') return value.toBase58();
  return String(value);
}

function normalizeRuntimeProgramId(value) {
  if (!value || (typeof value === 'object' && typeof value.error === 'string')) return null;
  return publicKeyToString(value);
}

function nonEmptyIdlAddress(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSatpRuntimeIds(satpClient) {
  if (!satpClient || typeof satpClient.getV3ProgramIds !== 'function') {
    return { available: false, error: '@brainai/satp-client missing getV3ProgramIds export' };
  }

  const readNetwork = (network) => {
    try {
      const ids = satpClient.getV3ProgramIds(network);
      return publicKeyToString(ids?.ESCROW);
    } catch (err) {
      return { error: err.message };
    }
  };

  return {
    available: true,
    mainnetEscrowProgramId: readNetwork('mainnet'),
    devnetEscrowProgramId: readNetwork('devnet'),
  };
}

function getEscrowV3AuthorityReadback({
  satpClient,
  env = process.env,
  packagedSatpEscrowIdlPath,
  repoCheckedFallbackPath,
} = {}) {
  const sourceWorkspace = fileInfo(AUTHORITY_SOURCE_WORKSPACE);
  const anchorToml = fileInfo(AUTHORITY_ANCHOR_TOML);
  const programSource = fileInfo(AUTHORITY_PROGRAM_SOURCE);
  const trackedIdl = fileInfo(AUTHORITY_IDL_PATH);
  const trackedIdlJson = readJsonIfPresent(AUTHORITY_IDL_PATH);
  const resolvedIdl = resolveSatpEscrowIdl({
    packagedSatpEscrowIdlPath,
    repoCheckedFallbackPath,
  });
  const packagedSatpEscrowIdl = fileInfo(resolvedIdl.usedPath, resolvedIdl.displayPath);
  const packagedSatpEscrowIdlJson = readJsonIfPresent(resolvedIdl.usedPath);
  const releaseFeeRouting = getEscrowV3ReleaseFeeRoutingReadback({
    idl: packagedSatpEscrowIdlJson,
    idlPath: resolvedIdl.displayPath,
    idlSha256: packagedSatpEscrowIdl.sha256 || null,
    interfaceSource: resolvedIdl.source,
  });
  const satpRuntime = readSatpRuntimeIds(satpClient);

  const trackedIdlAddress = trackedIdlJson?.address || null;
  const packagedIdlAddressField = nonEmptyIdlAddress(packagedSatpEscrowIdlJson?.address);
  const satpMainnetEscrow = normalizeRuntimeProgramId(satpRuntime.mainnetEscrowProgramId);
  // The authoritative package now carries an explicit HXCU IDL address. Keep the
  // runtime fallback for compatibility with earlier package layouts.
  const packagedIdlAddress = packagedIdlAddressField || satpMainnetEscrow || null;
  const packagedIdlInstructionCount = Array.isArray(packagedSatpEscrowIdlJson?.instructions)
    ? packagedSatpEscrowIdlJson.instructions.length
    : null;
  const leftoverSourceComplete = anchorToml.exists && programSource.exists && trackedIdl.exists;
  const trackedIdlMatches = trackedIdlAddress === AUTHORITY_PROGRAM_ID;
  const satpMainnetMatches = satpRuntime.mainnetEscrowProgramId === AUTHORITY_PROGRAM_ID;
  const satpDevnetMatches = satpRuntime.devnetEscrowProgramId === AUTHORITY_PROGRAM_ID;
  const packagedIdlMatches = packagedSatpEscrowIdl.exists && packagedIdlAddress === AUTHORITY_PROGRAM_ID;
  const packagedIdlSourceMatches = resolvedIdl.packagedMissing === false
    && resolvedIdl.source === AUTHORITATIVE_SOURCE;
  const packagedIdlInstructionCountMatches = packagedIdlInstructionCount === AUTHORITY_INSTRUCTION_COUNT;
  const packagedIdlHashMatches = packagedSatpEscrowIdl.sha256 === AUTHORITY_IDL_SHA256;
  // AF onchain/escrow_v3 is leftover inventory. SATP package is the authority.
  // B1Se is the separate devnet runtime and must not invalidate finalized mainnet
  // HXCU provenance. Live writes remain independently owner-gated below.
  const verified = packagedIdlMatches
    && packagedIdlSourceMatches
    && packagedIdlInstructionCountMatches
    && packagedIdlHashMatches
    && satpMainnetMatches;
  const liveEscrow = liveEscrowGateStatus(env);
  const liveEscrowWritesAllowed = verified && liveEscrow.enabled;

  return {
    label: AUTHORITY_LABEL,
    expectedProgramId: AUTHORITY_PROGRAM_ID,
    expectedProgramIdProvenance: AUTHORITY_PROGRAM_ID_PROVENANCE,
    status: verified ? 'verified' : 'blocked_pending_authoritative_source_idl',
    leftoverInventory: {
      sourceWorkspace,
      anchorToml,
      programSource,
      trackedIdl: {
        ...trackedIdl,
        address: trackedIdlAddress,
        matchesExpectedProgramId: trackedIdlMatches,
      },
      sourceComplete: leftoverSourceComplete,
      leftoverRuntimeNetwork: liveEscrow.leftoverRuntimeNetwork || LEFTOVER_RUNTIME_NETWORK,
      leftoverRuntimeProgramId: normalizeRuntimeProgramId(satpRuntime.devnetEscrowProgramId)
        || liveEscrow.leftoverRuntimeProgramId
        || LEFTOVER_RUNTIME_ESCROW_PROGRAM_ID,
      hostEnvSplit: HOST_ENV_SPLIT_NOTE,
      note: 'AgentFolio onchain/escrow_v3 is leftover non-authoritative inventory; SATP satp-client package is the IDL/program source of truth. HXCU-vs-B1Se is a host env split, not a missing IDL.',
    },
    advertisedNetwork: ADVERTISED_NETWORK,
    advertisedEscrowProgramId: ADVERTISED_ESCROW_PROGRAM_ID,
    hostEnvSplit: HOST_ENV_SPLIT_NOTE,
    sourceWorkspace,
    anchorToml,
    programSource,
    trackedIdl: {
      ...trackedIdl,
      address: trackedIdlAddress,
      matchesExpectedProgramId: trackedIdlMatches,
    },
    packagedSatpEscrowIdl: {
      ...packagedSatpEscrowIdl,
      path: packagedSatpEscrowIdl.path || resolvedIdl.displayPath,
      address: packagedIdlAddress,
      addressField: packagedSatpEscrowIdlJson?.address ?? null,
      matchesExpectedProgramId: packagedIdlMatches,
      matchesAuthoritativeSource: packagedIdlSourceMatches,
      instructionCount: packagedIdlInstructionCount,
      matchesExpectedInstructionCount: packagedIdlInstructionCountMatches,
      expectedSha256: AUTHORITY_IDL_SHA256,
      matchesExpectedSha256: packagedIdlHashMatches,
      packagedMissing: resolvedIdl.packagedMissing,
      source: resolvedIdl.source,
      fallback: {
        path: SATP_ESCROW_IDL_FALLBACK_PATH,
        satpCommit: SATP_ESCROW_IDL_FALLBACK_COMMIT,
        blobSha: SATP_ESCROW_IDL_FALLBACK_BLOB_SHA,
        used: resolvedIdl.fallbackUsed,
      },
    },
    releaseFeeRouting,
    satpArtifact: {
      commit: getSatpClientCommit(),
      runtime: satpRuntime,
      mainnetMatchesExpectedProgramId: satpMainnetMatches,
      devnetMatchesExpectedProgramId: satpDevnetMatches,
    },
    releaseGate: {
      liveEscrowWritesAllowed,
      ownerAuthorizationRequired: true,
      ownerAuthorizationStatus: liveEscrow.ownerAuthorization.status,
      ownerAuthorizationEnv: liveEscrow.ownerAuthorization.env,
      readOnlyPosture: liveEscrow.readOnlyPosture,
      reason: liveEscrowWritesAllowed
        ? 'authoritative SATP mainnet runtime and 14-instruction IDL, live escrow flag, and explicit Owner authorization all agree'
        : 'authoritative SATP mainnet runtime and 14-instruction IDL are readable, but live escrow writes stay read-only until release gating and explicit Owner authorization clear',
    },
  };
}

function getEscrowV3ProvenanceReadback({
  authorityReadback,
  network = 'mainnet',
  provenanceReceipt = loadEscrowV3ProvenanceReceipt(),
} = {}) {
  const readback = authorityReadback || getEscrowV3AuthorityReadback();
  const normalizedNetwork = String(network || '').toLowerCase().includes('devnet') ? 'devnet' : 'mainnet';
  const runtime = readback.satpArtifact?.runtime || {};
  const runtimeProgramId = normalizedNetwork === 'devnet'
    ? normalizeRuntimeProgramId(runtime.devnetEscrowProgramId)
    : normalizeRuntimeProgramId(runtime.mainnetEscrowProgramId);
  const packaged = readback.packagedSatpEscrowIdl || {};
  const receiptValid = isValidEscrowV3ProvenanceReceipt(provenanceReceipt);
  const bindings = receiptValid ? provenanceReceipt.bindings : null;
  const sourceBuildVerified = bindings?.sourceBuildMatchesDeployedRuntime === true;
  const threeWayBindingVerified = bindings?.sourceEqualsDeployedEqualsPublishedIdl === true;
  const sourceHash = receiptValid ? provenanceReceipt.source.sha256 : null;
  const sourceIdlHash = receiptValid ? provenanceReceipt.sourceIdl.sha256 : null;
  const publishedIdlHash = receiptValid
    ? provenanceReceipt.publishedIdl.programMetadata.canonicalJsonSha256
    : null;
  const idlProgramId = packaged.address || null;
  const idlInstructionCount = packaged.instructionCount ?? null;
  const escrowProgramId = readback.expectedProgramId || null;

  const mismatches = [];
  if (!provenanceReceipt) {
    mismatches.push('missing_provenance_receipt');
  } else if (!receiptValid) {
    mismatches.push('invalid_provenance_receipt');
  } else {
    if (bindings.sourceBuildMatchesDeployedRuntime !== true) {
      mismatches.push('source_build_deployed_runtime_mismatch');
    }
    if (bindings.sourceIdlMatchesPublishedIdl !== true) {
      mismatches.push('source_idl_published_idl_mismatch');
    }
    if (provenanceReceipt.program.programId !== escrowProgramId) {
      mismatches.push('receipt_program_id_mismatch');
    }
  }
  // AF onchain/escrow_v3 missing is leftover inventory, not a provenance mismatch.
  if (!packaged.exists) {
    mismatches.push('missing_packaged_idl');
  } else if (!packaged.sha256) {
    mismatches.push('missing_packaged_idl');
  } else if (packaged.matchesAuthoritativeSource !== true) {
    mismatches.push('packaged_idl_authoritative_source_mismatch');
  } else if (packaged.matchesExpectedProgramId !== true) {
    mismatches.push('packaged_idl_program_id_mismatch');
  } else if (packaged.matchesExpectedInstructionCount !== true) {
    mismatches.push('packaged_idl_instruction_count_mismatch');
  } else if (packaged.matchesExpectedSha256 !== true) {
    mismatches.push('packaged_idl_hash_mismatch');
  }
  if (runtime.available === false) mismatches.push('runtime_unavailable');
  if (readback.satpArtifact?.mainnetMatchesExpectedProgramId !== true) {
    mismatches.push('mainnet_runtime_program_id_mismatch');
  }
  if (readback.status && readback.status !== 'verified') {
    mismatches.push('authority_status_not_verified');
  }
  const liveEscrowWritesAllowed = threeWayBindingVerified
    && mismatches.length === 0
    && readback.releaseGate?.liveEscrowWritesAllowed === true;

  return {
    label: readback.label || AUTHORITY_LABEL,
    authoritativeSource: sourceBuildVerified ? provenanceReceipt.source.repository : null,
    consumerInterfaceSource: AUTHORITATIVE_SOURCE,
    provenanceReceiptPath: PROVENANCE_RECEIPT_PATH,
    provenanceStatus: receiptValid ? provenanceReceipt.status : 'unverified',
    receiptBaseline: receiptValid ? provenanceReceipt.baseline : null,
    advertisedNetwork: ADVERTISED_NETWORK,
    advertisedEscrowProgramId: ADVERTISED_ESCROW_PROGRAM_ID,
    escrowProgramId,
    artifactCommit: receiptValid ? provenanceReceipt.source.commit : null,
    sourceHash,
    // Public consumer IDL hash follows the packaged SATP interface. The
    // independently pinned source/published hashes remain separate below.
    idlHash: packaged.sha256 || sourceIdlHash,
    sourceIdlHash,
    publishedIdlHash,
    publishedIdls: receiptValid ? provenanceReceipt.publishedIdl : null,
    rebuiltArtifactHash: receiptValid ? provenanceReceipt.rebuild.sha256 : null,
    deployedRuntime: receiptValid ? provenanceReceipt.deployedRuntime : null,
    buildInputs: receiptValid ? provenanceReceipt.buildInputs : null,
    toolchain: receiptValid ? provenanceReceipt.toolchain : null,
    bindings,
    residualGate: receiptValid ? provenanceReceipt.residualGate : null,
    idlProgramId,
    idlInstructionCount,
    runtimeProgramId,
    leftoverRuntimeProgramId: normalizeRuntimeProgramId(runtime.devnetEscrowProgramId)
      || LEFTOVER_RUNTIME_ESCROW_PROGRAM_ID,
    leftoverRuntimeNetwork: LEFTOVER_RUNTIME_NETWORK,
    runtimeProgramIds: {
      mainnet: normalizeRuntimeProgramId(runtime.mainnetEscrowProgramId),
      devnet: normalizeRuntimeProgramId(runtime.devnetEscrowProgramId),
    },
    hostEnvSplit: HOST_ENV_SPLIT_NOTE,
    mismatchStatus: mismatches.length ? 'mismatch' : 'matched',
    mismatches,
    failClosed: mismatches.length > 0,
    liveEscrowWritesAllowed,
  };
}

module.exports = {
  ADVERTISED_ESCROW_PROGRAM_ID,
  ADVERTISED_NETWORK,
  AUTHORITY_ANCHOR_TOML,
  AUTHORITY_IDL_SHA256,
  AUTHORITY_IDL_PATH,
  AUTHORITY_INSTRUCTION_COUNT,
  AUTHORITY_LABEL,
  AUTHORITY_PROGRAM_ID,
  AUTHORITY_PROGRAM_ID_PROVENANCE,
  AUTHORITY_PROGRAM_SOURCE,
  AUTHORITY_SOURCE_WORKSPACE,
  AUTHORITATIVE_SOURCE,
  HOST_ENV_SPLIT_NOTE,
  LEFTOVER_RUNTIME_ESCROW_PROGRAM_ID,
  LEFTOVER_RUNTIME_NETWORK,
  PROVENANCE_RECEIPT_PATH,
  SATP_ESCROW_IDL_FALLBACK_BLOB_SHA,
  SATP_ESCROW_IDL_FALLBACK_COMMIT,
  SATP_ESCROW_IDL_FALLBACK_PATH,
  SATP_ESCROW_IDL_FALLBACK_SOURCE,
  SATP_ESCROW_IDL_PACKAGE_PATH,
  SATP_ESCROW_IDL_PACKAGE_RELATIVE,
  getEscrowV3AuthorityReadback,
  getEscrowV3ReleaseFeeRoutingReadback,
  getEscrowV3ProvenanceReadback,
  isValidEscrowV3ProvenanceReceipt,
  loadEscrowV3ProvenanceReceipt,
  resolvePackagedSatpEscrowIdlPath,
  resolveSatpEscrowIdl,
};
