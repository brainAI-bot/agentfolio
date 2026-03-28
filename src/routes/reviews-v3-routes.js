/**
 * SATP Reviews V3 API Routes — On-Chain Agent Reviews with Self-Review Prevention
 *
 * Endpoints:
 *   POST /api/v3/reviews/init-counter    — Initialize review counter for an agent
 *   POST /api/v3/reviews/create          — Build unsigned createReview TX
 *   POST /api/v3/reviews/create-safe     — Build unsigned createReview TX with self-review prevention
 *   POST /api/v3/reviews/update          — Build unsigned updateReview TX
 *   POST /api/v3/reviews/delete          — Build unsigned deleteReview TX (soft-delete)
 *   GET  /api/v3/reviews/:agentId/:reviewer — Fetch review by agent + reviewer
 *   GET  /api/v3/reviews/count/:agentId  — Fetch review count for an agent
 *
 * V3 upgrades over V1:
 *   - CRUD: create, update, delete (soft-delete)
 *   - On-chain self-review prevention via identity program CPI
 *   - Agent-scoped reviews (not job-scoped)
 *   - Review counter per agent
 *   - Optional metadata field (max 256 chars)
 *   - PDA seeds: ["review_v3", SHA256(agentId), reviewer]
 *
 * All POST endpoints return unsigned transactions (base64) for client-side wallet signing.
 * Server is stateless — no private keys.
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
    console.warn('[Reviews V3 Routes] SATP V3 SDK not found. Reviews V3 endpoints disabled.');
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
      error: 'Reviews V3 SDK not available',
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

// ── POST /init-counter ─────────────────────────────────────────────────────────
/**
 * Initialize the review counter for an agent (required before first review).
 *
 * Body: {
 *   payerWallet: string,  // Payer wallet (signer)
 *   agentId: string       // Agent being reviewed
 * }
 */
