/**
 * SATP Escrow V3 API Routes — gated on-chain escrow transaction builders
 *
 * Endpoints:
 *   POST /api/v3/escrow/create          — Build unsigned createEscrow TX (identity-gated)
 *   POST /api/v3/escrow/submit-work     — Build unsigned submitWork TX
 *   POST /api/v3/escrow/release         — Build unsigned release TX (full remaining)
 *   POST /api/v3/escrow/partial-release — Build unsigned partialRelease TX (milestone)
 *   POST /api/v3/escrow/cancel          — Build unsigned cancelEscrow TX
 *   POST /api/v3/escrow/dispute         — Build unsigned raiseDispute TX (with reason)
 *   POST /api/v3/escrow/resolve         — Build unsigned resolveDispute TX (arbiter split)
 *   POST /api/v3/escrow/close            — Build unsigned closeEscrow TX (reclaim rent)
 *   POST /api/v3/escrow/extend-deadline — Build unsigned extendDeadline TX
 *   GET  /api/v3/escrow/:pda            — Fetch escrow state from chain
 *   GET  /api/v3/escrow/pda/derive      — Derive escrow PDA (client + description + nonce)
 *
 * V3 upgrades over V1:
 *   - Identity verification: agent must have SATP V3 Genesis Record
 *   - Optional trust requirements: minVerificationLevel, requireBorn
 *   - Third-party arbiter (not just client-as-arbiter)
 *   - Milestone partial releases
 *   - Split dispute resolution (arbiter sets exact agent/client amounts)
 *   - Dispute tracking with reason hash
 *   - Nonce-based PDAs (multiple escrows between same parties)
 *
 * POST endpoints are live-funds gated. When explicitly enabled after re-review,
 * they return unsigned transactions (base64) for client-side wallet signing.
 * Server is stateless — no private keys.
 *
 * brainChain — 2026-03-28
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = require('@solana/web3.js');
const crypto = require('crypto');
const satpClient = require('@brainai/satp-client');
const {
  liveEscrowGateStatus,
  sendLiveEscrowGateResponse,
} = require('../lib/write-surface-gate');
const {
  getEscrowV3AuthorityReadback,
  getEscrowV3ProvenanceReadback,
} = require('../lib/escrow-v3-authority');
const { loadJob, loadProfile } = require('../lib/database');
const {
  buildCreateEscrowTx: buildUsdcCreateEscrowTx,
  deriveEscrowPDA: deriveUsdcEscrowPDA,
  deriveUsdcVaultATA,
  deriveUsdcVaultAuthorityPDA,
  parseUsdcAmountToBaseUnits,
  USDC_MINT,
} = require('../lib/escrow-onchain');

const router = Router();

const escrowV3CreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many escrow create requests, please retry later' },
});

// ── SDK Setup ──────────────────────────────────────────────────────────────────
let SATPV3SDK;
let sdkInstance = null;
const getV3ProgramIds = satpClient.getV3ProgramIds;
const getV3EscrowPDA = satpClient.getV3EscrowPDA;
const getGenesisPDA = satpClient.getGenesisPDA;

function normalizeNetwork(value) {
  return String(value || '').toLowerCase().includes('devnet') ? 'devnet' : 'mainnet';
}

try {
  SATPV3SDK = satpClient.SATPV3SDK;
  if (!SATPV3SDK) {
    throw new Error('@brainai/satp-client missing required export: SATPV3SDK');
  }
  console.log('[Escrow V3 Routes] V3 SDK loaded from @brainai/satp-client (SATPV3SDK)');
} catch (err) {
  console.warn('[Escrow V3 Routes] SATP V3 SDK not found. Escrow V3 endpoints disabled.');
  console.warn(`  @brainai/satp-client boundary error: ${err.message}`);
}

const NETWORK = normalizeNetwork(process.env.SATP_NETWORK || process.env.SOLANA_NETWORK || 'mainnet');
const RPC_URL = process.env.SOLANA_RPC_URL || null;
const DEFAULT_SOLANA_RPC_URL = NETWORK === 'devnet'
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com';
const PLATFORM_FEE_BPS = 500;
const BPS_DENOMINATOR = 10_000;
const PLATFORM_TREASURY_WALLET = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const ESCROW_V3_AMOUNT_OFFSET = 8 + 32 + 32 + 32;
const ESCROW_V3_RELEASED_AMOUNT_OFFSET = ESCROW_V3_AMOUNT_OFFSET + 8;
const ESCROW_V3_ACCOUNT_DISCRIMINATOR = Buffer.from([145, 108, 37, 52, 197, 162, 232, 59]);
const ESCROW_V3_DISCRIMINATORS = {
  release: Buffer.from([253, 249, 15, 206, 28, 127, 193, 241]),
  partialRelease: Buffer.from([20, 4, 101, 245, 53, 131, 213, 8]),
};
const ESCROW_V3_PROVENANCE_MISMATCH_CODE = 'ESCROW_V3_PROVENANCE_MISMATCH';
const ESCROW_V3_FEE_ROUTING_UNSUPPORTED_CODE = 'ESCROW_V3_FEE_ROUTING_UNSUPPORTED';
const ESCROW_V3_FEE_ROUTING_ROUTE_NAMES = new Map([
  ['/release', 'release'],
  ['/partial-release', 'partial_release'],
]);

function getSDK() {
  if (!sdkInstance && SATPV3SDK) {
    sdkInstance = new SATPV3SDK({ network: NETWORK, ...(RPC_URL ? { rpcUrl: RPC_URL } : {}) });
  }
  return sdkInstance;
}

// ── Middleware ──────────────────────────────────────────────────────────────────

function requireSDK(req, res, next) {
  const sdk = getSDK();
  if (!sdk) {
    return res.status(503).json({
      error: 'Escrow V3 SDK not available',
      hint: '@brainai/satp-client package or SATPV3SDK export not found on this server',
    });
  }
  req.sdk = sdk;
  next();
}

function requireLiveEscrowWrites(req, res, next) {
  if (sendLiveEscrowGateResponse(res, `SATP V3 escrow ${req.method} ${req.path}`)) return;
  const authorityReadback = getEscrowV3AuthorityReadback({ satpClient });
  const provenance = getEscrowV3ProvenanceReadback({ authorityReadback, network: NETWORK });
  if (provenance.failClosed) {
    return res.status(423).json({
      ok: false,
      code: ESCROW_V3_PROVENANCE_MISMATCH_CODE,
      error: 'Live escrow writes remain blocked by the pinned source/deployed/published-IDL provenance gap.',
      operation: `SATP V3 escrow ${req.method} ${req.path}`,
      escrowProvenance: provenance,
    });
  }
  next();
}

function requireLiveFeeRoutingSupport(req, res, next) {
  const routePath = String(req.path || '').toLowerCase().replace(/\/+$/, '') || '/';
  const instruction = ESCROW_V3_FEE_ROUTING_ROUTE_NAMES.get(routePath);
  if (!instruction) return next();

  const authorityReadback = getEscrowV3AuthorityReadback({ satpClient });
  const feeRouting = authorityReadback.releaseFeeRouting;
  const routeReadback = feeRouting?.routes?.[instruction];
  if (feeRouting?.supported === true && routeReadback?.treasuryAccountWritable === true) {
    return next();
  }

  return res.status(501).json({
    ok: false,
    code: ESCROW_V3_FEE_ROUTING_UNSUPPORTED_CODE,
    error: 'The certified deployed SATP escrow runtime does not support audited on-chain platform fee routing for this release route; transaction construction is disabled.',
    operation: `SATP V3 escrow ${req.method} ${req.path}`,
    instruction,
    network: NETWORK,
    escrowProgramId: authorityReadback.expectedProgramId,
    feeRouting,
  });
}

function validatePublicKey(value, fieldName) {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function getSingleQueryString(value) {
  return typeof value === 'string' ? value : undefined;
}

function normalizeEscrowCurrency(value) {
  const currency = String(value || 'SOL').trim().toUpperCase();
  if (currency === 'SOL' || currency === 'USDC') return currency;
  const err = new Error('currency must be SOL or USDC');
  err.statusCode = 400;
  throw err;
}

function publicKeyToString(value) {
  if (!value) return null;
  return typeof value.toBase58 === 'function' ? value.toBase58() : String(value);
}

function normalizeRouteUsdcAmount(amountUSDC) {
  const parseRouteAmount = (amountDecimal) => {
    try {
      return parseUsdcAmountToBaseUnits(amountDecimal);
    } catch (err) {
      err.statusCode = 400;
      throw err;
    }
  };

  if (typeof amountUSDC === 'string') {
    const amountDecimal = amountUSDC.trim();
    return {
      amountDecimal,
      amountRaw: parseRouteAmount(amountDecimal),
    };
  }

  if (typeof amountUSDC === 'number' && Number.isSafeInteger(amountUSDC) && amountUSDC > 0) {
    const amountDecimal = String(amountUSDC);
    return {
      amountDecimal,
      amountRaw: parseRouteAmount(amountDecimal),
    };
  }

  const err = new Error('amountUSDC must be a positive decimal string for fractional USDC escrow amounts');
  err.statusCode = 400;
  throw err;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function serializeTx(tx) {
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(serialized).toString('base64');
}

function satpProgramIdUnavailable(message) {
  const err = new Error(message);
  err.statusCode = 503;
  err.code = 'SATP_V3_PROGRAM_IDS_UNAVAILABLE';
  return err;
}

function readV3ProgramIds(network = NETWORK) {
  if (typeof getV3ProgramIds !== 'function') {
    throw satpProgramIdUnavailable('@brainai/satp-client missing required export: getV3ProgramIds');
  }

  try {
    return getV3ProgramIds(network);
  } catch (err) {
    throw satpProgramIdUnavailable(err.message);
  }
}

function getEscrowProgramId(network = NETWORK) {
  const ids = readV3ProgramIds(network);
  const escrowId = ids?.ESCROW || ids?.escrow || ids?.ESCROW_V3 || ids?.escrowV3;
  if (!escrowId) {
    throw satpProgramIdUnavailable(`SATP V3 escrow program ID is not configured for ${network}`);
  }
  return new PublicKey(escrowId);
}

function encodeU64(value) {
  const amount = BigInt(value);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(amount);
  return buffer;
}

function calculatePlatformFeeSplit(amountLamports) {
  const amount = BigInt(amountLamports);
  if (amount <= 0n) {
    throw new Error('amountLamports must be a positive number');
  }
  const platformFee = (amount * BigInt(PLATFORM_FEE_BPS)) / BigInt(BPS_DENOMINATOR);
  const agentAmount = amount - platformFee;
  if (agentAmount <= 0n) {
    throw new Error('release amount is too small after platform fee');
  }
  return {
    grossAmountLamports: amount.toString(),
    agentAmountLamports: agentAmount.toString(),
    platformFeeLamports: platformFee.toString(),
    platformFeeBps: PLATFORM_FEE_BPS,
    treasuryWallet: PLATFORM_TREASURY_WALLET,
    rounding: 'integer floor in lamports; sub-20-lamport releases produce 0 platform fee',
  };
}

function validatePositiveLamports(value, fieldName) {
  if (typeof value === 'bigint') {
    if (value <= 0n) throw new Error(`${fieldName} must be a positive integer`);
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`${fieldName} must be a positive integer`);
}

function publicKeyEquals(left, right) {
  return new PublicKey(left).equals(new PublicKey(right));
}

function parseFullReleaseAmountReadbackFromAccountInfo(accountInfo, expectedProgramId) {
  if (!accountInfo?.data) {
    const err = new Error('Escrow account not found for release platform fee readback');
    err.statusCode = 404;
    throw err;
  }

  if (!accountInfo.owner || !publicKeyEquals(accountInfo.owner, expectedProgramId)) {
    const err = new Error('Escrow account owner mismatch for release platform fee readback');
    err.statusCode = 409;
    throw err;
  }

  return parseFullReleaseAmountReadback(accountInfo.data);
}

function parseFullReleaseAmountReadback(accountData) {
  const data = Buffer.from(accountData || []);
  if (data.length < ESCROW_V3_RELEASED_AMOUNT_OFFSET + 8) {
    throw new Error('escrow account data is too short for release fee readback');
  }

  const discriminator = data.subarray(0, ESCROW_V3_ACCOUNT_DISCRIMINATOR.length);
  if (!discriminator.equals(ESCROW_V3_ACCOUNT_DISCRIMINATOR)) {
    throw new Error('Escrow V3 account discriminator mismatch for release platform fee readback');
  }

  const escrowAmount = data.readBigUInt64LE(ESCROW_V3_AMOUNT_OFFSET);
  const releasedAmount = data.readBigUInt64LE(ESCROW_V3_RELEASED_AMOUNT_OFFSET);
  const remainingAmount = escrowAmount > releasedAmount ? escrowAmount - releasedAmount : 0n;
  const feeSplit = calculatePlatformFeeSplit(remainingAmount);

  return {
    source: 'escrow_v3_account.amount_minus_released_amount',
    escrowAmountLamports: escrowAmount.toString(),
    releasedAmountLamports: releasedAmount.toString(),
    remainingAmountLamports: remainingAmount.toString(),
    ...feeSplit,
  };
}

async function getFullReleasePlatformFeeReadback(escrowPDA) {
  const connection = new Connection(RPC_URL || DEFAULT_SOLANA_RPC_URL, 'confirmed');
  const escrow = new PublicKey(escrowPDA);
  const programId = getEscrowProgramId();
  const accountInfo = await connection.getAccountInfo(escrow);
  return parseFullReleaseAmountReadbackFromAccountInfo(accountInfo, programId);
}

function buildEscrowReleaseInstruction({ clientWallet, agentWallet, escrowPDA, amountLamports = null, programId = null }) {
  const client = new PublicKey(clientWallet);
  const agent = new PublicKey(agentWallet);
  const escrow = new PublicKey(escrowPDA);
  const treasury = new PublicKey(PLATFORM_TREASURY_WALLET);
  const escrowProgramId = programId ? new PublicKey(programId) : getEscrowProgramId();
  const data = amountLamports === null
    ? ESCROW_V3_DISCRIMINATORS.release
    : Buffer.concat([ESCROW_V3_DISCRIMINATORS.partialRelease, encodeU64(amountLamports)]);

  return new TransactionInstruction({
    programId: escrowProgramId,
    keys: [
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: client, isSigner: true, isWritable: false },
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
    ],
    data,
  });
}

async function buildEscrowReleaseTx({ clientWallet, agentWallet, escrowPDA, amountLamports = null }) {
  const connection = new Connection(RPC_URL || DEFAULT_SOLANA_RPC_URL, 'confirmed');
  const client = new PublicKey(clientWallet);
  const instruction = buildEscrowReleaseInstruction({ clientWallet, agentWallet, escrowPDA, amountLamports });

  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: client,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message();

  return new VersionedTransaction(msg);
}

function hashIfNeeded(input) {
  if (Buffer.isBuffer(input) && input.length === 32) return input;
  if (typeof input === 'string' && /^[0-9a-f]{64}$/i.test(input)) {
    return Buffer.from(input, 'hex');
  }
  if (typeof input !== 'string' && !Buffer.isBuffer(input)) {
    throw new TypeError('description must be a string or 32-byte Buffer');
  }
  return crypto.createHash('sha256')
    .update(typeof input === 'string' ? input : Buffer.from(input))
    .digest();
}

function deriveEscrowPDA(client, descriptionOrHash, nonce) {
  if (typeof getV3EscrowPDA !== 'function') {
    throw new Error('@brainai/satp-client missing required export: getV3EscrowPDA');
  }
  const descriptionHash = hashIfNeeded(descriptionOrHash);
  try {
    const [escrowPDA, bump] = getV3EscrowPDA(client, descriptionHash, nonce, NETWORK);
    return {
      escrowPDA: escrowPDA.toBase58(),
      descriptionHash: descriptionHash.toString('hex'),
      bump,
    };
  } catch (err) {
    if (/mainnet program IDs are not configured|Invalid network/i.test(err.message)) {
      throw satpProgramIdUnavailable(err.message);
    }
    throw err;
  }
}

function deriveSelectedAgentSatpReadback(agentId, network = NETWORK) {
  if (!agentId || typeof getGenesisPDA !== 'function') {
    return null;
  }

  try {
    const [genesisPDA] = getGenesisPDA(agentId, network);
    const programIds = readV3ProgramIds(network);
    return {
      agentId,
      network,
      available: true,
      genesisPDA: publicKeyToString(genesisPDA),
      identityProgramId: publicKeyToString(programIds.IDENTITY),
    };
  } catch (err) {
    return {
      agentId,
      network,
      available: false,
      error: err.message,
      code: err.code || 'SATP_V3_PROGRAM_IDS_UNAVAILABLE',
    };
  }
}

function sendSatpProgramIdError(res, err) {
  return res.status(err.statusCode || 500).json({
    error: err.message,
    code: err.code,
    network: NETWORK,
  });
}

function currentEscrowProgramId() {
  return getEscrowProgramId(NETWORK);
}

function getEscrowPdaReadback(client, descriptionOrHash, nonce) {
  const result = deriveEscrowPDA(client, descriptionOrHash, nonce);
  return {
    ...result,
    network: NETWORK,
  };
}

function resolveProfileSolanaWallet(profile) {
  if (!profile) return null;

  const candidates = [
    profile.wallets?.solana,
    profile.wallet,
    profile.verificationData?.solana?.address,
    profile.verification_data?.solana?.address,
  ];

  const verifiedSolana = Array.isArray(profile.verifications)
    ? profile.verifications.find((verification) => verification?.platform === 'solana')
    : null;
  candidates.push(verifiedSolana?.identifier);

  const wallet = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return wallet ? wallet.trim() : null;
}

function resolveEscrowAgentId({ jobId, agentId }, loadJobById = loadJob) {
  if (!jobId) return { agentId, job: null };

  const job = loadJobById(jobId);
  if (!job) {
    const err = new Error('Job not found');
    err.statusCode = 404;
    throw err;
  }

  const selectedAgentId = job.selected_agent_id || job.selectedAgentId;
  if (!selectedAgentId) {
    const err = new Error('Job has no selected agent');
    err.statusCode = 409;
    throw err;
  }

  if (agentId && agentId !== selectedAgentId) {
    const err = new Error('agentId must match the job selected agent');
    err.statusCode = 409;
    err.details = { selectedAgentId };
    throw err;
  }

  return { agentId: selectedAgentId, job };
}

function resolveEscrowAgentBinding(
  { jobId, agentId, agentWallet },
  {
    loadJobById = loadJob,
    loadProfileById = loadProfile,
    network = NETWORK,
  } = {},
) {
  const { agentId: selectedAgentId, job } = resolveEscrowAgentId({ jobId, agentId }, loadJobById);
  const satpIdentity = deriveSelectedAgentSatpReadback(selectedAgentId, network);

  if (!jobId) {
    return {
      agentId: selectedAgentId,
      agentWallet,
      job,
      selectedAgentWallet: null,
      satpIdentity,
    };
  }

  const selectedAgentProfile = loadProfileById(selectedAgentId);
  if (!selectedAgentProfile) {
    const err = new Error('Selected agent profile not found');
    err.statusCode = 409;
    err.details = { selectedAgentId };
    throw err;
  }

  const selectedAgentWallet = resolveProfileSolanaWallet(selectedAgentProfile);
  if (!selectedAgentWallet) {
    const err = new Error('Selected agent has no Solana wallet for escrow payout binding');
    err.statusCode = 409;
    err.details = { selectedAgentId };
    throw err;
  }

  if (agentWallet && agentWallet !== selectedAgentWallet) {
    const err = new Error('agentWallet must match the selected job agent Solana wallet');
    err.statusCode = 409;
    err.details = { selectedAgentId, selectedAgentWallet };
    throw err;
  }

  return {
    agentId: selectedAgentId,
    agentWallet: selectedAgentWallet,
    job,
    selectedAgentWallet,
    satpIdentity,
  };
}

router.get('/health', (req, res) => {
  const agentId = getSingleQueryString(req.query.agentId);
  const escrowAuthority = getEscrowV3AuthorityReadback({ satpClient });
  const liveEscrow = liveEscrowGateStatus();
  res.json({
    status: 'ok',
    network: NETWORK,
    advertisedNetwork: liveEscrow.advertisedNetwork,
    advertisedEscrowProgramId: liveEscrow.advertisedEscrowProgramId,
    leftoverRuntimeNetwork: liveEscrow.leftoverRuntimeNetwork,
    leftoverRuntimeProgramId: liveEscrow.leftoverRuntimeProgramId,
    hostEnvSplit: liveEscrow.hostEnvSplit,
    sdkAvailable: Boolean(SATPV3SDK),
    liveEscrow,
    escrowAuthority,
    escrowProvenance: getEscrowV3ProvenanceReadback({ authorityReadback: escrowAuthority, network: NETWORK }),
    selectedAgentSatpIdentity: deriveSelectedAgentSatpReadback(agentId),
    timestamp: new Date().toISOString(),
  });
});

router.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  return requireLiveFeeRoutingSupport(req, res, () => requireLiveEscrowWrites(req, res, next));
});

// ── POST /create ───────────────────────────────────────────────────────────────
/**
 * Build an unsigned createEscrow transaction with SATP V3 identity requirements.
 *
 * Body: {
 *   clientWallet: string,           // Client's wallet (payer + signer)
 *   agentWallet: string,            // Agent's wallet
 *   agentId?: string,               // Agent's SATP V3 identity ID (must match job when jobId is supplied)
 *   jobId?: string,                 // Marketplace job; selected_agent_id is authoritative for Genesis lookup
 *   currency?: 'SOL'|'USDC',        // Defaults to SOL
 *   amountLamports?: number,        // SOL amount in lamports
 *   amountUSDC?: string|number,     // USDC amount; use a decimal string for fractional USDC
 *   description: string,            // Job description (hashed on-chain as [u8;32])
 *   deadlineUnix: number,           // Unix timestamp deadline
 *   nonce?: number,                 // Nonce for multiple escrows (default: 0)
 *   arbiter?: string,               // Third-party arbiter wallet (default: client)
 *   minVerificationLevel?: number,  // 0-5 minimum trust level (default: 0)
 *   requireBorn?: boolean           // Require agent has completed burn-to-become (default: false)
 * }
 */
