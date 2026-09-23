'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('node:crypto');
const bs58Module = require('bs58');
const satpClient = require('@brainai/satp-client');

const bs58 = bs58Module.default || bs58Module;
const ESCROW_V3_ACCOUNT_DISCRIMINATOR = Buffer.from([145, 108, 37, 52, 197, 162, 232, 59]);
const READBACK_ERROR_CODE = 'ESCROW_ONCHAIN_READBACK_FAILED';
const STAGED_READBACK_SOURCE = 'server_staged_escrow_readback';
const CREATE_ESCROW_DISCRIMINATORS = [
  'create_escrow',
  'create_usdc_escrow',
].map((name) => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8));

class EscrowOnChainReadbackError extends Error {
  constructor(message, statusCode = 422, reason = 'unverified') {
    super(message);
    this.name = 'EscrowOnChainReadbackError';
    this.code = READBACK_ERROR_CODE;
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

function normalizeNetwork(value) {
  return String(value || '').toLowerCase().includes('devnet') ? 'devnet' : 'mainnet';
}

function rpcUrlForNetwork(network, env = process.env) {
  if (env.SOLANA_RPC_URL) return env.SOLANA_RPC_URL;
  return network === 'devnet'
    ? 'https://api.devnet.solana.com'
    : 'https://api.mainnet-beta.solana.com';
}

function escrowProgramIdForNetwork(network, getV3ProgramIds = satpClient.getV3ProgramIds) {
  if (typeof getV3ProgramIds !== 'function') {
    throw new EscrowOnChainReadbackError('SATP V3 program IDs are unavailable', 503, 'program_ids_unavailable');
  }

  let ids;
  try {
    ids = getV3ProgramIds(network);
  } catch (error) {
    throw new EscrowOnChainReadbackError(error.message, 503, 'program_ids_unavailable');
  }

  const value = ids?.ESCROW || ids?.escrow || ids?.ESCROW_V3 || ids?.escrowV3;
  if (!value) {
    throw new EscrowOnChainReadbackError(
      `SATP V3 escrow program ID is not configured for ${network}`,
      503,
      'program_ids_unavailable',
    );
  }
  return new PublicKey(value);
}

function publicKeyString(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.toBase58 === 'function') return value.toBase58();
  return new PublicKey(value).toBase58();
}

function transactionAccountKeys(transactionReadback) {
  const message = transactionReadback?.transaction?.message;
  const staticKeys = message?.staticAccountKeys || message?.accountKeys || [];
  const loaded = transactionReadback?.meta?.loadedAddresses || {};
  return [
    ...staticKeys,
    ...(loaded.writable || []),
    ...(loaded.readonly || []),
  ].map(publicKeyString);
}

function instructionDataBuffer(instruction) {
  if (Buffer.isBuffer(instruction?.data) || instruction?.data instanceof Uint8Array) {
    return Buffer.from(instruction.data);
  }
  if (typeof instruction?.data === 'string') {
    try { return Buffer.from(bs58.decode(instruction.data)); } catch (_) { return Buffer.alloc(0); }
  }
  return Buffer.alloc(0);
}

function transactionCreatesEscrow(transactionReadback, escrowPDA, programId) {
  const message = transactionReadback?.transaction?.message;
  const keys = transactionAccountKeys(transactionReadback);
  const instructions = message?.compiledInstructions || message?.instructions || [];
  const escrowIndex = keys.indexOf(publicKeyString(escrowPDA));
  const expectedProgram = publicKeyString(programId);

  if (escrowIndex < 0) return false;
  return instructions.some((instruction) => {
    let invokedProgram;
    try {
      invokedProgram = Number.isInteger(instruction.programIdIndex)
        ? keys[instruction.programIdIndex]
        : publicKeyString(instruction.programId);
    } catch (_) {
      return false;
    }
    const accountIndexes = instruction.accountKeyIndexes || instruction.accounts || [];
    const data = instructionDataBuffer(instruction);
    const isCreateInstruction = CREATE_ESCROW_DISCRIMINATORS.some((discriminator) => (
      data.length >= discriminator.length && data.subarray(0, discriminator.length).equals(discriminator)
    ));
    return invokedProgram === expectedProgram
      && accountIndexes.includes(escrowIndex)
      && isCreateInstruction;
  });
}

function validateEscrowProofInput(escrowPDA, txSignature) {
  let escrow;
  try {
    escrow = new PublicKey(escrowPDA);
  } catch (_) {
    throw new EscrowOnChainReadbackError('escrowPDA must be a valid Solana address', 400, 'invalid_escrow_pda');
  }

  try {
    if (typeof txSignature !== 'string' || bs58.decode(txSignature).length !== 64) throw new Error('invalid');
  } catch (_) {
    throw new EscrowOnChainReadbackError('txSignature must be a valid Solana transaction signature', 400, 'invalid_tx_signature');
  }

  return escrow;
}

function decodedU64(value, field) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${field} must be non-negative`);
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return BigInt(value);
}

function validateEscrowAccount(
  accountInfo,
  expectedProgramId,
  expectedClient,
  expectedAgent,
  deserializeEscrowV3 = satpClient.deserializeEscrowV3,
) {
  if (!accountInfo?.data) {
    throw new EscrowOnChainReadbackError('Escrow account was not found on-chain', 422, 'escrow_account_not_found');
  }
  if (!accountInfo.owner || !new PublicKey(accountInfo.owner).equals(expectedProgramId)) {
    throw new EscrowOnChainReadbackError('Escrow account owner does not match the SATP V3 escrow program', 422, 'escrow_owner_mismatch');
  }

  const data = Buffer.from(accountInfo.data);
  if (data.length < ESCROW_V3_ACCOUNT_DISCRIMINATOR.length
      || !data.subarray(0, ESCROW_V3_ACCOUNT_DISCRIMINATOR.length).equals(ESCROW_V3_ACCOUNT_DISCRIMINATOR)) {
    throw new EscrowOnChainReadbackError('Escrow account discriminator does not match SATP V3', 422, 'escrow_discriminator_mismatch');
  }

  let escrowState;
  let amountLamports;
  let releasedAmountLamports;
  try {
    escrowState = deserializeEscrowV3(data);
    amountLamports = decodedU64(escrowState.amount, 'amount');
    releasedAmountLamports = decodedU64(escrowState.releasedAmount, 'releasedAmount');
  } catch (error) {
    throw new EscrowOnChainReadbackError(`Escrow account state is malformed: ${error.message}`, 422, 'escrow_state_malformed');
  }
  if (expectedClient && escrowState.client !== publicKeyString(expectedClient)) {
    throw new EscrowOnChainReadbackError('Escrow client does not match the authenticated job poster', 422, 'escrow_client_mismatch');
  }
  if (expectedAgent && escrowState.agent !== publicKeyString(expectedAgent)) {
    throw new EscrowOnChainReadbackError('Escrow agent does not match the selected job agent', 422, 'escrow_agent_mismatch');
  }
  if (escrowState.status !== 'Active') {
    throw new EscrowOnChainReadbackError('Escrow is not in the funded Active state', 422, 'escrow_not_active');
  }
  if (amountLamports <= 0n || amountLamports <= releasedAmountLamports) {
    throw new EscrowOnChainReadbackError('Escrow has no positive funded balance', 422, 'escrow_not_funded');
  }
  return {
    ...escrowState,
    amountLamports,
    releasedAmountLamports,
    remainingLamports: amountLamports - releasedAmountLamports,
  };
}

async function verifyEscrowFundingOnChain(
  { escrowPDA, txSignature, expectedClient, expectedAgent },
  {
    connection = null,
    network = normalizeNetwork(process.env.SATP_NETWORK || process.env.SOLANA_NETWORK || 'mainnet'),
    programId = null,
    getV3ProgramIds = satpClient.getV3ProgramIds,
    deserializeEscrowV3 = satpClient.deserializeEscrowV3,
    env = process.env,
  } = {},
) {
  const escrow = validateEscrowProofInput(escrowPDA, txSignature);
  const expectedProgramId = programId ? new PublicKey(programId) : escrowProgramIdForNetwork(network, getV3ProgramIds);
  const rpc = connection || new Connection(rpcUrlForNetwork(network, env), 'confirmed');

  let transactionReadback;
  let accountInfo;
  try {
    transactionReadback = await rpc.getTransaction(
      txSignature,
      { commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    );
  } catch (error) {
    throw new EscrowOnChainReadbackError(
      `Solana RPC readback failed: ${error.message}`,
      503,
      'rpc_readback_failed',
    );
  }

  if (!transactionReadback) {
    throw new EscrowOnChainReadbackError('Transaction was not found at confirmed commitment', 422, 'transaction_not_confirmed');
  }
  if (!transactionReadback.meta) {
    throw new EscrowOnChainReadbackError('Transaction metadata is unavailable', 422, 'transaction_metadata_unavailable');
  }
  if (transactionReadback.meta.err) {
    throw new EscrowOnChainReadbackError('Transaction failed on-chain', 422, 'transaction_failed');
  }

  const escrowAddress = escrow.toBase58();
  if (!transactionCreatesEscrow(transactionReadback, escrow, expectedProgramId)) {
    throw new EscrowOnChainReadbackError(
      'Transaction does not create the supplied escrowPDA through the SATP V3 escrow program',
      422,
      'transaction_escrow_mismatch',
    );
  }

  try {
    accountInfo = await rpc.getAccountInfo(escrow, {
      commitment: 'confirmed',
      ...(Number.isInteger(transactionReadback.slot) ? { minContextSlot: transactionReadback.slot } : {}),
    });
  } catch (error) {
    throw new EscrowOnChainReadbackError(
      `Solana RPC account readback failed: ${error.message}`,
      503,
      'rpc_readback_failed',
    );
  }

  const escrowState = validateEscrowAccount(
    accountInfo,
    expectedProgramId,
    expectedClient,
    expectedAgent,
    deserializeEscrowV3,
  );

  return {
    verified: true,
    network,
    slot: transactionReadback.slot,
    escrowPDA: escrowAddress,
    txSignature,
    escrowProgramId: expectedProgramId.toBase58(),
    commitment: 'confirmed',
    client: escrowState.client,
    agent: escrowState.agent,
    amount: escrowState.amountLamports.toString(),
    remaining: escrowState.remainingLamports.toString(),
    currency: escrowState.currency,
    status: escrowState.status,
  };
}

function readStagedEscrowFunding(db, { jobId, escrowReference }) {
  const escrow = db.prepare(`
    SELECT id, job_id, client_id, amount_minor, currency, status, deposit_confirmed_at
    FROM escrows
    WHERE id = ? AND job_id = ?
  `).get(escrowReference, jobId);
  if (!escrow) {
    throw new EscrowOnChainReadbackError(
      'Funding reference does not resolve to the staged escrow for this job',
      409,
      'staged_escrow_reference_mismatch',
    );
  }
  if (!/^[1-9]\d*$/.test(String(escrow.amount_minor || ''))) {
    throw new EscrowOnChainReadbackError(
      'Staged escrow amount is missing or malformed',
      409,
      'staged_escrow_amount_invalid',
    );
  }
  return {
    verified: true,
    source: STAGED_READBACK_SOURCE,
    escrowReference: escrow.id,
    jobId: escrow.job_id,
    clientId: escrow.client_id,
    amountMinor: String(escrow.amount_minor),
    currency: escrow.currency,
    status: escrow.status,
    depositConfirmedAt: escrow.deposit_confirmed_at || null,
  };
}

module.exports = {
  ESCROW_V3_ACCOUNT_DISCRIMINATOR,
  READBACK_ERROR_CODE,
  STAGED_READBACK_SOURCE,
  EscrowOnChainReadbackError,
  escrowProgramIdForNetwork,
  transactionAccountKeys,
  transactionCreatesEscrow,
  validateEscrowAccount,
  readStagedEscrowFunding,
  verifyEscrowFundingOnChain,
};
