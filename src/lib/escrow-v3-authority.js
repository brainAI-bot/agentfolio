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
const AUTHORITY_PROGRAM_ID_PROVENANCE = 'Expected program id from git-pinned @brainai/satp-client commit 551c7971766a2f3bf401a6ac0d57900be536bcb4 (packaged 14-instruction idls/v3/escrow_v3.json + getV3ProgramIds(\'mainnet\').ESCROW); AgentFolio onchain/escrow_v3 is non-authoritative inventory';
const AUTHORITY_LABEL = 'escrow_v3';
const AUTHORITY_SOURCE_WORKSPACE = 'onchain/escrow_v3';
const AUTHORITY_ANCHOR_TOML = 'onchain/escrow_v3/Anchor.toml';
const AUTHORITY_IDL_PATH = 'onchain/escrow_v3/target/idl/escrow_v3.json';
const AUTHORITY_PROGRAM_SOURCE = 'onchain/escrow_v3/programs/escrow_v3/src/lib.rs';
const PROVENANCE_RECEIPT_PATH = 'config/escrow-v3-provenance-ef7e4581.json';
const SATP_ESCROW_IDL_PACKAGE_RELATIVE = 'idls/v3/escrow_v3.json';
const SATP_ESCROW_IDL_PACKAGE_PATH = 'node_modules/@brainai/satp-client/idls/v3/escrow_v3.json';
const AUTHORITATIVE_SOURCE = 'satp-client-package';
// Repo-checked fallback is a byte-for-byte copy of SATP idls/v3/escrow_v3.json
// at commit 240dba99dc4e555e9dd221d93f76f2726bd8159e
// (git blob d616b30414c9e718a4da39cc51c473a84136ff9b, 20504 bytes).
// Used only when the packaged satp-client file is missing (host git-pin
// install does not ship idls/). Authoritative source remains satp-client-package.
const SATP_ESCROW_IDL_FALLBACK_PATH = 'third_party/satp/240dba99/idls/v3/escrow_v3.json';
const SATP_ESCROW_IDL_FALLBACK_COMMIT = '240dba99dc4e555e9dd221d93f76f2726bd8159e';
const SATP_ESCROW_IDL_FALLBACK_BLOB_SHA = 'd616b30414c9e718a4da39cc51c473a84136ff9b';
const SATP_ESCROW_IDL_FALLBACK_SOURCE = 'repo-checked-fallback';

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

