/**
 * AgentFolio Escrow — On-chain transaction builder
 * Builds unsigned transactions for the agentfolio_escrow program.
 * Frontend signs → sends back → backend confirms.
 */

const { Connection, PublicKey, TransactionMessage, VersionedTransaction, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const ESCROW_PROGRAM_ID = new PublicKey('4qx9DTX1BojPnQAtUBL2Gb9pw6kVyw5AucjaR8Yyea9a');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TREASURY_WALLET = new PublicKey('FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be');
const RPC_ENDPOINT = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const RENT_SYSVAR = new PublicKey('SysvarRent111111111111111111111111111111111');

// Discriminators from IDL
const DISCRIMINATORS = {
  create_escrow:  Buffer.from([253, 215, 165, 116, 36, 108, 68, 80]),
  accept_job:     Buffer.from([43, 201, 124, 1, 19, 189, 96, 10]),
  submit_work:    Buffer.from([158, 80, 101, 51, 114, 130, 101, 253]),
  release:        Buffer.from([253, 249, 15, 206, 28, 127, 193, 241]),
  refund:         Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]),
  auto_release:   Buffer.from([212, 34, 30, 246, 192, 13, 97, 31]),
  open_dispute:   Buffer.from([137, 25, 99, 119, 23, 223, 161, 42]),
  resolve_dispute: Buffer.from([231, 6, 202, 6, 96, 103, 12, 230]),
};

function encodeString(s) {
  const buf = Buffer.from(s || '', 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length);
  return Buffer.concat([len, buf]);
}

function encodeU64(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

function encodeI64(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(n));
  return buf;
}

function deriveEscrowPDA(jobId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), Buffer.from(jobId)],
    ESCROW_PROGRAM_ID
  );
}

function deriveVaultPDA(jobId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), Buffer.from(jobId)],
    ESCROW_PROGRAM_ID
  );
}

async function getConnection() {
  return new Connection(RPC_ENDPOINT, 'confirmed');
}

/**
 * Build create_escrow transaction (client deposits USDC into PDA vault)
 * @param {string} clientWallet - Client's wallet address
 * @param {string} jobId - Job identifier
 * @param {number} amountUSDC - Amount in USDC (will be converted to raw units)
 * @param {number} deadlineUnix - Unix timestamp for deadline
 */
async function buildCreateEscrowTx(clientWallet, jobId, amountUSDC, deadlineUnix) {
  const connection = await getConnection();
  const client = new PublicKey(clientWallet);
  const [escrowPDA] = deriveEscrowPDA(jobId);
  const [vaultPDA] = deriveVaultPDA(jobId);
  const clientToken = await getAssociatedTokenAddress(USDC_MINT, client);

  const amountRaw = Math.floor(amountUSDC * 1e6);

  const data = Buffer.concat([
    DISCRIMINATORS.create_escrow,
    encodeString(jobId),
    encodeU64(amountRaw),
    encodeI64(deadlineUnix),
  ]);

  const instruction = {
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: escrowPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: clientToken, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: client, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
    ],
    data,
  };

  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: client,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  return {
    success: true,
    transaction: Buffer.from(tx.serialize()).toString('base64'),
    escrowPDA: escrowPDA.toBase58(),
    vaultPDA: vaultPDA.toBase58(),
  };
}

/**
 * Build release transaction (client releases funds to agent)
 */
async function buildReleaseTx(clientWallet, agentWallet, jobId) {
  const connection = await getConnection();
  const client = new PublicKey(clientWallet);
  const agent = new PublicKey(agentWallet);
  const [escrowPDA] = deriveEscrowPDA(jobId);
  const [vaultPDA] = deriveVaultPDA(jobId);
  const agentToken = await getAssociatedTokenAddress(USDC_MINT, agent);
  const treasuryToken = await getAssociatedTokenAddress(USDC_MINT, TREASURY_WALLET);

  const instruction = {
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: escrowPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: client, isSigner: true, isWritable: false },
      { pubkey: agentToken, isSigner: false, isWritable: true },
      { pubkey: treasuryToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: DISCRIMINATORS.release,
  };

  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: client,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  return {
    success: true,
    transaction: Buffer.from(tx.serialize()).toString('base64'),
    escrowPDA: escrowPDA.toBase58(),
  };
}

/**
 * Build refund transaction (client refunds if no agent or past deadline)
 */
async function buildRefundTx(clientWallet, jobId) {
  const connection = await getConnection();
  const client = new PublicKey(clientWallet);
  const [escrowPDA] = deriveEscrowPDA(jobId);
  const [vaultPDA] = deriveVaultPDA(jobId);
  const clientToken = await getAssociatedTokenAddress(USDC_MINT, client);

  const instruction = {
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: escrowPDA, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: client, isSigner: true, isWritable: true },
      { pubkey: clientToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: DISCRIMINATORS.refund,
  };

  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: client,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  return {
    success: true,
    transaction: Buffer.from(tx.serialize()).toString('base64'),
    escrowPDA: escrowPDA.toBase58(),
  };
}

/**
 * Build accept_job transaction (agent accepts)
 */
async function buildAcceptJobTx(agentWallet, jobId) {
  const connection = await getConnection();
  const agent = new PublicKey(agentWallet);
  const [escrowPDA] = deriveEscrowPDA(jobId);

  const instruction = {
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: escrowPDA, isSigner: false, isWritable: true },
      { pubkey: agent, isSigner: true, isWritable: false },
    ],
    data: DISCRIMINATORS.accept_job,
  };

  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: agent,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  return {
    success: true,
    transaction: Buffer.from(tx.serialize()).toString('base64'),
    escrowPDA: escrowPDA.toBase58(),
  };
}