router.post('/create', escrowV3CreateLimiter, requireSDK, async (req, res) => {
  try {
    const {
      clientWallet, agentWallet, agentId, jobId, amountLamports, amountUSDC, currency,
      description, deadlineUnix, nonce, arbiter,
      minVerificationLevel, requireBorn,
    } = req.body;
    const escrowCurrency = normalizeEscrowCurrency(currency || (amountUSDC ? 'USDC' : 'SOL'));

    const agentBinding = resolveEscrowAgentBinding({ jobId, agentId, agentWallet });

    // Required fields
    if (!clientWallet || !agentBinding.agentWallet || !agentBinding.agentId || !description || !deadlineUnix) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'agentWallet', 'agentId or jobId', 'description', 'deadlineUnix'],
        optional: ['currency', 'amountLamports', 'amountUSDC', 'jobId', 'nonce', 'arbiter', 'minVerificationLevel', 'requireBorn'],
      });
    }

    // Validate wallets
    if (!validatePublicKey(clientWallet, 'clientWallet')) {
      return res.status(400).json({ error: 'Invalid clientWallet address' });
    }
    if (!validatePublicKey(agentBinding.agentWallet, 'agentWallet')) {
      return res.status(400).json({ error: 'Invalid agentWallet address' });
    }
    if (arbiter && !validatePublicKey(arbiter, 'arbiter')) {
      return res.status(400).json({ error: 'Invalid arbiter address' });
    }

    // Validate deadline
    const deadline = Number(deadlineUnix);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(deadline) || deadline <= now) {
      return res.status(400).json({ error: 'deadlineUnix must be a future Unix timestamp' });
    }

    // Validate verification level
    const minLevel = Number(minVerificationLevel) || 0;
    if (minLevel < 0 || minLevel > 5) {
      return res.status(400).json({ error: 'minVerificationLevel must be 0-5' });
    }

    // Build TX via SDK
    const opts = {};
    if (arbiter) opts.arbiter = arbiter;
    if (minLevel > 0) opts.minVerificationLevel = minLevel;
    if (requireBorn) opts.requireBorn = true;

    if (escrowCurrency === 'USDC') {
      if (!jobId) {
        return res.status(400).json({ error: 'jobId is required for USDC escrow PDA derivation' });
      }
      const { amountDecimal, amountRaw } = normalizeRouteUsdcAmount(amountUSDC);

      const result = await buildUsdcCreateEscrowTx(clientWallet, jobId, amountDecimal, deadline);
      if (result.amountRaw !== amountRaw) {
        throw new Error('USDC amount parser invariant failed');
      }
      const [escrowPDA] = deriveUsdcEscrowPDA(jobId);
      const [vaultPDA] = deriveUsdcVaultAuthorityPDA(jobId);
      const vaultATA = await deriveUsdcVaultATA(jobId);

      return res.json({
        transaction: result.transaction,
        escrowPDA: escrowPDA.toBase58(),
        vaultPDA: vaultPDA.toBase58(),
        vaultATA: vaultATA.toBase58(),
        clientATA: result.clientATA,
        usdcMint: USDC_MINT.toBase58(),
        amountUSDC: amountDecimal,
        amountRaw,
        currency: 'USDC',
        network: NETWORK,
        nonce: nonce || 0,
        agentId: agentBinding.agentId,
        agentWallet: agentBinding.agentWallet,
        jobId: agentBinding.job ? agentBinding.job.id : jobId,
        selectedAgentSatpIdentity: agentBinding.satpIdentity,
        identityGateIncluded: true,
        liveEscrow: liveEscrowGateStatus(),
        message: 'Sign and submit to create a USDC escrow only after live-funds release gates are enabled',
      });
    }

    // Validate SOL amounts after currency selection so USDC callers are explicit.
    const amount = Number(amountLamports);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amountLamports must be a positive number for SOL escrow' });
    }

    const result = await req.sdk.buildCreateEscrow(
      clientWallet, agentBinding.agentWallet, agentBinding.agentId, amount,
      description, deadline, nonce || 0, opts,
    );

    res.json({
      transaction: serializeTx(result.transaction),
      escrowPDA: result.escrowPDA.toBase58(),
      descriptionHash: result.descriptionHash.toString('hex'),
      currency: 'SOL',
      network: NETWORK,
      nonce: nonce || 0,
      agentId: agentBinding.agentId,
      agentWallet: agentBinding.agentWallet,
      jobId: agentBinding.job ? agentBinding.job.id : undefined,
      selectedAgentSatpIdentity: agentBinding.satpIdentity,
      identityGateIncluded: true,
      message: 'Sign and submit to create an identity-gated escrow after live-funds release gates are enabled',
    });
  } catch (err) {
    console.error('[Escrow V3] create error:', err.message);
    res.status(err.statusCode || 500).json({
      error: err.message,
      ...(err.details ? err.details : {}),
    });
  }
});