function loadEscrowV3ProvenanceReceipt() {
  return readJsonIfPresent(PROVENANCE_RECEIPT_PATH);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isValidEscrowV3ProvenanceReceipt(receipt) {
  const rebuiltMatchesAllocated = receipt?.rebuild?.sha256 === receipt?.deployedRuntime?.allocatedSha256;
  const rebuiltMatchesTrimmed = receipt?.rebuild?.sha256 === receipt?.deployedRuntime?.trimmedSha256;
  const sourceIdlMatchesPublished = receipt?.sourceIdl?.sha256 === receipt?.publishedIdl?.inflatedSha256;
  const threeWayBindingVerified = (rebuiltMatchesAllocated || rebuiltMatchesTrimmed)
    && sourceIdlMatchesPublished;

  return receipt?.schemaVersion === 1
    && receipt.marker === '[#ef7e4581]'
    && receipt.program?.programId === AUTHORITY_PROGRAM_ID
    && isSha256(receipt.source?.sha256)
    && isSha256(receipt.rebuild?.sha256)
    && isSha256(receipt.deployedRuntime?.allocatedSha256)
    && isSha256(receipt.deployedRuntime?.trimmedSha256)
    && isSha256(receipt.sourceIdl?.sha256)
    && isSha256(receipt.publishedIdl?.inflatedSha256)
    && typeof receipt.bindings?.rebuiltArtifactMatchesAllocatedRuntime === 'boolean'
    && typeof receipt.bindings?.rebuiltArtifactMatchesTrimmedRuntime === 'boolean'
    && typeof receipt.bindings?.sourceIdlMatchesPublishedIdl === 'boolean'
    && typeof receipt.bindings?.sourceEqualsDeployedEqualsPublishedIdl === 'boolean'
    && receipt.bindings.rebuiltArtifactMatchesAllocatedRuntime === rebuiltMatchesAllocated
    && receipt.bindings.rebuiltArtifactMatchesTrimmedRuntime === rebuiltMatchesTrimmed
    && receipt.bindings.sourceIdlMatchesPublishedIdl === sourceIdlMatchesPublished
    && receipt.bindings.sourceEqualsDeployedEqualsPublishedIdl === threeWayBindingVerified
    && receipt.status === (threeWayBindingVerified ? 'verified' : 'provenance_gap');
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
    network: 'mainnet',
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
  const satpRuntime = readSatpRuntimeIds(satpClient);

  const trackedIdlAddress = trackedIdlJson?.address || null;
  const packagedIdlAddressField = nonEmptyIdlAddress(packagedSatpEscrowIdlJson?.address);
  const satpMainnetEscrow = normalizeRuntimeProgramId(satpRuntime.mainnetEscrowProgramId);
  const packagedIdlInstructionCount = Array.isArray(packagedSatpEscrowIdlJson?.instructions)
    ? packagedSatpEscrowIdlJson.instructions.length
    : null;
  const packagedIdlAddress = packagedIdlAddressField || satpMainnetEscrow || null;
  const leftoverSourceComplete = anchorToml.exists && programSource.exists && trackedIdl.exists;
  const trackedIdlMatches = trackedIdlAddress === AUTHORITY_PROGRAM_ID;
  const satpMainnetMatches = satpRuntime.mainnetEscrowProgramId === AUTHORITY_PROGRAM_ID;
  const packagedIdlMatches = packagedSatpEscrowIdl.exists
    && resolvedIdl.packagedMissing === false
    && packagedIdlAddress === AUTHORITY_PROGRAM_ID
    && packagedIdlInstructionCount === 14;
  // AF onchain/escrow_v3 is leftover inventory. SATP package is the authority.
  const verified = packagedIdlMatches && satpMainnetMatches;
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
      leftoverRuntimeProgramId: liveEscrow.leftoverRuntimeProgramId
        || LEFTOVER_RUNTIME_ESCROW_PROGRAM_ID,
      hostEnvSplit: HOST_ENV_SPLIT_NOTE,
      note: 'AgentFolio onchain/escrow_v3 is non-authoritative inventory; the pinned SATP package is the IDL/program source of truth and the runtime is mainnet HXCU.',
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
      instructionCount: packagedIdlInstructionCount,
      matchesExpectedProgramId: packagedIdlMatches,
      packagedMissing: resolvedIdl.packagedMissing,
      source: resolvedIdl.source,
      fallback: {
        path: SATP_ESCROW_IDL_FALLBACK_PATH,
        satpCommit: SATP_ESCROW_IDL_FALLBACK_COMMIT,
        blobSha: SATP_ESCROW_IDL_FALLBACK_BLOB_SHA,
        used: resolvedIdl.fallbackUsed,
      },
    },
    satpArtifact: {
      commit: getSatpClientCommit(),
      runtime: satpRuntime,
      mainnetMatchesExpectedProgramId: satpMainnetMatches,
    },
    releaseGate: {
      liveEscrowWritesAllowed,
      ownerAuthorizationRequired: true,
      ownerAuthorizationStatus: liveEscrow.ownerAuthorization.status,
      ownerAuthorizationEnv: liveEscrow.ownerAuthorization.env,
      readOnlyPosture: liveEscrow.readOnlyPosture,
      reason: liveEscrowWritesAllowed
        ? 'escrow_v3 source, IDL, SATP runtime, packaged IDL, live escrow flag, and explicit Owner authorization all agree'
        : 'escrow_v3 PDA reads may derive from the published SATP client, but live escrow writes stay read-only until source/IDL provenance, release gating, and explicit Owner authorization all clear',
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
  const threeWayBindingVerified = bindings?.sourceEqualsDeployedEqualsPublishedIdl === true;
  const sourceHash = receiptValid ? provenanceReceipt.source.sha256 : null;
  const sourceIdlHash = receiptValid ? provenanceReceipt.sourceIdl.sha256 : null;
  const publishedIdlHash = receiptValid ? provenanceReceipt.publishedIdl.inflatedSha256 : null;
  const idlProgramId = packaged.address || null;
  const escrowProgramId = readback.expectedProgramId || null;

  const mismatches = [];
  if (!provenanceReceipt) {
    mismatches.push('missing_provenance_receipt');
  } else if (!receiptValid) {
    mismatches.push('invalid_provenance_receipt');
  } else {
    if (bindings.rebuiltArtifactMatchesAllocatedRuntime !== true
      && bindings.rebuiltArtifactMatchesTrimmedRuntime !== true) {
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
  } else if (packaged.matchesExpectedProgramId !== true) {
    mismatches.push('packaged_idl_program_id_mismatch');
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
    authoritativeSource: threeWayBindingVerified ? provenanceReceipt.source.repository : null,
    consumerInterfaceSource: AUTHORITATIVE_SOURCE,
    provenanceReceiptPath: PROVENANCE_RECEIPT_PATH,
    provenanceStatus: receiptValid ? provenanceReceipt.status : 'unverified',
    receiptBaseline: receiptValid ? provenanceReceipt.baseline : null,
    advertisedNetwork: ADVERTISED_NETWORK,
    advertisedEscrowProgramId: ADVERTISED_ESCROW_PROGRAM_ID,
    escrowProgramId,
    artifactCommit: receiptValid ? provenanceReceipt.source.commit : null,
    sourceHash,
    idlHash: sourceIdlHash,
    sourceIdlHash,
    publishedIdlHash,
    rebuiltArtifactHash: receiptValid ? provenanceReceipt.rebuild.sha256 : null,
    deployedRuntime: receiptValid ? provenanceReceipt.deployedRuntime : null,
    buildInputs: receiptValid ? provenanceReceipt.buildInputs : null,
    toolchain: receiptValid ? provenanceReceipt.toolchain : null,
    bindings,
    residualGate: receiptValid ? provenanceReceipt.residualGate : null,
    idlProgramId,
    runtimeProgramId,
    leftoverRuntimeProgramId: LEFTOVER_RUNTIME_ESCROW_PROGRAM_ID,
    leftoverRuntimeNetwork: LEFTOVER_RUNTIME_NETWORK,
    runtimeProgramIds: {
      mainnet: normalizeRuntimeProgramId(runtime.mainnetEscrowProgramId),
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
  AUTHORITY_IDL_PATH,
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
  getEscrowV3ProvenanceReadback,
  isValidEscrowV3ProvenanceReceipt,
  loadEscrowV3ProvenanceReceipt,
  resolvePackagedSatpEscrowIdlPath,
  resolveSatpEscrowIdl,
};
