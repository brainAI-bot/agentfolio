#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';

const RECEIPT = JSON.parse(fs.readFileSync(
  new URL('../config/escrow-v3-provenance-ef7e4581.json', import.meta.url),
  'utf8',
));

const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const PROGRAMDATA_HEADER_LENGTH = 45;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const RPC_ATTEMPTS = 4;

export class RpcInfrastructureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RpcInfrastructureError';
  }
}

export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function encodeBase58(bytes) {
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function rpc(method, params) {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      });
    } catch (error) {
      if (attempt < RPC_ATTEMPTS) {
        await sleep(250 * (2 ** (attempt - 1)));
        continue;
      }
      throw new RpcInfrastructureError(`RPC ${method} network failure after ${attempt} attempts: ${error.message}`);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < RPC_ATTEMPTS) {
        await sleep(250 * (2 ** (attempt - 1)));
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
    if (body.error) throw new RpcInfrastructureError(`RPC ${method} failed: ${JSON.stringify(body.error)}`);
    return body.result;
  }
  throw new RpcInfrastructureError(`RPC ${method} exhausted retries`);
}

async function account(address) {
  const result = await rpc('getAccountInfo', [address, { commitment: 'finalized', encoding: 'base64' }]);
  if (!result?.value) throw new Error(`account ${address} is absent`);
  return { ...result.value, data: Buffer.from(result.value.data[0], 'base64') };
}

export function verifyDeployment({ program, programData, expected }) {
  if (program.data.length < 36) throw new Error('program account data is shorter than the upgradeable-loader header');
  if (programData.data.length < PROGRAMDATA_HEADER_LENGTH) {
    throw new Error('ProgramData account data is shorter than the upgradeable-loader header');
  }

  const derivedProgramData = encodeBase58(program.data.subarray(4, 36));
  const observedSlot = Number(programData.data.readBigUInt64LE(4));
  const observedAuthority = encodeBase58(programData.data.subarray(13, 45));
  const deployedBytecode = programData.data.subarray(PROGRAMDATA_HEADER_LENGTH);
  const deployedBytecodeSha256 = sha256(deployedBytecode);

  const checks = {
    programOwnerMatches: program.owner === LOADER,
    programIsExecutable: program.executable === true,
    programDataAddressMatches: derivedProgramData === expected.programData,
    programDataOwnerMatches: programData.owner === LOADER,
    programDataSlotMatches: observedSlot === expected.upgradeSlot,
    upgradeAuthorityMatches: observedAuthority === expected.upgradeAuthority,
    deployedBytecodeLengthMatches: deployedBytecode.length === expected.allocatedBytes,
    deployedBytecodeSha256Matches: deployedBytecodeSha256 === expected.allocatedSha256,
  };

  return {
    checks,
    verified: Object.values(checks).every(Boolean),
    observed: {
      programData: derivedProgramData,
      slot: observedSlot,
      upgradeAuthority: observedAuthority,
      deployedBytecodeBytes: deployedBytecode.length,
      deployedBytecodeSha256,
    },
  };
}

export async function main() {
  const expected = {
    programId: RECEIPT.program.programId,
    programData: RECEIPT.program.programData,
    upgradeSlot: RECEIPT.program.upgradeSlot,
    upgradeAuthority: RECEIPT.program.upgradeAuthority,
    allocatedBytes: RECEIPT.deployedRuntime.allocatedBytes,
    allocatedSha256: RECEIPT.deployedRuntime.allocatedSha256,
  };
  const [genesisHash, program, programData] = await Promise.all([
    rpc('getGenesisHash', []),
    account(expected.programId),
    account(expected.programData),
  ]);
  const result = verifyDeployment({ program, programData, expected });
  result.checks.genesisHashMatches = genesisHash === MAINNET_GENESIS_HASH;
  result.verified = Object.values(result.checks).every(Boolean);
  const evidence = {
    label: 'escrow_v3_deployed_bytecode_provenance',
    observedAt: new Date().toISOString(),
    cluster: RECEIPT.program.cluster,
    genesisHash,
    expectedGenesisHash: MAINNET_GENESIS_HASH,
    programId: expected.programId,
    expected: {
      programData: expected.programData,
      upgradeSlot: expected.upgradeSlot,
      upgradeAuthority: expected.upgradeAuthority,
      deployedBytecodeBytes: expected.allocatedBytes,
      deployedBytecodeSha256: expected.allocatedSha256,
    },
    status: result.verified ? 'verified' : 'blocked_deployed_bytecode_mismatch',
    checks: result.checks,
    observed: result.observed,
    readOnly: true,
  };

  console.log(JSON.stringify(evidence, null, 2));
  if (process.argv.includes('--strict') && !result.verified) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    const infrastructure = error instanceof RpcInfrastructureError;
    console.error(JSON.stringify({
      label: 'escrow_v3_deployed_bytecode_provenance',
      observedAt: new Date().toISOString(),
      status: infrastructure ? 'infrastructure_error' : 'verification_failed',
      error: { name: error.name, message: error.message },
      readOnly: true,
    }, null, 2));
    process.exitCode = infrastructure ? 2 : 1;
  });
}
