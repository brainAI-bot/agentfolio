#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

import { allocatedPayloadInvariant } from './lib/allocated-payload-invariant.mjs';

const EXPECTED = Object.freeze({
  programId: 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C',
  programData: 'Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk',
  upgradeAuthority: 'Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc',
  upgradeTransaction: '3dKQibtuBon7f8dL9DSjsjCwLr1N9pw6pbgR1Kg69wTAnfwkA8RbKn4e7sqH39yhwwWEHkpWhhDxSG62DeBEsy1E',
  upgradeSlot: 440327121,
  upgradeTime: '2026-08-19T19:37:14.000Z',
  allocatedBinaryLength: 346856,
  allocatedBinarySha256: '53e922d8792d3ec2d447c497f37dfe8e4ffd1d9bde0f9d6edc0bb3578e67c17f',
  trimmedBinaryLength: 346841,
  trimmedBinarySha256: '88058f4322bb8cbb9227b6f35ae3c78baf2be9c01a3bd70523f803f9bfa7f078',
  publishedIdlAccount: 'D2TVCWarEDQ3w3YFMpackzymm9MGQKeWd1p1pCeZmBcn',
  publishedIdlInflatedSha256: '864e8af057c1b196156222ecda5853936bf4c6e0f3ae9f5c1e2ca2e53ed6c768',
  sourceCommit: '0bf088e5618f173dff7e0fba622bc2911212c52e',
  sourceSha256: 'f4696cc27c5e2ff6163a90f877fd4431efa8809d2f6ae4c792c3c7cd18193c4d',
  sourceIdlSha256: '3d7e7a14788449f65c1a187a96543f7677bf08937e61638734ed3886dcf60a5a',
});

const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const PROGRAMDATA_HEADER_LENGTH = 45;
const IDL_HEADER_LENGTH = 44;
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
    if (body.error) {
      throw new RpcInfrastructureError(`RPC ${method} failed: ${JSON.stringify(body.error)}`);
    }
    return body.result;
  }

  throw new RpcInfrastructureError(`RPC ${method} exhausted retries`);
}

async function account(address) {
  const result = await rpc('getAccountInfo', [address, { commitment: 'confirmed', encoding: 'base64' }]);
  if (!result.value) throw new Error(`account ${address} is absent`);
  return {
    ...result.value,
    data: Buffer.from(result.value.data[0], 'base64'),
  };
}

function instructionNames(idl) {
  return (idl.instructions || []).map((instruction) => instruction.name).sort();
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
  throw new InputError(
    '--artifact, --source, --source-idl, and --source-commit must be supplied together',
  );
}
for (const packetPath of [artifactPath, sourcePath, sourceIdlPath].filter(Boolean)) {
  if (!fs.existsSync(packetPath)) throw new InputError(`packet file is absent: ${packetPath}`);
}

