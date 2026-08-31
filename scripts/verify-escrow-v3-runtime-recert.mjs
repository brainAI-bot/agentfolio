#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { allocatedPayloadInvariant } from './lib/allocated-payload-invariant.mjs';

const RECEIPT = JSON.parse(fs.readFileSync(
  new URL('../config/escrow-v3-provenance-ef7e4581.json', import.meta.url),
  'utf8',
));

const EXPECTED = Object.freeze({
  programId: RECEIPT.program.programId,
  programData: RECEIPT.program.programData,
  upgradeAuthority: RECEIPT.program.upgradeAuthority,
  upgradeTransaction: RECEIPT.program.upgradeTransaction,
  upgradeSlot: RECEIPT.program.upgradeSlot,
  upgradeTime: RECEIPT.program.upgradeTime,
  programMetadataIdl: RECEIPT.publishedIdl.programMetadata,
  legacyAnchorIdl: RECEIPT.publishedIdl.legacyAnchor,
  sourceCommit: RECEIPT.source.commit,
  sourceSha256: RECEIPT.source.sha256,
  sourceIdlSha256: RECEIPT.sourceIdl.sha256,
});

const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const PROGRAMDATA_HEADER_LENGTH = 45;
const PROGRAM_METADATA_IDL_HEADER_LENGTH = 96;
const LEGACY_ANCHOR_IDL_HEADER_LENGTH = 44;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const RPC_ATTEMPTS = 4;

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

class RpcInfrastructureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RpcInfrastructureError';
  }
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function encodeBase58(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return '1'.repeat(leadingZeroes) + encoded;
}

function trimTrailingZeroes(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return bytes.subarray(0, end);
}

function instructionNames(idl) {
  return (idl.instructions || []).map((instruction) => instruction.name).sort();
}

function instructionAccountNames(idl, instructionName) {
  const instruction = (idl.instructions || []).find(({ name }) => name === instructionName);
  return (instruction?.accounts || []).map(({ name }) => name);
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function rpc(method, params) {
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      });
    } catch (error) {
      if (attempt < RPC_ATTEMPTS) {
        await sleep(500 * (2 ** (attempt - 1)));
        continue;
      }
      throw new RpcInfrastructureError(`RPC ${method} network failure after ${attempt} attempts: ${error.message}`);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < RPC_ATTEMPTS) {
        await sleep(500 * (2 ** (attempt - 1)));
        continue;
      }
      throw new RpcInfrastructureError(`RPC ${method} returned HTTP ${response.status} after ${attempt} attempts`);
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new RpcInfrastructureError(`RPC ${method} returned invalid JSON: ${error.message}`);
    }
    if (body.error && [-32005, -32004, -32603].includes(body.error.code)
      && attempt < RPC_ATTEMPTS) {
      await sleep(500 * (2 ** (attempt - 1)));
      continue;
    }
    if (body.error) throw new RpcInfrastructureError(`RPC ${method} failed: ${JSON.stringify(body.error)}`);
    return body.result;
  }
  throw new RpcInfrastructureError(`RPC ${method} exhausted retries`);
}

async function account(address) {
  const result = await rpc('getAccountInfo', [address, { commitment: 'finalized', encoding: 'base64' }]);
  if (!result.value) throw new Error(`account ${address} is absent`);
  return { ...result.value, data: Buffer.from(result.value.data[0], 'base64') };
}

function compareRequiredAccounts(publishedIdl) {
  const result = {};
  for (const [instruction, required] of Object.entries(RECEIPT.sourceIdl.requiredFeeRoutingAccounts)) {
    const actual = instructionAccountNames(publishedIdl, instruction);
    result[instruction] = required.filter((name) => !actual.includes(name));
  }
  return result;
}