/**
 * Build submit_work transaction (agent submits, starts 24h timer)
 */
async function buildSubmitWorkTx(agentWallet, jobId) {
  const connection = await getConnection();
  const agent = new PublicKey(agentWallet);
  const [escrowPDA] = deriveEscrowPDA(jobId);

  const instruction = {
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: escrowPDA, isSigner: false, isWritable: true },
      { pubkey: agent, isSigner: true, isWritable: false },
    ],
    data: DISCRIMINATORS.submit_work,
  };

  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: agent,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  const tx = new VersionedTransaction(msg);
  return {
    success: true,
    transaction: Buffer.from(tx.serialize()).toString('base64'),
    escrowPDA: escrowPDA.toBase58(),
  };
}

/**
 * Confirm a signed transaction on-chain
 */
async function confirmTransaction(signedTxBase64) {
  const connection = await getConnection();
  const txBytes = Buffer.from(signedTxBase64, 'base64');
  const sig = await connection.sendRawTransaction(txBytes, { skipPreflight: false });
  await connection.confirmTransaction(sig, 'confirmed');
  return { success: true, signature: sig, explorerUrl: `https://explorer.solana.com/tx/${sig}` };
}

/**
 * On-chain escrow state enum (matches Rust program)
 */
const ESCROW_STATES = {
  0: 'created',
  1: 'agent_accepted',
  2: 'work_submitted',
  3: 'released',
  4: 'refunded',
  5: 'disputed',
  6: 'resolved',
  7: 'auto_released',
};

/**
 * Read and deserialize the on-chain escrow PDA account.
 * Returns the current on-chain state (source of truth).
 *
 * Account layout (after 8-byte Anchor discriminator):
 *   client:      Pubkey (32)
 *   agent:       Pubkey (32)  — all zeros if unset
 *   job_id:      String (4-byte len + utf8)
 *   amount:      u64 (8)
 *   deadline:    i64 (8)
 *   status:      u8 (1)
 *   submitted_at: i64 (8) — 0 if not submitted
 *   created_at:  i64 (8)
 *   bump:        u8 (1)
 */
async function readEscrowAccount(jobId) {
  const connection = await getConnection();
  const [escrowPDA] = deriveEscrowPDA(jobId);
  const accountInfo = await connection.getAccountInfo(escrowPDA);

  if (!accountInfo || !accountInfo.data) {
    return { exists: false, escrowPDA: escrowPDA.toBase58() };
  }

  const data = accountInfo.data;
  let offset = 8; // skip Anchor discriminator

  const client = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const agentBytes = data.slice(offset, offset + 32);
  const agent = new PublicKey(agentBytes).toBase58();
  const agentIsZero = agentBytes.every(b => b === 0);
  offset += 32;

  // job_id string (4-byte LE length prefix)
  const jobIdLen = data.readUInt32LE(offset);
  offset += 4;
  const onchainJobId = data.slice(offset, offset + jobIdLen).toString('utf8');
  offset += jobIdLen;

  const amount = Number(data.readBigUInt64LE(offset)) / 1e6; // raw → USDC
  offset += 8;

  const deadline = Number(data.readBigInt64LE(offset));
  offset += 8;

  // Status byte comes right after deadline per Anchor struct layout
  const statusCode = data.readUInt8(offset);
  offset += 1;

  // submitted_at: i64 (0 if not submitted)
  let submittedAt = 0;
  if (offset + 8 <= data.length) {
    submittedAt = Number(data.readBigInt64LE(offset));
    offset += 8;
  }

  // created_at: i64
  let createdAt = 0;
  if (offset + 8 <= data.length) {
    createdAt = Number(data.readBigInt64LE(offset));
    offset += 8;
  }

  // bump: u8
  let bump = 0;
  if (offset < data.length) {
    bump = data.readUInt8(offset);
    offset += 1;
  }

  return {
    exists: true,
    escrowPDA: escrowPDA.toBase58(),
    client,
    agent: agentIsZero ? null : agent,
    jobId: onchainJobId,
    amountUSDC: amount,
    deadline,
    deadlineDate: new Date(deadline * 1000).toISOString(),
    status: ESCROW_STATES[statusCode] || `unknown_${statusCode}`,
    statusCode,
    submittedAt: (submittedAt > 0 && submittedAt < 4102444800) ? submittedAt : null,
    submittedAtDate: (submittedAt > 0 && submittedAt < 4102444800) ? new Date(submittedAt * 1000).toISOString() : null,
    createdAt,
    createdAtDate: (createdAt > 0 && createdAt < 4102444800) ? new Date(createdAt * 1000).toISOString() : null,
    bump,
    explorerUrl: `https://explorer.solana.com/address/${escrowPDA.toBase58()}`,
  };
}

/**
 * Map on-chain escrow status to marketplace job status
 */
function mapOnchainStatusToJobStatus(onchainStatus) {
  const map = {
    'created': 'open',
    'agent_accepted': 'in_progress',
    'work_submitted': 'work_submitted',
    'released': 'completed',
    'refunded': 'cancelled',
    'disputed': 'disputed',
    'resolved': 'completed',
    'auto_released': 'completed',
  };
  return map[onchainStatus] || null;
}

module.exports = {
  buildCreateEscrowTx,
  buildReleaseTx,
  buildRefundTx,
  buildAcceptJobTx,
  buildSubmitWorkTx,
  confirmTransaction,
  readEscrowAccount,
  mapOnchainStatusToJobStatus,
  deriveEscrowPDA,
  deriveVaultPDA,
  getConnection,
  ESCROW_PROGRAM_ID,
  ESCROW_STATES,
  DISCRIMINATORS,
};