const program = await account(EXPECTED.programId);
const programData = await account(EXPECTED.programData);
const publishedIdlAccount = await account(EXPECTED.publishedIdlAccount);
const transaction = await rpc('getTransaction', [
  EXPECTED.upgradeTransaction,
  { commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
]);
if (!transaction) throw new Error(`upgrade transaction ${EXPECTED.upgradeTransaction} is absent`);

const derivedProgramData = encodeBase58(program.data.subarray(4, 36));
const programDataSlot = Number(programData.data.readBigUInt64LE(4));
const upgradeAuthority = encodeBase58(programData.data.subarray(13, 45));
const allocatedBinary = programData.data.subarray(PROGRAMDATA_HEADER_LENGTH);
const trimmedBinary = trimTrailingZeroes(allocatedBinary);
const allocatedPayloadChecks = allocatedPayloadInvariant(allocatedBinary, {
  length: EXPECTED.allocatedBinaryLength,
  sha256: EXPECTED.allocatedBinarySha256,
});
const inflatedIdlBytes = zlib.inflateSync(publishedIdlAccount.data.subarray(IDL_HEADER_LENGTH));
const publishedIdl = JSON.parse(inflatedIdlBytes);
const upgradeTransactionTime = Number.isInteger(transaction.blockTime)
  ? new Date(transaction.blockTime * 1000).toISOString()
  : null;

const checks = {
  programOwnerMatches: program.owner === LOADER,
  programIsExecutable: program.executable === true,
  programDataAddressMatches: derivedProgramData === EXPECTED.programData,
  programDataOwnerMatches: programData.owner === LOADER,
  programDataSlotMatchesUpgrade: programDataSlot === EXPECTED.upgradeSlot,
  upgradeAuthorityMatches: upgradeAuthority === EXPECTED.upgradeAuthority,
  upgradeTransactionSucceeded: transaction.meta?.err === null,
  upgradeTransactionSlotMatches: transaction.slot === EXPECTED.upgradeSlot,
  upgradeTransactionTimeMatches: upgradeTransactionTime === EXPECTED.upgradeTime,
  upgradeTransactionLogMatches: transaction.meta?.logMessages?.some(
    (line) => line.includes(`Upgraded program ${EXPECTED.programId}`),
  ) === true,
  ...allocatedPayloadChecks,
  trimmedBinaryLengthMatches: trimmedBinary.length === EXPECTED.trimmedBinaryLength,
  trimmedBinarySha256Matches: sha256(trimmedBinary) === EXPECTED.trimmedBinarySha256,
  publishedIdlAddressMatches: publishedIdl.address === EXPECTED.programId,
  publishedIdlHashMatches: sha256(inflatedIdlBytes) === EXPECTED.publishedIdlInflatedSha256,
};
const runtimeCheckNames = Object.keys(checks);

const evidence = {
  label: 'escrow_v3_runtime_recert_ef7e4581',
  observedAt: new Date().toISOString(),
  expected: EXPECTED,
  checks,
  runtime: {
    programOwner: program.owner,
    programExecutable: program.executable,
    programData: derivedProgramData,
    programDataOwner: programData.owner,
    programDataSlot,
    upgradeAuthority,
    allocatedBinaryLength: allocatedBinary.length,
    allocatedBinarySha256: sha256(allocatedBinary),
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
    account: EXPECTED.publishedIdlAccount,
    inflatedLength: inflatedIdlBytes.length,
    inflatedSha256: sha256(inflatedIdlBytes),
    instructionNames: instructionNames(publishedIdl),
  },
};

if (artifactPath) {
  const artifact = fs.readFileSync(artifactPath);
  const trimmedArtifact = trimTrailingZeroes(artifact);
  checks.reproducibleBuildMatchesAllocatedBinary = artifact.equals(allocatedBinary);
  checks.reproducibleBuildMatchesTrimmedBinary = trimmedArtifact.equals(trimmedBinary);
  checks.reproducibleBuildMatchesDeployedBinary =
    checks.reproducibleBuildMatchesAllocatedBinary
    || checks.reproducibleBuildMatchesTrimmedBinary;
  evidence.reproducibleBuild = {
    path: artifactPath,
    length: artifact.length,
    sha256: sha256(artifact),
    trailingZeroBytes: artifact.length - trimmedArtifact.length,
    trimmedLength: trimmedArtifact.length,
    trimmedSha256: sha256(trimmedArtifact),
    matchesAllocatedBinary: checks.reproducibleBuildMatchesAllocatedBinary,
    matchesTrimmedBinary: checks.reproducibleBuildMatchesTrimmedBinary,
  };
}

if (sourcePath) {
  const source = fs.readFileSync(sourcePath);
  checks.sourceSha256Matches = sha256(source) === EXPECTED.sourceSha256;
  checks.sourceDeclaresMainnetProgram = source.includes(
    `declare_id!("${EXPECTED.programId}")`,
  );
  evidence.source = {
    commit: sourceCommit,
    path: sourcePath,
    sha256: sha256(source),
  };
  checks.sourceCommitMatches = evidence.source.commit === EXPECTED.sourceCommit;
}

if (sourceIdlPath) {
  const sourceIdlBytes = fs.readFileSync(sourceIdlPath);
  const sourceIdl = JSON.parse(sourceIdlBytes);
  const sourceNames = instructionNames(sourceIdl);
  const publishedNames = instructionNames(publishedIdl);
  checks.sourceIdlSha256Matches = sha256(sourceIdlBytes) === EXPECTED.sourceIdlSha256;
  checks.sourceIdlMatchesPublishedIdl = equalJson(sourceNames, publishedNames);
  evidence.sourceIdl = {
    path: sourceIdlPath,
    sha256: sha256(sourceIdlBytes),
    instructionNames: sourceNames,
    missingFromPublishedIdl: sourceNames.filter((name) => !publishedNames.includes(name)),
    extraInPublishedIdl: publishedNames.filter((name) => !sourceNames.includes(name)),
  };
}

const runtimeVerified = runtimeCheckNames.every((name) => checks[name] === true);
const sourcePacketVerified = fullPacketProvided && [
  'sourceSha256Matches',
  'sourceDeclaresMainnetProgram',
  'sourceCommitMatches',
  'sourceIdlSha256Matches',
].every((name) => checks[name] === true);
const sourceBuildVerified = sourcePacketVerified
  && checks.reproducibleBuildMatchesDeployedBinary === true;
const sourceDeployedIdlEqual = sourceBuildVerified && checks.sourceIdlMatchesPublishedIdl === true;
evidence.status = !runtimeVerified
  ? 'verification_failed'
  : !fullPacketProvided
    ? 'runtime_verified'
    : !sourcePacketVerified
      ? 'runtime_verified_source_packet_verification_failed'
      : !sourceBuildVerified
        ? 'runtime_verified_source_build_mismatch'
        : !sourceDeployedIdlEqual
          ? 'runtime_and_source_build_verified_published_idl_mismatch'
          : 'source_deployed_idl_equal';
evidence.fullPacketProvided = fullPacketProvided;
evidence.runtimeVerified = runtimeVerified;
evidence.sourcePacketVerified = sourcePacketVerified;
evidence.sourceBuildVerified = sourceBuildVerified;
evidence.sourceDeployedIdlEqual = sourceDeployedIdlEqual;

console.log(JSON.stringify(evidence, null, 2));

if (!runtimeVerified) process.exitCode = 1;
if (fullPacketProvided && !sourcePacketVerified) process.exitCode = 1;
if (process.argv.includes('--strict-source') && fullPacketProvided && !sourceDeployedIdlEqual) {
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
    label: 'escrow_v3_runtime_recert_ef7e4581',
    observedAt: new Date().toISOString(),
    status,
    error: {
      name: error.name,
      message: error.message,
    },
  }, null, 2));
  process.exitCode = status === 'verification_failed' ? 1 : 2;
});
