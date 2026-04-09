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
  SATPV3SDK = mod.SATPV3SDK;
  if (!SATPV3SDK) throw new Error('SATPV3SDK not exported');
  console.log('[Rep/Val V3 Routes] V3 SDK loaded (SATPV3SDK)');
} catch (e1) {
  try {
    const mod = require('satp-client');
    SATPV3SDK = mod.SATPV3SDK;
    if (!SATPV3SDK) throw new Error('SATPV3SDK not exported from satp-client');
    console.log('[Rep/Val V3 Routes] V3 SDK loaded from npm (SATPV3SDK)');
  } catch (e2) {
    console.warn('[Rep/Val V3 Routes] SATP V3 SDK not found. Endpoints disabled.');
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

const INTERNAL_API_BASE = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3333';

async function getNormalizedProfileTrust(agentId) {
  try {
    const res = await globalThis.fetch(`${INTERNAL_API_BASE}/api/profile/${encodeURIComponent(agentId)}/trust-score`);
    if (!res.ok) return null;
    const payload = await res.json();
    return payload?.data || null;
  } catch (_) {
    return null;
  }
}

function applyNormalizedTrust(raw, normalized) {
  if (!raw || !normalized) return raw;
  const normalizedScore = normalized.reputationScore ?? raw.reputationScore ?? 0;
  const normalizedLabel = normalized.verificationLabel || raw.verificationLabel || raw.tierLabel || null;
  return {
    ...raw,
    reputationScore: normalizedScore,
    verificationLevel: normalized.verificationLevel ?? raw.verificationLevel,
    verificationLabel: normalizedLabel,
    tier: normalizedLabel,
    tierLabel: normalizedLabel,
    reputationPct: (normalizedScore / 10).toFixed(2),
    source: 'normalized-profile-trust',
  };
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

    // Try live RPC first, fall back to cached v3-score-service on 429/timeout
    let identity = null;
    try {
      identity = await req.sdk.getGenesisRecord(agentId);
    } catch (rpcErr) {
      console.warn('[Reputation V3] RPC failed, trying cache:', rpcErr.message?.slice(0, 80));
    }

    // Fallback: use backend's v3-score-service cache
    if (!identity) {
      try {
        const { getV3Score } = require('../../v3-score-service');
        const cached = await getV3Score(agentId);
        if (cached) {
          const { deriveGenesisPda } = require('@brainai/satp-v3');
          const [pda] = deriveGenesisPda(agentId);
          return res.json({
            agentId,
            pda: pda.toBase58(),
            reputationScore: cached.reputationScore || 0,
            verificationLevel: cached.verificationLevel || 0,
            tier: null,
            tierLabel: cached.verificationLabel || null,
            authority: cached.authority || '',
            isBorn: cached.isBorn || false,
            network: NETWORK,
            source: 'cache',
          });
        }
      } catch (cacheErr) {
        // Cache also unavailable
      }
      return res.status(404).json({ error: 'Agent not found', agentId });
    }

    const payload = applyNormalizedTrust({
      agentId,
      pda: identity.pda,
      reputationScore: identity.reputationScore || 0,
      verificationLevel: identity.verificationLevel || 0,
      tier: identity.tier || null,
      tierLabel: identity.tierLabel || null,
      verificationLabel: identity.tierLabel || null,
      authority: identity.authority,
      isBorn: identity.isBorn || false,
      network: NETWORK,
    }, await getNormalizedProfileTrust(agentId))

    res.json(payload);
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
    const normalized = applyNormalizedTrust({
      agentId,
      pda: identity.pda,
      reputationScore: identity.reputationScore || 0,
      verificationLevel: identity.verificationLevel || 0,
      verificationLabel: identity.tierLabel || LEVEL_LABELS[identity.verificationLevel] || 'Unknown',
      authority: identity.authority,
      isBorn: identity.isBorn || false,
      network: NETWORK,
    }, await getNormalizedProfileTrust(agentId));

    res.json({
      agentId,
      pda: identity.pda,
      verificationLevel: normalized.verificationLevel || 0,
      levelLabel: normalized.verificationLabel || LEVEL_LABELS[normalized.verificationLevel] || 'Unknown',
      isBorn: normalized.isBorn || false,
      authority: identity.authority,
      network: NETWORK,
      rawVerificationLevel: identity.verificationLevel || 0,
      rawLevelLabel: LEVEL_LABELS[identity.verificationLevel] || 'Unknown',
      source: normalized.source || 'v3-onchain',
    });
  } catch (err) {
    console.error('[Validation V3] get error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
