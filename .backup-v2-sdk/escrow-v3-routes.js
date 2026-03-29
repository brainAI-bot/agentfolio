/**
 * SATP Escrow V3 API Routes — Identity-Verified On-Chain Escrow
 *
 * Endpoints:
 *   POST /api/v3/escrow/create          — Build unsigned createEscrow TX (identity-verified)
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
 * All POST endpoints return unsigned transactions (base64) for client-side wallet signing.
 * Server is stateless — no private keys.
 *
 * brainChain — 2026-03-28
 */

const { Router } = require('express');
const { PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');

const router = Router();

// ── SDK Setup ──────────────────────────────────────────────────────────────────
let SATPV3SDK;
let sdkInstance = null;

try {
  // Try relative path (deployed in AgentFolio src/routes/)
  const mod = require('../../satp-client/src/index');
  SATPV3SDK = mod.SATPV3SDK || mod.SATPSDK;
} catch (e1) {
  try {
    // Try npm package
    const mod = require('satp-client');
    SATPV3SDK = mod.SATPV3SDK || mod.SATPSDK;
  } catch (e2) {
    console.warn('[Escrow V3 Routes] SATP V3 SDK not found. Escrow V3 endpoints disabled.');
    console.warn('  Tried: ../../satp-client/src/index, satp-client');
  }
}

const NETWORK = process.env.SATP_NETWORK || process.env.SOLANA_NETWORK || 'mainnet';
const RPC_URL = process.env.SOLANA_RPC_URL || null;

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
      hint: 'satp-client package or source not found on this server',
    });
  }
  req.sdk = sdk;
  next();
}

function validatePublicKey(value, fieldName) {
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function serializeTx(tx) {
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(serialized).toString('base64');
}

function hashIfNeeded(input) {
  if (Buffer.isBuffer(input) && input.length === 32) return input;
  if (typeof input === 'string' && /^[0-9a-f]{64}$/i.test(input)) {
    return Buffer.from(input, 'hex');
  }
  return crypto.createHash('sha256')
    .update(typeof input === 'string' ? input : Buffer.from(input))
    .digest();
}

// ── POST /create ───────────────────────────────────────────────────────────────
/**
 * Build an unsigned createEscrow transaction with SATP V3 identity verification.
 *
 * Body: {
 *   clientWallet: string,           // Client's wallet (payer + signer)
 *   agentWallet: string,            // Agent's wallet
 *   agentId: string,                // Agent's SATP V3 identity ID (for Genesis Record lookup)
 *   amountLamports: number,         // SOL amount in lamports
 *   description: string,            // Job description (hashed on-chain as [u8;32])
 *   deadlineUnix: number,           // Unix timestamp deadline
 *   nonce?: number,                 // Nonce for multiple escrows (default: 0)
 *   arbiter?: string,               // Third-party arbiter wallet (default: client)
 *   minVerificationLevel?: number,  // 0-5 minimum trust level (default: 0)
 *   requireBorn?: boolean           // Require agent has completed burn-to-become (default: false)
 * }
 */
router.post('/create', requireSDK, async (req, res) => {
  try {
    const {
      clientWallet, agentWallet, agentId, amountLamports,
      description, deadlineUnix, nonce, arbiter,
      minVerificationLevel, requireBorn,
    } = req.body;

    // Required fields
    if (!clientWallet || !agentWallet || !agentId || !amountLamports || !description || !deadlineUnix) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['clientWallet', 'agentWallet', 'agentId', 'amountLamports', 'description', 'deadlineUnix'],
        optional: ['nonce', 'arbiter', 'minVerificationLevel', 'requireBorn'],
      });
    }

    // Validate wallets
    if (!validatePublicKey(clientWallet, 'clientWallet')) {
      return res.status(400).json({ error: 'Invalid clientWallet address' });
    }
    if (!validatePublicKey(agentWallet, 'agentWallet')) {
      return res.status(400).json({ error: 'Invalid agentWallet address' });
    }
    if (arbiter && !validatePublicKey(arbiter, 'arbiter')) {
      return res.status(400).json({ error: 'Invalid arbiter address' });
    }

    // Validate amounts
    const amount = Number(amountLamports);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amountLamports must be a positive number' });
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

    const result = await req.sdk.buildCreateEscrow(
      clientWallet, agentWallet, agentId, amount,
      description, deadline, nonce || 0, opts,
    );

    res.json({
      transaction: serializeTx(result.transaction),
      escrowPDA: result.escrowPDA.toBase58(),
      descriptionHash: result.descriptionHash.toString('hex'),
      network: NETWORK,
      nonce: nonce || 0,
      identityVerified: true,
      message: 'Sign and submit to create identity-verified escrow',
    });
  } catch (err) {
    console.error('[Escrow V3] create error:', err.message);
    res.status(500).json({ error: err.message });
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

    const result = await req.sdk.buildEscrowRelease(clientWallet, agentWallet, escrowPDA);

    res.json({
      transaction: serializeTx(result.transaction),
      network: NETWORK,
      message: 'Client: sign and submit to release all remaining funds to agent',
    });
  } catch (err) {
    console.error('[Escrow V3] release error:', err.message);
    res.status(500).json({ error: err.message });
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

    const amount = Number(amountLamports);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amountLamports must be a positive number' });
    }

    const result = await req.sdk.buildPartialRelease(clientWallet, agentWallet, escrowPDA, amount);

    res.json({
      transaction: serializeTx(result.transaction),
      milestoneAmount: amount,
      network: NETWORK,
      message: 'Client: sign and submit to release milestone payment to agent',
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
 *   client: string,         // Client wallet address
 *   description: string,    // Job description (will be hashed)
 *   nonce?: number          // Nonce for multiple escrows (default: 0)
 * }
 */
router.get('/pda/derive', requireSDK, async (req, res) => {
  try {
    const { client, description, nonce } = req.query;

    if (!client || !description) {
      return res.status(400).json({
        error: 'Missing required query params',
        required: ['client', 'description'],
        optional: ['nonce'],
      });
    }
    if (!validatePublicKey(client)) {
      return res.status(400).json({ error: 'Invalid client wallet address' });
    }

    const result = req.sdk.getEscrowPDA(client, description, Number(nonce) || 0);

    res.json({
      escrowPDA: result.escrowPDA,
      descriptionHash: result.descriptionHash,
      bump: result.bump,
      client,
      nonce: Number(nonce) || 0,
      network: NETWORK,
    });
  } catch (err) {
    console.error('[Escrow V3] derive PDA error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── Constants for query routes ─────────────────────────────────────────────────
const ESCROW_V3_PROGRAM_ID = new PublicKey('HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C');
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

    const accounts = await connection.getProgramAccounts(ESCROW_V3_PROGRAM_ID, {
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
    res.status(500).json({ error: err.message });
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

    const accounts = await connection.getProgramAccounts(ESCROW_V3_PROGRAM_ID, {
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
    res.status(500).json({ error: err.message });
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

    const accounts = await connection.getProgramAccounts(ESCROW_V3_PROGRAM_ID, {
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