router.post('/init-counter', requireSDK, async (req, res) => {
  try {
    const { payerWallet, agentId } = req.body;

    if (!payerWallet || !agentId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['payerWallet', 'agentId'],
      });
    }
    if (!validatePublicKey(payerWallet)) {
      return res.status(400).json({ error: 'Invalid payerWallet address' });
    }
    if (agentId.length > 64) {
      return res.status(400).json({ error: 'agentId must be <= 64 characters' });
    }

    const result = await req.sdk.buildInitReviewCounter(payerWallet, agentId);

    res.json({
      transaction: serializeTx(result.transaction),
      counterPDA: result.counterPDA.toBase58(),
      agentId,
      network: NETWORK,
      message: 'Sign and submit to initialize review counter for this agent',
    });
  } catch (err) {
    console.error('[Reviews V3] init-counter error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /create ───────────────────────────────────────────────────────────────
/**
 * Build an unsigned createReview transaction.
 *
 * Body: {
 *   reviewerWallet: string,  // Reviewer wallet (signer)
 *   agentId: string,         // Agent being reviewed
 *   rating: number,          // 1-5 rating
 *   reviewText: string,      // Review text (max 512 chars)
 *   metadata?: string        // Optional JSON metadata (max 256 chars)
 * }
 */
router.post('/create', requireSDK, async (req, res) => {
  try {
    const { reviewerWallet, agentId, rating, reviewText, metadata } = req.body;

    if (!reviewerWallet || !agentId || !rating || !reviewText) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['reviewerWallet', 'agentId', 'rating', 'reviewText'],
        optional: ['metadata'],
      });
    }
    if (!validatePublicKey(reviewerWallet)) {
      return res.status(400).json({ error: 'Invalid reviewerWallet address' });
    }

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'rating must be an integer 1-5' });
    }
    if (reviewText.length > 512) {
      return res.status(400).json({ error: 'reviewText must be <= 512 characters' });
    }
    if (metadata && metadata.length > 256) {
      return res.status(400).json({ error: 'metadata must be <= 256 characters' });
    }

    const result = await req.sdk.buildCreateReview(
      reviewerWallet, agentId, ratingNum, reviewText, metadata || '',
    );

    res.json({
      transaction: serializeTx(result.transaction),
      reviewPDA: result.reviewPDA.toBase58(),
      agentId,
      network: NETWORK,
      message: 'Sign and submit to create a review for this agent',
    });
  } catch (err) {
    console.error('[Reviews V3] create error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /create-safe ──────────────────────────────────────────────────────────
/**
 * Build an unsigned createReview transaction with self-review prevention.
 * Automatically resolves the agent's identity PDA and passes it to the on-chain
 * self-review check.
 *
 * Body: {
 *   reviewerWallet: string,  // Reviewer wallet (signer)
 *   agentId: string,         // Agent being reviewed
 *   rating: number,          // 1-5 rating
 *   reviewText: string,      // Review text (max 512 chars)
 *   metadata?: string        // Optional JSON metadata (max 256 chars)
 * }
 */
router.post('/create-safe', requireSDK, async (req, res) => {
  try {
    const { reviewerWallet, agentId, rating, reviewText, metadata } = req.body;

    if (!reviewerWallet || !agentId || !rating || !reviewText) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['reviewerWallet', 'agentId', 'rating', 'reviewText'],
        optional: ['metadata'],
      });
    }
    if (!validatePublicKey(reviewerWallet)) {
      return res.status(400).json({ error: 'Invalid reviewerWallet address' });
    }

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'rating must be an integer 1-5' });
    }
    if (reviewText.length > 512) {
      return res.status(400).json({ error: 'reviewText must be <= 512 characters' });
    }
    if (metadata && metadata.length > 256) {
      return res.status(400).json({ error: 'metadata must be <= 256 characters' });
    }

    const result = await req.sdk.buildCreateReviewWithSelfCheck(
      reviewerWallet, agentId, ratingNum, reviewText, metadata || '',
    );

    res.json({
      transaction: serializeTx(result.transaction),
      reviewPDA: result.reviewPDA.toBase58(),
      agentId,
      selfReviewPrevention: true,
      network: NETWORK,
      message: 'Sign and submit to create a review (self-review prevention enabled)',
    });
  } catch (err) {
    console.error('[Reviews V3] create-safe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /update ───────────────────────────────────────────────────────────────
/**
 * Build an unsigned updateReview transaction (reviewer only).
 *
 * Body: {
 *   reviewerWallet: string,  // Original reviewer wallet (signer)
 *   reviewPDA: string,       // Review account PDA
 *   rating?: number,         // New rating (1-5), null to keep
 *   reviewText?: string,     // New text (max 512), null to keep
 *   metadata?: string        // New metadata (max 256), null to keep
 * }
 */
router.post('/update', requireSDK, async (req, res) => {
  try {
    const { reviewerWallet, reviewPDA, rating, reviewText, metadata } = req.body;

    if (!reviewerWallet || !reviewPDA) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['reviewerWallet', 'reviewPDA'],
        optional: ['rating', 'reviewText', 'metadata'],
      });
    }
    if (!validatePublicKey(reviewerWallet)) {
      return res.status(400).json({ error: 'Invalid reviewerWallet address' });
    }
    if (!validatePublicKey(reviewPDA)) {
      return res.status(400).json({ error: 'Invalid reviewPDA address' });
    }

    const updates = {};
    if (rating != null) {
      const ratingNum = Number(rating);
      if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ error: 'rating must be an integer 1-5' });
      }
      updates.rating = ratingNum;
    }
    if (reviewText != null) {
      if (reviewText.length > 512) {
        return res.status(400).json({ error: 'reviewText must be <= 512 characters' });
      }
      updates.reviewText = reviewText;
    }
    if (metadata != null) {
      if (metadata.length > 256) {
        return res.status(400).json({ error: 'metadata must be <= 256 characters' });
      }
      updates.metadata = metadata;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'At least one of rating, reviewText, or metadata must be provided' });
    }

    const result = await req.sdk.buildUpdateReview(reviewerWallet, reviewPDA, updates);

    res.json({
      transaction: serializeTx(result.transaction),
      reviewPDA,
      updatedFields: Object.keys(updates),
      network: NETWORK,
      message: 'Sign and submit to update your review',
    });
  } catch (err) {
    console.error('[Reviews V3] update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /delete ───────────────────────────────────────────────────────────────
/**
 * Build an unsigned deleteReview transaction (soft-delete, reviewer only).
 *
 * Body: {
 *   reviewerWallet: string,  // Original reviewer wallet (signer)
 *   reviewPDA: string        // Review account PDA
 * }
 */
router.post('/delete', requireSDK, async (req, res) => {
  try {
    const { reviewerWallet, reviewPDA } = req.body;

    if (!reviewerWallet || !reviewPDA) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['reviewerWallet', 'reviewPDA'],
      });
    }
    if (!validatePublicKey(reviewerWallet)) {
      return res.status(400).json({ error: 'Invalid reviewerWallet address' });
    }
    if (!validatePublicKey(reviewPDA)) {
      return res.status(400).json({ error: 'Invalid reviewPDA address' });
    }

    const result = await req.sdk.buildDeleteReview(reviewerWallet, reviewPDA);

    res.json({
      transaction: serializeTx(result.transaction),
      reviewPDA,
      network: NETWORK,
      message: 'Sign and submit to soft-delete your review',
    });
  } catch (err) {
    console.error('[Reviews V3] delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /count/:agentId ────────────────────────────────────────────────────────
/**
 * Fetch the review count for an agent.
 * NOTE: Must be defined BEFORE /:agentId/:reviewer to avoid "count" matching as agentId.
 */
router.get('/count/:agentId', requireSDK, async (req, res) => {
  try {
    const { agentId } = req.params;

    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }

    const counter = await req.sdk.getReviewCount(agentId);
    if (!counter) {
      return res.status(404).json({
        error: 'Review counter not found (no reviews yet or counter not initialized)',
        agentId,
      });
    }

    res.json({
      ...counter,
      network: NETWORK,
    });
  } catch (err) {
    console.error('[Reviews V3] get count error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:agentId/:reviewer ────────────────────────────────────────────────────
/**
 * Fetch a review by agent ID + reviewer wallet.
 */
router.get('/:agentId/:reviewer', requireSDK, async (req, res) => {
  try {
    const { agentId, reviewer } = req.params;

    if (!agentId || !reviewer) {
      return res.status(400).json({ error: 'Both agentId and reviewer are required' });
    }
    if (!validatePublicKey(reviewer)) {
      return res.status(400).json({ error: 'Invalid reviewer wallet address' });
    }

    const review = await req.sdk.getReview(agentId, reviewer);
    if (!review) {
      return res.status(404).json({ error: 'Review not found', agentId, reviewer });
    }

    // Enrich with ISO timestamps
    const enriched = {
      ...review,
      network: NETWORK,
      createdAtISO: review.createdAt ? new Date(review.createdAt * 1000).toISOString() : null,
      updatedAtISO: review.updatedAt ? new Date(review.updatedAt * 1000).toISOString() : null,
    };

    res.json(enriched);
  } catch (err) {
    console.error('[Reviews V3] get review error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
