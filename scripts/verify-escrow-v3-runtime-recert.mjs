#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

const EXPECTED = Object.freeze({
  programId: 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C',
  programData: 'Fg1DJyKX9CngiMihZxJY2zjaQ8T1PK5QuiVhNvJmeTqk',
  upgradeAuthority: 'Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc',
  upgradeTransaction: '3dKQibtuBon7f8dL9DSjsjCwLr1N9pw6pbgR1Kg69wTAnfwkA8RbKn4e7sqH39yhwwWEHkpWhhDxSG62DeBEsy1E',
  upgradeSlot: 440327121,
  upgradeTime: '2026-08-19T19:37:14.000Z',
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

async function rpc(method, params) {
  const response = await fetch(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  });
  if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC ${method} failed: ${JSON.stringify(body.error)}`);
  return body.result;
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
const inflatedIdlBytes = zlib.inflateSync(publishedIdlAccount.data.subarray(IDL_HEADER_LENGTH));
const publishedIdl = JSON.parse(inflatedIdlBytes);

const checks = {
  programOwnerMatches: program.owner === LOADER,
  programIsExecutable: program.executable === true,
  programDataAddressMatches: derivedProgramData === EXPECTED.programData,
  programDataOwnerMatches: programData.owner === LOADER,
  programDataSlotMatchesUpgrade: programDataSlot === EXPECTED.upgradeSlot,
  upgradeAuthorityMatches: upgradeAuthority === EXPECTED.upgradeAuthority,
  upgradeTransactionSucceeded: transaction.meta?.err === null,
  upgradeTransactionSlotMatches: transaction.slot === EXPECTED.upgradeSlot,
  upgradeTransactionTimeMatches:
    new Date(transaction.blockTime * 1000).toISOString() === EXPECTED.upgradeTime,
  upgradeTransactionLogMatches: transaction.meta?.logMessages?.some(
    (line) => line.includes(`Upgraded program ${EXPECTED.programId}`),
  ) === true,
  trimmedBinaryLengthMatches: trimmedBinary.length === EXPECTED.trimmedBinaryLength,
  trimmedBinarySha256Matches: sha256(trimmedBinary) === EXPECTED.trimmedBinarySha256,
  publishedIdlAddressMatches: publishedIdl.address === EXPECTED.programId,
  publishedIdlHashMatches: sha256(inflatedIdlBytes) === EXPECTED.publishedIdlInflatedSha256,
};

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
    trailingPaddingBytes: allocatedBinary.length - trimmedBinary.length,
    trimmedBinaryLength: trimmedBinary.length,
    trimmedBinarySha256: sha256(trimmedBinary),
  },
  upgradeTransaction: {
    signature: EXPECTED.upgradeTransaction,
    slot: transaction.slot,
    blockTime: new Date(transaction.blockTime * 1000).toISOString(),
    succeeded: transaction.meta?.err === null,
  },
  publishedIdl: {
    account: EXPECTED.publishedIdlAccount,
    inflatedLength: inflatedIdlBytes.length,
    inflatedSha256: sha256(inflatedIdlBytes),
    instructionNames: instructionNames(publishedIdl),
  },
};

const artifactPath = arg('--artifact');
if (artifactPath) {
  const artifact = fs.readFileSync(artifactPath);
  checks.reproducibleBuildMatchesAllocatedBinary = artifact.equals(allocatedBinary);
  checks.reproducibleBuildMatchesTrimmedBinary = artifact.equals(trimmedBinary);
  checks.reproducibleBuildMatchesDeployedBinary =
    checks.reproducibleBuildMatchesAllocatedBinary
    || checks.reproducibleBuildMatchesTrimmedBinary;
  evidence.reproducibleBuild = {
    path: artifactPath,
    length: artifact.length,
    sha256: sha256(artifact),
    matchesAllocatedBinary: checks.reproducibleBuildMatchesAllocatedBinary,
    matchesTrimmedBinary: checks.reproducibleBuildMatchesTrimmedBinary,
  };
}

const sourcePath = arg('--source');
if (sourcePath) {
  const source = fs.readFileSync(sourcePath);
  checks.sourceSha256Matches = sha256(source) === EXPECTED.sourceSha256;
  checks.sourceDeclaresMainnetProgram = source.includes(
    `declare_id!("${EXPECTED.programId}")`,
  );
  evidence.source = {
    commit: arg('--source-commit'),
    path: sourcePath,
    sha256: sha256(source),
  };
  checks.sourceCommitMatches = evidence.source.commit === EXPECTED.sourceCommit;
}

const sourceIdlPath = arg('--source-idl');
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

const fullPacketProvided = Boolean(artifactPath && sourcePath && sourceIdlPath && arg('--source-commit'));
const runtimeVerified = Object.entries(checks)
  .filter(([name]) => ![
    'reproducibleBuildMatchesAllocatedBinary',
    'reproducibleBuildMatchesTrimmedBinary',
    'sourceIdlMatchesPublishedIdl',
  ].includes(name))
  .every(([, value]) => value === true);
const sourceBuildVerified = fullPacketProvided && runtimeVerified;
const sourceDeployedIdlEqual = sourceBuildVerified && checks.sourceIdlMatchesPublishedIdl === true;
evidence.status = sourceDeployedIdlEqual
  ? 'source_deployed_idl_equal'
  : sourceBuildVerified
    ? 'runtime_and_source_build_verified_published_idl_mismatch'
    : runtimeVerified
      ? 'runtime_verified_full_source_packet_not_supplied'
      : 'verification_failed';
evidence.fullPacketProvided = fullPacketProvided;
evidence.runtimeVerified = runtimeVerified;
evidence.sourceBuildVerified = sourceBuildVerified;
evidence.sourceDeployedIdlEqual = sourceDeployedIdlEqual;

console.log(JSON.stringify(evidence, null, 2));

if (!runtimeVerified) process.exitCode = 1;
