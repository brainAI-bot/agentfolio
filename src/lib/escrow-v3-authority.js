'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  liveEscrowGateStatus,
} = require('./write-surface-gate');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUTHORITY_PROGRAM_ID = 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C';
const AUTHORITY_PROGRAM_ID_PROVENANCE = 'H2/D1 AgentFolio runtime record carried by git-pinned @brainai/satp-client commit 2752dcc99b7ece9f5452c7273123232a92d7067f; preserved by published @brainai/satp-client mainnet ESCROW constant';
const AUTHORITY_LABEL = 'escrow_v3';
const AUTHORITY_SOURCE_WORKSPACE = 'onchain/escrow_v3';
const AUTHORITY_ANCHOR_TOML = 'onchain/escrow_v3/Anchor.toml';
const AUTHORITY_IDL_PATH = 'onchain/escrow_v3/target/idl/escrow_v3.json';
const AUTHORITY_PROGRAM_SOURCE = 'onchain/escrow_v3/programs/escrow_v3/src/lib.rs';
const SATP_ESCROW_IDL_PACKAGE_PATH = 'node_modules/@brainai/satp-client/idls/satp_escrow.json';

function readJsonIfPresent(relativePath) {
  const fullPath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function fileInfo(relativePath) {
  const fullPath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return { path: relativePath, exists: false };

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return {
      path: relativePath,
      exists: true,
      type: 'directory',
    };
  }

  const body = fs.readFileSync(fullPath);
  return {
    path: relativePath,
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

function getEscrowV3AuthorityReadback({ satpClient, env = process.env } = {}) {
  const sourceWorkspace = fileInfo(AUTHORITY_SOURCE_WORKSPACE);
  const anchorToml = fileInfo(AUTHORITY_ANCHOR_TOML);
  const programSource = fileInfo(AUTHORITY_PROGRAM_SOURCE);
  const trackedIdl = fileInfo(AUTHORITY_IDL_PATH);
  const trackedIdlJson = readJsonIfPresent(AUTHORITY_IDL_PATH);
  const packagedSatpEscrowIdl = fileInfo(SATP_ESCROW_IDL_PACKAGE_PATH);
  const packagedSatpEscrowIdlJson = readJsonIfPresent(SATP_ESCROW_IDL_PACKAGE_PATH);
  const satpRuntime = readSatpRuntimeIds(satpClient);

  const trackedIdlAddress = trackedIdlJson?.address || null;
  const packagedIdlAddress = packagedSatpEscrowIdlJson?.address || null;
  const sourceComplete = anchorToml.exists && programSource.exists && trackedIdl.exists;
  const trackedIdlMatches = trackedIdlAddress === AUTHORITY_PROGRAM_ID;
  const satpMainnetMatches = satpRuntime.mainnetEscrowProgramId === AUTHORITY_PROGRAM_ID;
  const satpDevnetMatches = satpRuntime.devnetEscrowProgramId === AUTHORITY_PROGRAM_ID;
  const packagedIdlMatches = packagedIdlAddress === AUTHORITY_PROGRAM_ID;
  const verified = sourceComplete && trackedIdlMatches && satpMainnetMatches && satpDevnetMatches && packagedIdlMatches;
  const liveEscrow = liveEscrowGateStatus(env);
  const liveEscrowWritesAllowed = verified && liveEscrow.enabled;

  return {
    label: AUTHORITY_LABEL,
    expectedProgramId: AUTHORITY_PROGRAM_ID,
    expectedProgramIdProvenance: AUTHORITY_PROGRAM_ID_PROVENANCE,
    status: verified ? 'verified' : 'blocked_pending_authoritative_source_idl',
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
      address: packagedIdlAddress,
      matchesExpectedProgramId: packagedIdlMatches,
    },
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
        ? 'escrow_v3 source, IDL, SATP runtime, packaged IDL, live escrow flag, and explicit Owner authorization all agree'
        : 'escrow_v3 PDA reads may derive from the published SATP client, but live escrow writes stay read-only until source/IDL provenance, release gating, and explicit Owner authorization all clear',
    },
  };
}

function getEscrowV3ProvenanceReadback({ authorityReadback, network = 'mainnet' } = {}) {
  const readback = authorityReadback || getEscrowV3AuthorityReadback();
  const normalizedNetwork = String(network || '').toLowerCase().includes('devnet') ? 'devnet' : 'mainnet';
  const runtime = readback.satpArtifact?.runtime || {};
  const runtimeProgramId = normalizedNetwork === 'devnet'
    ? normalizeRuntimeProgramId(runtime.devnetEscrowProgramId)
    : normalizeRuntimeProgramId(runtime.mainnetEscrowProgramId);
  const sourceHash = readback.programSource?.sha256 || null;
  const idlHash = readback.trackedIdl?.sha256 || null;
  const idlProgramId = readback.trackedIdl?.address || null;
  const escrowProgramId = readback.expectedProgramId || null;

  const mismatches = [];
  if (!readback.anchorToml?.exists) mismatches.push('missing_anchor_toml');
  if (!readback.programSource?.exists || !sourceHash) mismatches.push('missing_source_hash');
  if (!readback.trackedIdl?.exists || !idlHash) {
    mismatches.push('missing_idl_hash');
  } else if (readback.trackedIdl.matchesExpectedProgramId !== true) {
    mismatches.push('tracked_idl_program_id_mismatch');
  }
  if (!readback.packagedSatpEscrowIdl?.exists) {
    mismatches.push('missing_packaged_idl');
  } else if (readback.packagedSatpEscrowIdl.matchesExpectedProgramId !== true) {
    mismatches.push('packaged_idl_program_id_mismatch');
  }
  if (runtime.available === false) mismatches.push('runtime_unavailable');
  if (readback.satpArtifact?.mainnetMatchesExpectedProgramId !== true) {
    mismatches.push('mainnet_runtime_program_id_mismatch');
  }
  if (readback.satpArtifact?.devnetMatchesExpectedProgramId !== true) {
    mismatches.push('devnet_runtime_program_id_mismatch');
  }
  if (readback.status && readback.status !== 'verified' && mismatches.length === 0) {
    mismatches.push('authority_status_not_verified');
  }
  const liveEscrowWritesAllowed = mismatches.length === 0
    && readback.releaseGate?.liveEscrowWritesAllowed === true;

  return {
    label: readback.label || AUTHORITY_LABEL,
    escrowProgramId,
    artifactCommit: readback.satpArtifact?.commit || null,
    sourceHash,
    idlHash,
    idlProgramId,
    runtimeProgramId,
    runtimeProgramIds: {
      mainnet: normalizeRuntimeProgramId(runtime.mainnetEscrowProgramId),
      devnet: normalizeRuntimeProgramId(runtime.devnetEscrowProgramId),
    },
    mismatchStatus: mismatches.length ? 'mismatch' : 'matched',
    mismatches,
    failClosed: mismatches.length > 0,
    liveEscrowWritesAllowed,
  };
}

module.exports = {
  AUTHORITY_ANCHOR_TOML,
  AUTHORITY_IDL_PATH,
  AUTHORITY_LABEL,
  AUTHORITY_PROGRAM_ID,
  AUTHORITY_PROGRAM_ID_PROVENANCE,
  AUTHORITY_PROGRAM_SOURCE,
  AUTHORITY_SOURCE_WORKSPACE,
  SATP_ESCROW_IDL_PACKAGE_PATH,
  getEscrowV3AuthorityReadback,
  getEscrowV3ProvenanceReadback,
};
