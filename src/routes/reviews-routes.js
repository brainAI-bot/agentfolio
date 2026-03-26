/**
 * SATP Reviews V3 API Routes — On-chain job-scoped reviews
 * 
 * Endpoints:
 *   POST /api/reviews/submit    — Build unsigned submitReview TX
 *   POST /api/reviews/respond   — Build unsigned respondToReview TX
 *   GET  /api/reviews/:pda      — Fetch review state from chain
 *   GET  /api/reviews/pda/derive — Derive review PDA from job + reviewer
 * 
 * All POST endpoints return unsigned transactions (base64) for client-side wallet signing.
 * Server-stateless — no private keys needed.
 */

const { Router } = require('express');
const { PublicKey } = require('@solana/web3.js');
const { SATPSDK, getReviewV3PDA } = require('../../satp-client/src/index');

const router = Router();

// Initialize SDK (uses env or defaults to devnet)
const network = process.env.SOLANA_NETWORK || 'devnet';
const sdk = new SATPSDK({ network, rpcUrl: process.env.SOLANA_RPC_URL });

/**
 * POST /api/reviews/submit
 * Build an unsigned submitReview transaction.
 * 
 * Body:
 *   reviewer: string (wallet address)
 *   reviewerIdentity: string (reviewer's SATP Identity PDA)
 *   jobPDA: string (job/escrow account PDA)
 *   rating: number (1-5, overall rating)
 *   quality: number (1-5)
 *   reliability: number (1-5)
 *   communication: number (1-5)
 *   commentUri: string (URI to off-chain comment, max 200 chars)
 *   commentHash: string (hex-encoded SHA256 hash of comment, or raw text to hash)
 */
router.post('/submit', async (req, res) => {
  try {
    const { reviewer, reviewerIdentity, jobPDA, rating, quality, reliability, communication, commentUri, commentHash } = req.body;

    if (!reviewer || !reviewerIdentity || !jobPDA || !rating || !commentUri) {
      return res.status(400).json({
        error: 'Missing required fields: reviewer, reviewerIdentity, jobPDA, rating, commentUri',
      });
    }

    // Validate rating ranges
    const ratings = {
      rating: Number(rating),
      quality: Number(quality || rating),
      reliability: Number(reliability || rating),
      communication: Number(communication || rating),
    };

    for (const [key, val] of Object.entries(ratings)) {
      if (val < 1 || val > 5 || !Number.isInteger(val)) {
        return res.status(400).json({ error: `${key} must be an integer 1-5` });
      }
    }

    if (commentUri.length > 200) {
      return res.status(400).json({ error: 'commentUri must be <= 200 characters' });
    }

    // Hash or pass through
    const hashInput = commentHash || commentUri;

    const result = await sdk.buildSubmitReview(
      reviewer,
      reviewerIdentity,
      jobPDA,
      ratings,
      commentUri,
      hashInput,
    );

    const txBase64 = result.transaction.serialize({ requireAllSignatures: false }).toString('base64');

    res.json({
      transaction: txBase64,
      reviewPDA: result.reviewPDA.toBase58(),
      message: 'Sign and send this transaction with your wallet',
    });
  } catch (e) {
    console.error('POST /api/reviews/submit error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/reviews/respond
 * Build an unsigned respondToReview transaction.
 * 
 * Body:
 *   responder: string (wallet address of reviewed party)
 *   reviewPDA: string (review account PDA)
 *   responseUri: string (URI to off-chain response, max 200 chars)
 *   responseHash: string (hex hash or raw text to hash)
 */
router.post('/respond', async (req, res) => {
  try {
    const { responder, reviewPDA, responseUri, responseHash } = req.body;

    if (!responder || !reviewPDA || !responseUri) {
      return res.status(400).json({
        error: 'Missing required fields: responder, reviewPDA, responseUri',
      });
    }

    if (responseUri.length > 200) {
      return res.status(400).json({ error: 'responseUri must be <= 200 characters' });
    }

    const hashInput = responseHash || responseUri;

    const result = await sdk.buildRespondToReview(
      responder,
      reviewPDA,
      responseUri,
      hashInput,
    );

    const txBase64 = result.transaction.serialize({ requireAllSignatures: false }).toString('base64');

    res.json({
      transaction: txBase64,
      message: 'Sign and send this transaction with your wallet',
    });
  } catch (e) {
    console.error('POST /api/reviews/respond error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/reviews/:pda
 * Fetch review state from on-chain.
 */
router.get('/:pda', async (req, res) => {
  try {
    const { pda } = req.params;

    // Validate pubkey format
    try { new PublicKey(pda); } catch {
      return res.status(400).json({ error: 'Invalid PDA format' });
    }

    const review = await sdk.getReview(pda);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    res.json(review);
  } catch (e) {
    console.error('GET /api/reviews/:pda error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/reviews/pda/derive
 * Derive review PDA from job + reviewer.
 * 
 * Query params:
 *   job: string (job/escrow account pubkey)
 *   reviewer: string (reviewer wallet pubkey)
 */
router.get('/pda/derive', async (req, res) => {
  try {
    const { job, reviewer } = req.query;

    if (!job || !reviewer) {
      return res.status(400).json({ error: 'Required query params: job, reviewer' });
    }

    try { new PublicKey(job); } catch {
      return res.status(400).json({ error: 'Invalid job pubkey' });
    }
    try { new PublicKey(reviewer); } catch {
      return res.status(400).json({ error: 'Invalid reviewer pubkey' });
    }

    const [pda, bump] = getReviewV3PDA(job, reviewer, network);

    res.json({
      pda: pda.toBase58(),
      bump,
      job,
      reviewer,
    });
  } catch (e) {
    console.error('GET /api/reviews/pda/derive error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