// ── POST /submit-work ──────────────────────────────────────────────────────────
/**
 * Build an unsigned submitWork transaction.
 *
 * Body: {
 *   agentWallet: string,   // Agent's wallet (signer)
 *   escrowPDA: string,     // Escrow account PDA
 *   workProof: string      // Work proof (URL, IPFS CID, description — hashed on-chain)
 * }
 */
router.post('/submit-work', requireSDK, async (req, res) => {
  try {
    const { agentWallet, escrowPDA, workProof } = req.body;

    if (!agentWallet || !escrowPDA || !workProof) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['agentWallet', 'escrowPDA', 'workProof'],
      });
    }
    if (!validatePublicKey(agentWallet)) {
      return res.status(400).json({ error: 'Invalid agentWallet address' });
    }
    if (!validatePublicKey(escrowPDA)) {
      return res.status(400).json({ error: 'Invalid escrowPDA address' });
    }

    const result = await req.sdk.buildSubmitWork(agentWallet, escrowPDA, workProof);

    res.json({
      transaction: serializeTx(result.transaction),
      workHash: result.workHash.toString('hex'),
      network: NETWORK,
      message: 'Agent: sign and submit to record work proof on-chain',
    });
  } catch (err) {
    console.error('[Escrow V3] submit-work error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /release ──────────────────────────────────────────────────────────────
/**
 * Build an unsigned release transaction (client releases full remaining funds).
 *
 * Body: {
 *   clientWallet: string,  // Client's wallet (signer)
 *   agentWallet: string,   // Agent's wallet (receives funds)
 *   escrowPDA: string      // Escrow account PDA
 * }
 */
router.post('/release', requireSDK, async (req, res) => {
  try {
    const { clientWallet, agentWallet, escrowPDA } = req.body;

    if (!clientWallet || !agentWallet || !escrowPDA) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'agentWallet', 'escrowPDA'],
      });
    }
    if (!validatePublicKey(clientWallet)) {
      return res.status(400).json({ error: 'Invalid clientWallet address' });
    }
    if (!validatePublicKey(agentWallet)) {
      return res.status(400).json({ error: 'Invalid agentWallet address' });
    }
    if (!validatePublicKey(escrowPDA)) {
      return res.status(400).json({ error: 'Invalid escrowPDA address' });
    }

    const feeReadback = await getFullReleasePlatformFeeReadback(escrowPDA);
    const transaction = await buildEscrowReleaseTx({ clientWallet, agentWallet, escrowPDA });

    res.json({
      transaction: serializeTx(transaction),
      network: NETWORK,
      releaseAmount: feeReadback.remainingAmountLamports,
      platformFee: {
        ...feeReadback,
        bps: PLATFORM_FEE_BPS,
        collection: 'on-chain',
      },
      message: 'Client: sign and submit to release all remaining funds with platform fee routed on-chain to treasury',
    });
  } catch (err) {
    console.error('[Escrow V3] release error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── POST /partial-release ──────────────────────────────────────────────────────
/**
 * Build an unsigned partialRelease transaction (milestone payment).
 *
 * Body: {
 *   clientWallet: string,    // Client's wallet (signer)
 *   agentWallet: string,     // Agent's wallet (receives funds)
 *   escrowPDA: string,       // Escrow account PDA
 *   amountLamports: number   // Lamports to release for this milestone
 * }
 */
router.post('/partial-release', requireSDK, async (req, res) => {
  try {
    const { clientWallet, agentWallet, escrowPDA, amountLamports } = req.body;

    if (!clientWallet || !agentWallet || !escrowPDA || !amountLamports) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'agentWallet', 'escrowPDA', 'amountLamports'],
      });
    }
    if (!validatePublicKey(clientWallet)) {
      return res.status(400).json({ error: 'Invalid clientWallet address' });
    }
    if (!validatePublicKey(agentWallet)) {
      return res.status(400).json({ error: 'Invalid agentWallet address' });
    }
    if (!validatePublicKey(escrowPDA)) {
      return res.status(400).json({ error: 'Invalid escrowPDA address' });
    }

    let amount;
    try {
      amount = validatePositiveLamports(amountLamports, 'amountLamports');
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }
    const feeSplit = calculatePlatformFeeSplit(amount);

    const transaction = await buildEscrowReleaseTx({
      clientWallet,
      agentWallet,
      escrowPDA,
      amountLamports: amount,
    });

    res.json({
      transaction: serializeTx(transaction),
      milestoneAmount: feeSplit.grossAmountLamports,
      platformFee: {
        source: 'request.amountLamports',
        collection: 'on-chain',
        ...feeSplit,
      },
      network: NETWORK,
      message: 'Client: sign and submit to release milestone payment with platform fee routed on-chain to treasury',
    });
  } catch (err) {
    console.error('[Escrow V3] partial-release error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cancel ───────────────────────────────────────────────────────────────
/**
 * Build an unsigned cancel transaction (client gets refund after deadline).
 *
 * Body: {
 *   clientWallet: string,  // Client's wallet (signer, receives refund)
 *   escrowPDA: string      // Escrow account PDA
 * }
 */
router.post('/cancel', requireSDK, async (req, res) => {
  try {
    const { clientWallet, escrowPDA } = req.body;

    if (!clientWallet || !escrowPDA) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'escrowPDA'],
      });
    }
    if (!validatePublicKey(clientWallet)) {
      return res.status(400).json({ error: 'Invalid clientWallet address' });
    }
    if (!validatePublicKey(escrowPDA)) {
      return res.status(400).json({ error: 'Invalid escrowPDA address' });
    }

    const result = await req.sdk.buildCancelEscrow(clientWallet, escrowPDA);

    res.json({
      transaction: serializeTx(result.transaction),
      network: NETWORK,
      message: 'Client: sign and submit to cancel escrow and reclaim funds (only after deadline)',
    });
  } catch (err) {
    console.error('[Escrow V3] cancel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /dispute ──────────────────────────────────────────────────────────────
/**
 * Build an unsigned raiseDispute transaction (either party, with reason).
 *
 * Body: {
 *   signerWallet: string,  // Client OR Agent wallet (signer)
 *   escrowPDA: string,     // Escrow account PDA
 *   reason: string         // Dispute reason (hashed on-chain as [u8;32])
 * }
 */
router.post('/dispute', requireSDK, async (req, res) => {
  try {
    const { signerWallet, escrowPDA, reason } = req.body;

    if (!signerWallet || !escrowPDA || !reason) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['signerWallet', 'escrowPDA', 'reason'],
      });
    }
    if (!validatePublicKey(signerWallet)) {
      return res.status(400).json({ error: 'Invalid signerWallet address' });
    }
    if (!validatePublicKey(escrowPDA)) {
      return res.status(400).json({ error: 'Invalid escrowPDA address' });
    }

    const result = await req.sdk.buildRaiseDispute(signerWallet, escrowPDA, reason);

    res.json({
      transaction: serializeTx(result.transaction),
      reasonHash: result.reasonHash.toString('hex'),
      network: NETWORK,
      message: 'Sign and submit to raise a dispute. Reason hash stored on-chain.',
    });
  } catch (err) {
    console.error('[Escrow V3] dispute error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /resolve ──────────────────────────────────────────────────────────────
/**
 * Build an unsigned resolveDispute transaction (arbiter splits funds).
 *
 * Body: {
 *   arbiterWallet: string,       // Designated arbiter (signer)
 *   agentWallet: string,         // Agent wallet (receives agentAmountLamports)
 *   clientWallet: string,        // Client wallet (receives clientAmountLamports)
 *   escrowPDA: string,           // Escrow account PDA
 *   agentAmountLamports: number, // Lamports awarded to agent
 *   clientAmountLamports: number // Lamports refunded to client
 * }
 *
 * Note: agentAmountLamports + clientAmountLamports must equal remaining escrow balance.
 */
router.post('/resolve', requireSDK, async (req, res) => {
  try {
    const { arbiterWallet, agentWallet, clientWallet, escrowPDA, agentAmountLamports, clientAmountLamports } = req.body;

    if (!arbiterWallet || !agentWallet || !clientWallet || !escrowPDA ||
        agentAmountLamports === undefined || clientAmountLamports === undefined) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['arbiterWallet', 'agentWallet', 'clientWallet', 'escrowPDA', 'agentAmountLamports', 'clientAmountLamports'],
      });
    }
    if (!validatePublicKey(arbiterWallet)) {
      return res.status(400).json({ error: 'Invalid arbiterWallet address' });
    }
    if (!validatePublicKey(agentWallet)) {
      return res.status(400).json({ error: 'Invalid agentWallet address' });
    }
    if (!validatePublicKey(clientWallet)) {
      return res.status(400).json({ error: 'Invalid clientWallet address' });
    }
    if (!validatePublicKey(escrowPDA)) {
      return res.status(400).json({ error: 'Invalid escrowPDA address' });
    }

    const agentAmt = Number(agentAmountLamports);
    const clientAmt = Number(clientAmountLamports);
    if (!Number.isFinite(agentAmt) || agentAmt < 0) {
      return res.status(400).json({ error: 'agentAmountLamports must be >= 0' });
    }
    if (!Number.isFinite(clientAmt) || clientAmt < 0) {
      return res.status(400).json({ error: 'clientAmountLamports must be >= 0' });
    }
    if (agentAmt === 0 && clientAmt === 0) {
      return res.status(400).json({ error: 'At least one amount must be > 0' });
    }

    const result = await req.sdk.buildResolveDispute(
      arbiterWallet, agentWallet, clientWallet, escrowPDA, agentAmt, clientAmt,
    );

    res.json({
      transaction: serializeTx(result.transaction),
      agentAmount: agentAmt,
      clientAmount: clientAmt,
      network: NETWORK,
      message: 'Arbiter: sign and submit to split disputed escrow funds',
    });
  } catch (err) {
    console.error('[Escrow V3] resolve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /close ────────────────────────────────────────────────────────────────
/**
 * Build an unsigned closeEscrow transaction (reclaim rent after settlement).
 *
 * Body: {
 *   clientWallet: string,  // Client wallet (signer, receives rent)
 *   escrowPDA: string      // Escrow account PDA
 * }
 */
router.post('/close', requireSDK, async (req, res) => {
  try {
    const { clientWallet, escrowPDA } = req.body;

    if (!clientWallet || !escrowPDA) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'escrowPDA'],
      });
    }
    if (!validatePublicKey(clientWallet)) {
      return res.status(400).json({ error: 'Invalid clientWallet address' });
    }
    if (!validatePublicKey(escrowPDA)) {
      return res.status(400).json({ error: 'Invalid escrowPDA address' });
    }

    const result = await req.sdk.buildCloseEscrow(clientWallet, escrowPDA);

    res.json({
      transaction: serializeTx(result.transaction),
      network: NETWORK,
      message: 'Client: sign and submit to close escrow and reclaim rent',
    });
  } catch (err) {
    console.error('[Escrow V3] close error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /extend-deadline ─────────────────────────────────────────────────────
/**
 * Build unsigned extendDeadline transaction.
 * Client extends the escrow deadline (must be Active, new deadline > current).
 *
 * Body: {
 *   clientWallet: string,  // Client wallet (signer)
 *   escrowPDA: string,     // Escrow account PDA
 *   newDeadline: number    // New Unix timestamp (must be > current deadline)
 * }
 */
router.post('/extend-deadline', requireSDK, async (req, res) => {
  try {
    const { clientWallet, escrowPDA, newDeadline } = req.body;

    if (!clientWallet || !escrowPDA || !newDeadline) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'escrowPDA', 'newDeadline'],
      });
    }
    if (!validatePublicKey(clientWallet)) {
      return res.status(400).json({ error: 'Invalid clientWallet address' });
    }
    if (!validatePublicKey(escrowPDA)) {
      return res.status(400).json({ error: 'Invalid escrowPDA address' });
    }
    if (typeof newDeadline !== 'number' || newDeadline <= 0) {
      return res.status(400).json({ error: 'newDeadline must be a positive Unix timestamp' });
    }
    if (newDeadline <= Math.floor(Date.now() / 1000)) {
      return res.status(400).json({ error: 'newDeadline must be in the future' });
    }

    const result = await req.sdk.buildExtendDeadline(clientWallet, escrowPDA, newDeadline);

    res.json({
      transaction: serializeTx(result.transaction),
      network: NETWORK,
      newDeadline,
      newDeadlineISO: new Date(newDeadline * 1000).toISOString(),
      message: 'Client: sign and submit to extend escrow deadline',
    });
  } catch (err) {
    console.error('[Escrow V3] extend-deadline error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:pda ──────────────────────────────────────────────────────────────────
/**
 * Fetch escrow V3 account state from on-chain.
 *
 * Returns full state: client, agent, amount, remaining, status, work proof,
 * dispute info, arbiter, trust requirements, timestamps.
 */
router.get('/:pda', requireSDK, async (req, res) => {
  try {
    const { pda } = req.params;

    // Avoid matching the /pda/derive route
    if (pda === 'pda') return res.status(400).json({ error: 'Use /pda/derive for PDA derivation' });

    let escrowKey;
    try {
      escrowKey = new PublicKey(pda);
    } catch {
      return res.status(400).json({ error: 'Invalid PDA address' });
    }

    const escrow = await req.sdk.getEscrow(escrowKey);
    if (!escrow || escrow.error) {
      return res.status(404).json({ error: 'Escrow account not found or invalid', pda });
    }

    // Add human-readable timestamps
    const enriched = {
      ...escrow,
      network: NETWORK,
      deadlineISO: escrow.deadline ? new Date(escrow.deadline * 1000).toISOString() : null,
      createdAtISO: escrow.createdAt ? new Date(escrow.createdAt * 1000).toISOString() : null,
      workSubmittedAtISO: escrow.workSubmittedAt ? new Date(escrow.workSubmittedAt * 1000).toISOString() : null,
      disputedAtISO: escrow.disputedAt ? new Date(escrow.disputedAt * 1000).toISOString() : null,
      amountSOL: escrow.amount / 1e9,
      releasedSOL: escrow.releasedAmount / 1e9,
      remainingSOL: escrow.remaining / 1e9,
    };

    res.json(enriched);
  } catch (err) {
    console.error('[Escrow V3] get error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /pda/derive ────────────────────────────────────────────────────────────
/**
 * Derive an Escrow V3 PDA from client wallet + description + nonce.
 * No RPC call needed — pure PDA derivation.
 *
 * Query: {
 *   clientWallet: string,   // Client wallet address
 *   client?: string,        // Backward-compatible alias
 *   description: string,    // Job description (will be hashed)
 *   nonce?: number          // Nonce for multiple escrows (default: 0)
 * }
 */
router.get('/pda/derive', async (req, res) => {
  try {
    const description = getSingleQueryString(req.query.description);
    const nonce = getSingleQueryString(req.query.nonce);
    const client = getSingleQueryString(req.query.clientWallet) || getSingleQueryString(req.query.client);
    const normalizedNonce = nonce == null || nonce === '' ? 0 : Number(nonce);

    if (!client || !description) {
      return res.status(400).json({
        error: 'Missing required query params',
        required: ['clientWallet', 'description'],
        optional: ['client', 'nonce'],
      });
    }
    if (!validatePublicKey(client)) {
      return res.status(400).json({ error: 'Invalid client wallet address' });
    }
    if (!Number.isSafeInteger(normalizedNonce) || normalizedNonce < 0) {
      return res.status(400).json({ error: 'nonce must be a non-negative safe integer' });
    }

    const result = getEscrowPdaReadback(client, description, normalizedNonce);

    res.json({
      escrowPDA: result.escrowPDA,
      descriptionHash: result.descriptionHash,
      bump: result.bump,
      client,
      nonce: normalizedNonce,
      network: result.network,
    });
  } catch (err) {
    console.error('[Escrow V3] derive PDA error:', err.message);
    sendSatpProgramIdError(res, err);
  }
});


// ── Constants for query routes ─────────────────────────────────────────────────
const ESCROW_V3_ACCOUNT_SIZE = 339; // 8 discriminator + 331 data

// ── GET /by-client/:wallet ─────────────────────────────────────────────────────
/**
 * List all escrows where the given wallet is the client (payer).
 * Uses getProgramAccounts with memcmp on client field (offset 8).
 */
router.get('/by-client/:wallet', requireSDK, async (req, res) => {
  try {
    const { wallet } = req.params;
    if (!validatePublicKey(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const connection = req.sdk.connection;
    const clientKey = new PublicKey(wallet);
    const escrowProgramId = currentEscrowProgramId();

    const accounts = await connection.getProgramAccounts(escrowProgramId, {
      filters: [
        { dataSize: ESCROW_V3_ACCOUNT_SIZE },
        { memcmp: { offset: 8, bytes: clientKey.toBase58() } },
      ],
    });

    const escrows = accounts.map(({ pubkey, account }) => ({
      escrowPda: pubkey.toBase58(),
      dataLength: account.data.length,
      lamports: account.lamports,
    }));

    res.json({ escrows, count: escrows.length, network: NETWORK });
  } catch (err) {
    console.error('[Escrow V3] by-client error:', err.message);
    sendSatpProgramIdError(res, err);
  }
});

// ── GET /by-agent/:wallet ──────────────────────────────────────────────────────
/**
 * List all escrows where the given wallet is the agent (worker).
 * Uses getProgramAccounts with memcmp on agent field (offset 40).
 */
router.get('/by-agent/:wallet', requireSDK, async (req, res) => {
  try {
    const { wallet } = req.params;
    if (!validatePublicKey(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const connection = req.sdk.connection;
    const agentKey = new PublicKey(wallet);
    const escrowProgramId = currentEscrowProgramId();

    const accounts = await connection.getProgramAccounts(escrowProgramId, {
      filters: [
        { dataSize: ESCROW_V3_ACCOUNT_SIZE },
        { memcmp: { offset: 40, bytes: agentKey.toBase58() } },
      ],
    });

    const escrows = accounts.map(({ pubkey, account }) => ({
      escrowPda: pubkey.toBase58(),
      dataLength: account.data.length,
      lamports: account.lamports,
    }));

    res.json({ escrows, count: escrows.length, network: NETWORK });
  } catch (err) {
    console.error('[Escrow V3] by-agent error:', err.message);
    sendSatpProgramIdError(res, err);
  }
});

// ── GET /by-agent-id/:agentId ──────────────────────────────────────────────────
/**
 * List all escrows for an agent by their SATP agent_id string.
 * Hashes the agent_id to match the on-chain agent_id_hash field (offset 72).
 */
router.get('/by-agent-id/:agentId', requireSDK, async (req, res) => {
  try {
    const { agentId } = req.params;
    if (!agentId || agentId.length > 64) {
      return res.status(400).json({ error: 'Invalid agentId (max 64 chars)' });
    }

    const connection = req.sdk.connection;
    const agentIdHash = crypto.createHash('sha256').update(agentId).digest();
    const escrowProgramId = currentEscrowProgramId();

    const accounts = await connection.getProgramAccounts(escrowProgramId, {
      filters: [
        { dataSize: ESCROW_V3_ACCOUNT_SIZE },
        { memcmp: { offset: 72, bytes: require('bs58').default.encode(agentIdHash) } },
      ],
    });

    const escrows = accounts.map(({ pubkey, account }) => ({
      escrowPda: pubkey.toBase58(),
      dataLength: account.data.length,
      lamports: account.lamports,
    }));

    res.json({
      agentId,
      agentIdHash: agentIdHash.toString('hex'),
      escrows,
      count: escrows.length,
      network: NETWORK,
    });
  } catch (err) {
    console.error('[Escrow V3] by-agent-id error:', err.message);
    sendSatpProgramIdError(res, err);
  }
});

router.__test = {
  buildEscrowReleaseInstruction,
  calculatePlatformFeeSplit,
  deriveSelectedAgentSatpReadback,
  ESCROW_V3_ACCOUNT_DISCRIMINATOR,
  parseFullReleaseAmountReadback,
  parseFullReleaseAmountReadbackFromAccountInfo,
  requireLiveFeeRoutingSupport,
  resolveEscrowAgentBinding,
  resolveEscrowAgentId,
  resolveProfileSolanaWallet,
  validatePositiveLamports,
};

module.exports = router;
