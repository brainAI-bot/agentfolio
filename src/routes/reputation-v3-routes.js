/**
 * SATP Reputation & Validation V3 API Routes — Permissionless Recompute
 *
 * Endpoints:
 *   POST /api/v3/reputation/recompute   — Build unsigned recomputeReputation TX
 *   POST /api/v3/validation/recompute   — Build unsigned recomputeLevel TX
 *   GET  /api/v3/reputation/:agentId    — Fetch agent's reputation data from Genesis Record
 *   GET  /api/v3/validation/:agentId    — Fetch agent's verification level from Genesis Record
 *
 * V3 reputation and validation are permissionless CPI programs:
 *   - Anyone can trigger a recompute by passing review/attestation accounts
 *   - Programs CPI into identity_v3 to update Genesis Record
 *   - No authority needed — scoring is deterministic from on-chain data
 *
 * brainChain — 2026-03-28
 */

const { Router } = require('express');
const { PublicKey } = require('@solana/web3.js');

const router = Router();

// ── SDK Setup ──────────────────────────────────────────────────────────────────
let SATPV3SDK;
let sdkInstance = null;

try {
  const mod = require('../../satp-client/src/index');
  SATPV3SDK = mod.SATPV3SDK || mod.SATPSDK;
} catch (e1) {
  try {
    const mod = require('satp-client');
    SATPV3SDK = mod.SATPV3SDK || mod.SATPSDK;
  } catch (e2) {
    console.warn('[Rep/Val V3 Routes] SATP V3 SDK not found. Endpoints disabled.');
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

function requireSDK(req, res, next) {
  const sdk = getSDK();
  if (!sdk) {
    return res.status(503).json({
      error: 'SATP V3 SDK not available',
      hint: 'satp-client package or source not found on this server',
    });
  }
  req.sdk = sdk;
  next();
}

function validatePublicKey(value) {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function serializeTx(tx) {
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(serialized).toString('base64');
}

// ── POST /reputation/recompute ─────────────────────────────────────────────────
/**
 * Build an unsigned recomputeReputation transaction.
 * Permissionless: anyone can trigger a reputation recalculation.
 *
 * Body: {
 *   callerWallet: string,         // Caller wallet (signer, fee payer)
 *   agentId: string,              // Agent whose reputation to recompute
 *   reviewAccounts?: string[]     // Optional: review PDAs to include in calculation
 * }
 */
router.post('/reputation/recompute', requireSDK, async (req, res) => {
  try {
    const { callerWallet, agentId, reviewAccounts } = req.body;

    if (!callerWallet || !agentId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['callerWallet', 'agentId'],
        optional: ['reviewAccounts'],
      });
    }
    if (!validatePublicKey(callerWallet)) {
      return res.status(400).json({ error: 'Invalid callerWallet address' });
    }

    // Validate review account addresses
    const reviewPDAs = (reviewAccounts || []).map(addr => {
      if (!validatePublicKey(addr)) {
        throw new Error(`Invalid review account address: ${addr}`);
      }
      return new PublicKey(addr);
    });

    const result = await req.sdk.buildRecomputeReputation(
      callerWallet, agentId, reviewPDAs,
    );

    res.json({
      transaction: serializeTx(result.transaction),
      agentId,
      reviewAccountsIncluded: reviewPDAs.length,
      network: NETWORK,
      message: 'Sign and submit to trigger reputation recompute (permissionless)',
    });
  } catch (err) {
    console.error('[Reputation V3] recompute error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /validation/recompute ─────────────────────────────────────────────────
/**
 * Build an unsigned recomputeLevel transaction.
 * Permissionless: anyone can trigger a verification level recalculation.
 *
 * Body: {
 *   callerWallet: string,            // Caller wallet (signer, fee payer)
 *   agentId: string,                 // Agent whose level to recompute
 *   attestationAccounts?: string[]   // Optional: attestation PDAs to include
 * }
 */
router.post('/validation/recompute', requireSDK, async (req, res) => {
  try {
    const { callerWallet, agentId, attestationAccounts } = req.body;

    if (!callerWallet || !agentId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['callerWallet', 'agentId'],
        optional: ['attestationAccounts'],
      });
    }
    if (!validatePublicKey(callerWallet)) {
      return res.status(400).json({ error: 'Invalid callerWallet address' });
    }

    const attestPDAs = (attestationAccounts || []).map(addr => {
      if (!validatePublicKey(addr)) {
        throw new Error(`Invalid attestation account address: ${addr}`);
      }
      return new PublicKey(addr);
    });

    const result = await req.sdk.buildRecomputeLevel(
      callerWallet, agentId, attestPDAs,
    );

    res.json({
      transaction: serializeTx(result.transaction),
      agentId,
      attestationAccountsIncluded: attestPDAs.length,
      network: NETWORK,
      message: 'Sign and submit to trigger verification level recompute (permissionless)',
    });
  } catch (err) {
    console.error('[Validation V3] recompute error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /reputation/:agentId ───────────────────────────────────────────────────
/**
 * Fetch an agent's reputation data from their Genesis Record.
 */
router.get('/reputation/:agentId', requireSDK, async (req, res) => {
  try {
    const { agentId } = req.params;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }

    const identity = await req.sdk.getGenesisRecord(agentId);
    if (!identity) {
      return res.status(404).json({ error: 'Agent not found', agentId });
    }

    res.json({
      agentId,
      pda: identity.pda,
      reputationScore: identity.reputationScore || 0,
      verificationLevel: identity.verificationLevel || 0,
      tier: identity.tier || null,
      tierLabel: identity.tierLabel || null,
      authority: identity.authority,
      isBorn: identity.isBorn || false,
      network: NETWORK,
    });
  } catch (err) {
    console.error('[Reputation V3] get error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /validation/:agentId ───────────────────────────────────────────────────
/**
 * Fetch an agent's verification level from their Genesis Record.
 */
router.get('/validation/:agentId', requireSDK, async (req, res) => {
  try {
    const { agentId } = req.params;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }

    const identity = await req.sdk.getGenesisRecord(agentId);
    if (!identity) {
      return res.status(404).json({ error: 'Agent not found', agentId });
    }

    const LEVEL_LABELS = ['Unverified', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];

    res.json({
      agentId,
      pda: identity.pda,
      verificationLevel: identity.verificationLevel || 0,
      levelLabel: LEVEL_LABELS[identity.verificationLevel] || 'Unknown',
      isBorn: identity.isBorn || false,
      authority: identity.authority,
      network: NETWORK,
    });
  } catch (err) {
    console.error('[Validation V3] get error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