async function main() {
  const artifactPath = arg('--artifact');
  const sourcePath = arg('--source');
  const sourceIdlPath = arg('--source-idl');
  const sourceCommit = arg('--source-commit');
  const packetArguments = [artifactPath, sourcePath, sourceIdlPath, sourceCommit];
  const anyPacketArgumentProvided = packetArguments.some(Boolean);
  const fullPacketProvided = packetArguments.every(Boolean);
  if (anyPacketArgumentProvided && !fullPacketProvided) {
    throw new InputError('--artifact, --source, --source-idl, and --source-commit must be supplied together');
  }
  for (const packetPath of [artifactPath, sourcePath, sourceIdlPath].filter(Boolean)) {
    if (!fs.existsSync(packetPath)) throw new InputError(`packet file is absent: ${packetPath}`);
  }

  const program = await account(EXPECTED.programId);
  const programData = await account(EXPECTED.programData);
  const programMetadataIdlAccount = await account(EXPECTED.programMetadataIdl.account);
  const legacyAnchorIdlAccount = await account(EXPECTED.legacyAnchorIdl.account);
  const transaction = await rpc('getTransaction', [
    EXPECTED.upgradeTransaction,
    { commitment: 'finalized', maxSupportedTransactionVersion: 0 },
  ]);
  if (!transaction) throw new Error(`upgrade transaction ${EXPECTED.upgradeTransaction} is absent`);

  const derivedProgramData = encodeBase58(program.data.subarray(4, 36));
  const programDataSlot = Number(programData.data.readBigUInt64LE(4));
  const upgradeAuthority = encodeBase58(programData.data.subarray(13, 45));
  const allocatedBinary = programData.data.subarray(PROGRAMDATA_HEADER_LENGTH);
  const sourceArtifactPrefix = allocatedBinary.subarray(0, RECEIPT.deployedRuntime.sourceArtifactPrefixBytes);
  const allocationPadding = allocatedBinary.subarray(RECEIPT.deployedRuntime.sourceArtifactPrefixBytes);
  const trimmedBinary = trimTrailingZeroes(allocatedBinary);
  const programMetadataIdlBytes = zlib.inflateSync(
    programMetadataIdlAccount.data.subarray(PROGRAM_METADATA_IDL_HEADER_LENGTH),
  );
  const programMetadataIdl = JSON.parse(programMetadataIdlBytes);
  const legacyCompressedLength = legacyAnchorIdlAccount.data.readUInt32LE(40);
  const legacyAnchorIdlBytes = zlib.inflateSync(
    legacyAnchorIdlAccount.data.subarray(
      LEGACY_ANCHOR_IDL_HEADER_LENGTH,
      LEGACY_ANCHOR_IDL_HEADER_LENGTH + legacyCompressedLength,
    ),
  );
  const legacyAnchorIdl = JSON.parse(legacyAnchorIdlBytes);
  const upgradeTransactionTime = Number.isInteger(transaction.blockTime)
    ? new Date(transaction.blockTime * 1000).toISOString()
    : null;
  const programMetadataMissing = compareRequiredAccounts(programMetadataIdl);

  const checks = {
    programOwnerMatches: program.owner === LOADER,
    programIsExecutable: program.executable === true,
    programDataAddressMatches: derivedProgramData === EXPECTED.programData,
    programDataOwnerMatches: programData.owner === LOADER,
    programDataAccountLengthMatches:
      programData.data.length === RECEIPT.deployedRuntime.programDataAccountBytes,
    programDataSlotMatchesUpgrade: programDataSlot === EXPECTED.upgradeSlot,
    upgradeAuthorityMatches: upgradeAuthority === EXPECTED.upgradeAuthority,
    upgradeTransactionSucceeded: transaction.meta?.err === null,
    upgradeTransactionSlotMatches: transaction.slot === EXPECTED.upgradeSlot,
    upgradeTransactionTimeMatches: upgradeTransactionTime === EXPECTED.upgradeTime,
    upgradeTransactionLogMatches: transaction.meta?.logMessages?.some(
      (line) => line.includes(`Upgraded program ${EXPECTED.programId}`),
    ) === true,
    ...allocatedPayloadInvariant(allocatedBinary, {
      length: RECEIPT.deployedRuntime.allocatedBytes,
      sha256: RECEIPT.deployedRuntime.allocatedSha256,
    }),
    sourceArtifactPrefixLengthMatches:
      sourceArtifactPrefix.length === RECEIPT.deployedRuntime.sourceArtifactPrefixBytes,
    sourceArtifactPrefixSha256Matches:
      sha256(sourceArtifactPrefix) === RECEIPT.deployedRuntime.sourceArtifactPrefixSha256,
    allocationPaddingLengthMatches:
      allocationPadding.length === RECEIPT.deployedRuntime.allocationPaddingBytes,
    allocationPaddingIsAllZero: allocationPadding.every((byte) => byte === 0),
    allocationPaddingSha256Matches:
      sha256(allocationPadding) === RECEIPT.deployedRuntime.allocationPaddingSha256,
    trimmedBinaryLengthMatches: trimmedBinary.length === RECEIPT.deployedRuntime.trimmedBytes,
    trimmedBinarySha256Matches: sha256(trimmedBinary) === RECEIPT.deployedRuntime.trimmedSha256,
    programMetadataIdlOwnerMatches:
      programMetadataIdlAccount.owner === EXPECTED.programMetadataIdl.owner,
    programMetadataIdlAccountLengthMatches:
      programMetadataIdlAccount.data.length === EXPECTED.programMetadataIdl.accountBytes,
    programMetadataIdlAccountSha256Matches:
      sha256(programMetadataIdlAccount.data) === EXPECTED.programMetadataIdl.accountDataSha256,
    programMetadataIdlCanonicalJsonLengthMatches:
      Buffer.from(JSON.stringify(programMetadataIdl)).length
        === EXPECTED.programMetadataIdl.canonicalJsonBytes,
    programMetadataIdlCanonicalJsonSha256Matches:
      sha256(Buffer.from(JSON.stringify(programMetadataIdl)))
        === EXPECTED.programMetadataIdl.canonicalJsonSha256,
    programMetadataIdlInstructionCountMatches:
      instructionNames(programMetadataIdl).length === EXPECTED.programMetadataIdl.instructionCount,
    programMetadataIdlMissingAccountsMatch:
      equalJson(programMetadataMissing, EXPECTED.programMetadataIdl.missingRequiredFeeRoutingAccounts),
    legacyAnchorIdlAccountLengthMatches:
      legacyAnchorIdlAccount.data.length === EXPECTED.legacyAnchorIdl.accountBytes,
    legacyAnchorIdlInflatedLengthMatches:
      legacyAnchorIdlBytes.length === EXPECTED.legacyAnchorIdl.inflatedJsonBytes,
    legacyAnchorIdlSha256Matches:
      sha256(legacyAnchorIdlBytes) === EXPECTED.legacyAnchorIdl.inflatedSha256,
    legacyAnchorIdlInstructionCountMatches:
      instructionNames(legacyAnchorIdl).length === EXPECTED.legacyAnchorIdl.instructionCount,
  };
  const runtimeCheckNames = Object.keys(checks);

  const evidence = {
    label: 'escrow_v3_runtime_provenance_recert_ef7e4581_20260831',
    observedAt: new Date().toISOString(),
    expected: EXPECTED,
    checks,
    runtime: {
      programData: derivedProgramData,
      programDataSlot,
      upgradeAuthority,
      programDataAccountBytes: programData.data.length,
      allocatedBinaryLength: allocatedBinary.length,
      allocatedBinarySha256: sha256(allocatedBinary),
      sourceArtifactPrefixBytes: sourceArtifactPrefix.length,
      sourceArtifactPrefixSha256: sha256(sourceArtifactPrefix),
      allocationPaddingBytes: allocationPadding.length,
      allocationPaddingSha256: sha256(allocationPadding),
      trailingZeroBytes: allocatedBinary.length - trimmedBinary.length,
      trimmedBinaryLength: trimmedBinary.length,
      trimmedBinarySha256: sha256(trimmedBinary),
    },
    upgradeTransaction: {
      signature: EXPECTED.upgradeTransaction,
      slot: transaction.slot,
      blockTime: upgradeTransactionTime,
      succeeded: transaction.meta?.err === null,
    },
    publishedIdl: {
      programMetadata: {
        account: EXPECTED.programMetadataIdl.account,
        accountDataSha256: sha256(programMetadataIdlAccount.data),
        canonicalJsonSha256: sha256(Buffer.from(JSON.stringify(programMetadataIdl))),
        instructionNames: instructionNames(programMetadataIdl),
        missingRequiredFeeRoutingAccounts: programMetadataMissing,
      },
      legacyAnchor: {
        account: EXPECTED.legacyAnchorIdl.account,
        inflatedSha256: sha256(legacyAnchorIdlBytes),
        instructionNames: instructionNames(legacyAnchorIdl),
      },
    },
  };

  let sourceIdl;
  if (fullPacketProvided) {
    const artifact = fs.readFileSync(artifactPath);
    const source = fs.readFileSync(sourcePath);
    const sourceIdlBytes = fs.readFileSync(sourceIdlPath);
    sourceIdl = JSON.parse(sourceIdlBytes);
    const sourceRoot = path.resolve(path.dirname(sourcePath), '../../..');
    const inputPaths = {
      cargoLockSha256: path.join(sourceRoot, 'Cargo.lock'),
      programCargoTomlSha256: path.join(sourceRoot, 'programs/escrow_v3/Cargo.toml'),
      rustToolchainTomlSha256: path.join(sourceRoot, 'rust-toolchain.toml'),
      anchorTomlSha256: path.join(sourceRoot, 'Anchor.toml'),
    };
    for (const inputPath of Object.values(inputPaths)) {
      if (!fs.existsSync(inputPath)) throw new InputError(`build input is absent: ${inputPath}`);
    }

    checks.reproducibleBuildLengthMatches = artifact.length === RECEIPT.rebuild.bytes;
    checks.reproducibleBuildSha256Matches = sha256(artifact) === RECEIPT.rebuild.sha256;
    checks.reproducibleBuildMatchesAllocatedPrefix = artifact.equals(sourceArtifactPrefix);
    checks.sourceSha256Matches = sha256(source) === EXPECTED.sourceSha256;
    checks.sourceDeclaresMainnetProgram = source.includes(`declare_id!("${EXPECTED.programId}")`);
    checks.sourceCommitMatches = sourceCommit === EXPECTED.sourceCommit;
    checks.sourceIdlSha256Matches = sha256(sourceIdlBytes) === EXPECTED.sourceIdlSha256;
    checks.sourceIdlLengthMatches = sourceIdlBytes.length === RECEIPT.sourceIdl.bytes;
    checks.sourceIdlInstructionCountMatches =
      instructionNames(sourceIdl).length === RECEIPT.sourceIdl.instructionCount;
    for (const [hashField, inputPath] of Object.entries(inputPaths)) {
      checks[`${hashField}Matches`] = sha256(fs.readFileSync(inputPath))
        === RECEIPT.buildInputs[hashField];
    }

    const programMetadataMissingFromSource = compareRequiredAccounts(programMetadataIdl);
    const legacyMissingFromSource = instructionNames(sourceIdl)
      .filter((name) => !instructionNames(legacyAnchorIdl).includes(name));
    checks.sourceIdlMatchesProgramMetadataIdl =
      equalJson(instructionNames(sourceIdl), instructionNames(programMetadataIdl))
      && Object.values(programMetadataMissingFromSource).every((missing) => missing.length === 0);
    checks.sourceIdlMatchesLegacyAnchorIdl =
      equalJson(instructionNames(sourceIdl), instructionNames(legacyAnchorIdl));

    evidence.reproducibleBuild = {
      path: artifactPath,
      length: artifact.length,
      sha256: sha256(artifact),
      matchesAllocatedPrefix: checks.reproducibleBuildMatchesAllocatedPrefix,
    };
    evidence.source = { commit: sourceCommit, path: sourcePath, sha256: sha256(source) };
    evidence.sourceIdl = {
      path: sourceIdlPath,
      sha256: sha256(sourceIdlBytes),
      instructionNames: instructionNames(sourceIdl),
      programMetadataMissingRequiredAccounts: programMetadataMissingFromSource,
      missingFromLegacyAnchorIdl: legacyMissingFromSource,
    };
  }

  const runtimeVerified = runtimeCheckNames.every((name) => checks[name] === true);
  const sourcePacketVerified = fullPacketProvided && [
    'sourceSha256Matches',
    'sourceDeclaresMainnetProgram',
    'sourceCommitMatches',
    'sourceIdlSha256Matches',
    'sourceIdlLengthMatches',
    'sourceIdlInstructionCountMatches',
    'cargoLockSha256Matches',
    'programCargoTomlSha256Matches',
    'rustToolchainTomlSha256Matches',
    'anchorTomlSha256Matches',
  ].every((name) => checks[name] === true);
  const sourceBuildVerified = sourcePacketVerified
    && checks.reproducibleBuildLengthMatches === true
    && checks.reproducibleBuildSha256Matches === true
    && checks.reproducibleBuildMatchesAllocatedPrefix === true;
  const publishedIdlMatchesSource = sourceBuildVerified
    && checks.sourceIdlMatchesProgramMetadataIdl === true
    && checks.sourceIdlMatchesLegacyAnchorIdl === true;

  evidence.status = !runtimeVerified
    ? 'verification_failed'
    : !fullPacketProvided
      ? 'runtime_verified_published_idls_stale'
      : !sourcePacketVerified
        ? 'runtime_verified_source_packet_verification_failed'
        : !sourceBuildVerified
          ? 'runtime_verified_source_build_mismatch'
          : !publishedIdlMatchesSource
            ? 'runtime_and_source_build_verified_published_idl_mismatch'
            : 'source_deployed_idl_equal';
  evidence.fullPacketProvided = fullPacketProvided;
  evidence.runtimeVerified = runtimeVerified;
  evidence.sourcePacketVerified = sourcePacketVerified;
  evidence.sourceBuildVerified = sourceBuildVerified;
  evidence.publishedIdlMatchesSource = publishedIdlMatchesSource;

  console.log(JSON.stringify(evidence, null, 2));

  if (!runtimeVerified) process.exitCode = 1;
  if (fullPacketProvided && !sourcePacketVerified) process.exitCode = 1;
  if (process.argv.includes('--strict-source') && fullPacketProvided && !publishedIdlMatchesSource) {
    process.exitCode = 3;
  }
}

main().catch((error) => {
  const status = error instanceof InputError
    ? 'input_error'
    : error instanceof RpcInfrastructureError
      ? 'infrastructure_error'
      : 'verification_failed';
  console.error(JSON.stringify({
    label: 'escrow_v3_runtime_provenance_recert_ef7e4581_20260831',
    observedAt: new Date().toISOString(),
    status,
    error: { name: error.name, message: error.message },
  }, null, 2));
  process.exitCode = status === 'verification_failed' ? 1 : 2;
});
