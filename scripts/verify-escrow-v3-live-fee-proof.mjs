#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PROGRAM_ID = 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C';
const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const CERTIFIED_UPGRADE_SLOT = 441423817;
const PLATFORM_FEE_BPS = 500n;
const BPS_DENOMINATOR = 10_000n;
const MIN_GROSS_FOR_NON_ZERO_FEE = (BPS_DENOMINATOR + PLATFORM_FEE_BPS - 1n)
  / PLATFORM_FEE_BPS;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const RPC_ATTEMPTS = 4;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const CERTIFIED_IDL_PATH = new URL(
  '../third_party/satp/93fc6c0d/idls/v3/escrow_v3.json',
  import.meta.url,
);

class RpcInfrastructureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RpcInfrastructureError';
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function rpc(method, params) {
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      });
    } catch (error) {
      if (attempt < RPC_ATTEMPTS) {
        await sleep(500 * (2 ** (attempt - 1)));
        continue;
      }
      throw new RpcInfrastructureError(
        `RPC ${method} network failure after ${attempt} attempts: ${error.message}`,
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < RPC_ATTEMPTS) {
        await sleep(500 * (2 ** (attempt - 1)));
        continue;
      }
      throw new RpcInfrastructureError(
        `RPC ${method} returned HTTP ${response.status} after ${attempt} attempts`,
      );
    }

    const body = await response.json().catch((error) => {
      throw new RpcInfrastructureError(`RPC ${method} returned invalid JSON: ${error.message}`);
    });
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

function decodeBase58(value) {
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit === -1) throw new Error(`invalid base58 character: ${character}`);
    decoded = (decoded * 58n) + BigInt(digit);
  }
  let hex = decoded.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  const body = hex === '00' ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  const leadingZeroes = value.match(/^1*/)?.[0].length || 0;
  return Buffer.concat([Buffer.alloc(leadingZeroes), body]);
}

function discriminator(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

const INSTRUCTION_NAMES = [
  'cancel',
  'cancel_usdc',
  'close_escrow',
  'create_escrow',
  'create_usdc_escrow',
  'extend_deadline',
  'partial_release',
  'partial_release_usdc',
  'raise_dispute',
  'release',
  'release_usdc',
  'resolve_dispute',
  'resolve_dispute_usdc',
  'submit_work',
];
const KNOWN_INSTRUCTIONS = new Map(INSTRUCTION_NAMES.map((name) => [
  discriminator(name).toString('hex'),
  name,
]));
const ROUTES = new Set(['release', 'partial_release']);

function feeRouteInterface(idl) {
  const expectedAccounts = ['escrow', 'client', 'agent', 'treasury'];
  const routes = Object.fromEntries([...ROUTES].map((route) => {
    const instruction = (idl.instructions || []).find((entry) => entry.name === route);
    const accounts = (instruction?.accounts || []).map((account) => account.name);
    return [route, {
      accounts,
      treasuryAccountPresent: accounts.includes('treasury'),
      expectedAccountsMatch: JSON.stringify(accounts) === JSON.stringify(expectedAccounts),
    }];
  }));
  return {
    expectedAccounts,
    routes,
    feeRoutingSupported: Object.values(routes).every((route) => route.expectedAccountsMatch),
  };
}

function accountKeys(transaction) {
  const messageKeys = transaction.transaction.message.accountKeys.map((entry) => (
    typeof entry === 'string' ? entry : entry.pubkey
  ));
  const loaded = transaction.meta?.loadedAddresses || {};
  return [...messageKeys, ...(loaded.writable || []), ...(loaded.readonly || [])];
}

function compiledInstructions(transaction) {
  const topLevel = transaction.transaction.message.instructions || [];
  const inner = (transaction.meta?.innerInstructions || []).flatMap((entry) => entry.instructions || []);
  return [...topLevel, ...inner];
}

function balanceDelta(transaction, index) {
  const pre = BigInt(transaction.meta.preBalances[index]);
  const post = BigInt(transaction.meta.postBalances[index]);
  return { pre: pre.toString(), post: post.toString(), delta: (post - pre).toString() };
}

function parseExpectedReleaseGross(args) {
  const expectedBySignature = new Map();
  for (const arg of args) {
    if (!arg.startsWith('--expected-release-gross=')) continue;
    const binding = arg.slice('--expected-release-gross='.length);
    const separator = binding.lastIndexOf(':');
    if (separator <= 0 || separator === binding.length - 1) {
      throw new Error('--expected-release-gross must be SIGNATURE:LAMPORTS');
    }
    const signature = binding.slice(0, separator);
    const lamports = binding.slice(separator + 1);
    if (!/^[1-9][0-9]*$/.test(lamports)) {
      throw new Error('expected release gross must be a positive integer lamport amount');
    }
    if (expectedBySignature.has(signature)) {
      throw new Error(`duplicate expected release gross binding for ${signature}`);
    }
    expectedBySignature.set(signature, BigInt(lamports));
  }
  return expectedBySignature;
}

async function getAllSignatures() {
  const signatures = [];
  let before;
  while (true) {
    const options = { commitment: 'finalized', limit: 1_000 };
    if (before) options.before = before;
    const page = await rpc('getSignaturesForAddress', [PROGRAM_ID, options]);
    if (!Array.isArray(page)) {
      throw new RpcInfrastructureError('RPC getSignaturesForAddress returned a non-array result');
    }
    signatures.push(...page);
    if (page.length < 1_000) return signatures;
    before = page.at(-1)?.signature;
    if (!before) {
      throw new RpcInfrastructureError('RPC signature page was full but had no pagination cursor');
    }
  }
}

function analyzeInstruction(
  signatureRecord,
  transaction,
  instruction,
  expectedReleaseGrossLamports = null,
) {
  const keys = accountKeys(transaction);
  if (keys[instruction.programIdIndex] !== PROGRAM_ID) return null;

  const data = decodeBase58(instruction.data || '');
  const route = KNOWN_INSTRUCTIONS.get(data.subarray(0, 8).toString('hex'));
  if (!ROUTES.has(route)) return null;
  if (!Array.isArray(instruction.accounts) || instruction.accounts.length < 4) {
    return {
      route,
      signature: signatureRecord.signature,
      slot: signatureRecord.slot,
      blockTime: Number.isInteger(signatureRecord.blockTime)
        ? new Date(signatureRecord.blockTime * 1000).toISOString()
        : null,
      instructionAccounts: Array.isArray(instruction.accounts)
        ? instruction.accounts.map((index) => keys[index])
        : [],
      structuralGap: 'certified route does not pass a writable treasury account',
      proofPassed: false,
    };
  }

  const [escrowIndex, clientIndex, agentIndex, treasuryIndex] = instruction.accounts;
  const grossAmount = route === 'partial_release'
    ? data.length >= 16 ? data.readBigUInt64LE(8) : null
    : expectedReleaseGrossLamports === null
      ? null
      : BigInt(expectedReleaseGrossLamports);
  const escrow = balanceDelta(transaction, escrowIndex);
  const agent = balanceDelta(transaction, agentIndex);
  const treasury = balanceDelta(transaction, treasuryIndex);
  const expectedTreasuryDelta = grossAmount === null
    ? null
    : (grossAmount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
  const expectedAgentDelta = grossAmount === null ? null : grossAmount - expectedTreasuryDelta;

  const checks = {
    transactionSucceeded: transaction.meta.err === null,
    certifiedRuntimeWasActive: signatureRecord.slot >= CERTIFIED_UPGRADE_SLOT,
    treasuryAccountMatches: keys[treasuryIndex] === TREASURY,
    grossBoundToIndependentSource: grossAmount !== null,
    grossMeetsNonZeroFeeMinimum: grossAmount !== null
      && grossAmount >= MIN_GROSS_FOR_NON_ZERO_FEE,
    treasuryDeltaPositive: BigInt(treasury.delta) > 0n,
    escrowRemainedOpenWithoutRentClosure: BigInt(escrow.post) > 0n,
    escrowRawDeltaMatchesGross: grossAmount !== null && BigInt(escrow.delta) === -grossAmount,
    treasuryDeltaMatchesFee: expectedTreasuryDelta !== null
      && BigInt(treasury.delta) === expectedTreasuryDelta,
    agentDeltaMatchesNet: expectedAgentDelta !== null
      && BigInt(agent.delta) === expectedAgentDelta,
  };

  return {
    route,
    signature: signatureRecord.signature,
    slot: signatureRecord.slot,
    blockTime: Number.isInteger(signatureRecord.blockTime)
      ? new Date(signatureRecord.blockTime * 1000).toISOString()
      : null,
    accounts: {
      escrow: keys[escrowIndex],
      client: keys[clientIndex],
      agent: keys[agentIndex],
      treasury: keys[treasuryIndex],
    },
    grossSource: route === 'partial_release'
      ? 'instruction_data'
      : expectedReleaseGrossLamports === null
        ? 'missing_owner_approved_binding'
        : 'owner_approved_signature_binding',
    grossAmountLamports: grossAmount?.toString() ?? null,
    expectedAgentDeltaLamports: expectedAgentDelta?.toString() ?? null,
    expectedTreasuryDeltaLamports: expectedTreasuryDelta?.toString() ?? null,
    balances: { escrow, agent, treasury },
    checks,
    proofPassed: Object.values(checks).every(Boolean),
  };
}

async function main() {
  const includePreUpgrade = process.argv.includes('--include-pre-upgrade');
  const summaryOnly = process.argv.includes('--summary-only');
  const certifiedIdlBytes = fs.readFileSync(CERTIFIED_IDL_PATH);
  const certifiedIdl = JSON.parse(certifiedIdlBytes);
  const certifiedInterface = feeRouteInterface(certifiedIdl);
  const expectedReleaseGrossBySignature = parseExpectedReleaseGross(process.argv.slice(2));
  const signatures = await getAllSignatures();
  const successfulSignatures = signatures.filter((record) => record.err === null);
  const relevantSignatures = includePreUpgrade
    ? successfulSignatures
    : successfulSignatures.filter((record) => record.slot >= CERTIFIED_UPGRADE_SLOT);
  const routeTransactions = [];
  const scannedTransactions = [];

  for (const signatureRecord of relevantSignatures) {
    const transaction = await rpc('getTransaction', [
      signatureRecord.signature,
      { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 0 },
    ]);
    if (!transaction) continue;
    const matchingRoutes = [];
    const matchingProgramInstructions = [];
    let programInstructionCount = 0;
    for (const instruction of compiledInstructions(transaction)) {
      const keys = accountKeys(transaction);
      if (keys[instruction.programIdIndex] === PROGRAM_ID) {
        programInstructionCount += 1;
        const data = decodeBase58(instruction.data || '');
        const instructionDiscriminator = data.subarray(0, 8).toString('hex');
        matchingProgramInstructions.push(
          KNOWN_INSTRUCTIONS.get(instructionDiscriminator) || `unknown:${instructionDiscriminator}`,
        );
      }
      const result = analyzeInstruction(
        signatureRecord,
        transaction,
        instruction,
        expectedReleaseGrossBySignature.get(signatureRecord.signature) ?? null,
      );
      if (result) {
        routeTransactions.push(result);
        matchingRoutes.push(result.route);
      }
    }
    scannedTransactions.push({
      signature: signatureRecord.signature,
      slot: signatureRecord.slot,
      blockTime: Number.isInteger(signatureRecord.blockTime)
        ? new Date(signatureRecord.blockTime * 1000).toISOString()
        : null,
      programInstructionCount,
      matchingProgramInstructions,
      matchingRoutes,
    });
    if (includePreUpgrade) await sleep(500);
  }

  const routeSummary = Object.fromEntries(['release', 'partial_release'].map((route) => {
    const candidates = routeTransactions.filter((entry) => entry.route === route);
    const certifiedRuntimeProofs = candidates.filter((entry) => entry.proofPassed);
    const routeInterface = certifiedInterface.routes[route];
    return [route, {
      certifiedInstructionAccounts: routeInterface.accounts,
      certifiedTreasuryAccountPresent: routeInterface.treasuryAccountPresent,
      matchingSuccessfulTransactions: candidates.length,
      certifiedRuntimeProofTransactions: certifiedRuntimeProofs.length,
      status: !routeInterface.expectedAccountsMatch
        ? 'certified_runtime_lacks_treasury_account'
        : certifiedRuntimeProofs.length > 0 ? 'verified' : 'owner_action_required',
    }];
  }));
  const proofSatisfied = Object.values(routeSummary).every((route) => route.status === 'verified');

  console.log(JSON.stringify({
    label: 'escrow_v3_live_fee_routing_proof_011685d4',
    observedAt: new Date().toISOString(),
    rpcUrl: RPC_URL === 'https://api.mainnet-beta.solana.com' ? RPC_URL : 'configured SOLANA_RPC_URL',
    programId: PROGRAM_ID,
    treasury: TREASURY,
    certifiedUpgradeSlot: CERTIFIED_UPGRADE_SLOT,
    certifiedIdl: {
      path: 'third_party/satp/93fc6c0d/idls/v3/escrow_v3.json',
      sha256: crypto.createHash('sha256').update(certifiedIdlBytes).digest('hex'),
      ...certifiedInterface,
    },
    scannedSignatures: signatures.length,
    scannedSuccessfulTransactions: successfulSignatures.length,
    scannedPostUpgradeSuccessfulTransactions: successfulSignatures.filter(
      (record) => record.slot >= CERTIFIED_UPGRADE_SLOT,
    ).length,
    includedPreUpgradeTransactions: includePreUpgrade,
    expectedReleaseGrossBindings: Object.fromEntries(
      [...expectedReleaseGrossBySignature].map(([signature, lamports]) => [
        signature,
        lamports.toString(),
      ]),
    ),
    scannedTransactions: summaryOnly ? undefined : scannedTransactions,
    routeSummary,
    routeTransactions,
    proofSatisfied,
    ownerAction: proofSatisfied ? null : {
      action: certifiedInterface.feeRoutingSupported
        ? 'Authorize and submit one bounded mainnet validation transaction per route, each with gross >= 20 lamports; bind the finalized release signature to its independently approved gross with --expected-release-gross, then rerun this read-only verifier.'
        : 'Approve a separate audited mainnet change-control packet that deploys fee-routing release and partial_release instructions with a writable treasury account and then executes one bounded validation transaction for each route; this task does not perform that upgrade or money movement.',
      prohibitedHere: 'This verifier never signs or submits a transaction and this task does not authorize money movement.',
    },
  }, null, 2));

  if (!proofSatisfied) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = error instanceof RpcInfrastructureError ? 1 : 2;
  });
}

export {
  analyzeInstruction,
  decodeBase58,
  feeRouteInterface,
  parseExpectedReleaseGross,
};
