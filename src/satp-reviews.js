/**
 * SATP Reviews Module — On-chain review/rating system for AgentFolio
 * Program IDs from SATP deployment (mainnet)
 */
const Database = require('better-sqlite3');
const { PublicKey } = require('@solana/web3.js');
const path = require('path');
const crypto = require('crypto');

// SATP Program IDs
const { getReviewsForProfile: getOnChainReviews } = require('./onchain-reviews');

// V2 Program IDs (kept for backward compat)
const PROGRAM_IDS = {
  reviews: new PublicKey('8b2jb9U9whNjRWrCbBVR26AqhkPzXZL3yjBuAzauPYBy'),
  identity: new PublicKey('BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr'),
  reputation: new PublicKey('TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh'),
  escrow: new PublicKey('STyY8w4ZHws3X1AMoocWuDYBoogVDwvymPy8Wifx5TH'),
};

// V3 Program IDs
let V3_PROGRAM_IDS;
try {
  const { getV3ProgramIds } = require('./satp-client/src/v3-pda');
  V3_PROGRAM_IDS = getV3ProgramIds('mainnet');
  console.log('[SATP Reviews] V3 program IDs loaded');
} catch (e) {
  console.warn('[SATP Reviews] V3 program IDs not available:', e.message);
}

// --- SQLite Setup ---
const DB_PATH = path.join(__dirname, '..', 'data', 'satp-reviews.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL,
    reviewee_id TEXT NOT NULL,
    job_id TEXT,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    tx_signature TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews(reviewer_id);
`);

const insertReview = db.prepare(`
  INSERT INTO reviews (id, reviewer_id, reviewee_id, job_id, rating, comment, tx_signature)
  VALUES (@id, @reviewer_id, @reviewee_id, @job_id, @rating, @comment, @tx_signature)
`);

const getReviewsByAgent = db.prepare(`
  SELECT * FROM reviews WHERE reviewee_id = ? ORDER BY created_at DESC
`);

const getStats = db.prepare(`
  SELECT 
    COUNT(*) as total_reviews,
    ROUND(AVG(rating), 2) as avg_rating,
    MIN(rating) as min_rating,
    MAX(rating) as max_rating,
    SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) as positive_count,
    SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) as negative_count
  FROM reviews WHERE reviewee_id = ?
`);

// --- PDA Helpers ---
function getIdentityPDA(wallet) {
  const walletKey = new PublicKey(wallet);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), walletKey.toBuffer()],
    PROGRAM_IDS.identity
  );
  return pda;
}

function getReputationPDA(wallet) {
  const walletKey = new PublicKey(wallet);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('reputation'), walletKey.toBuffer()],
    PROGRAM_IDS.reputation
  );
  return pda;
}

function getReviewPDA(reviewerId, revieweeId, jobId) {
  const reviewer = new PublicKey(reviewerId);
  const reviewee = new PublicKey(revieweeId);
  const seeds = [
    Buffer.from('review'),
    reviewer.toBuffer(),
    reviewee.toBuffer(),
  ];
  if (jobId) seeds.push(Buffer.from(jobId));
  const [pda] = PublicKey.findProgramAddressSync(seeds, PROGRAM_IDS.reviews);
  return pda;
}

// --- Route Handlers ---
function registerRoutes(app) {
  // Submit a review
  app.post('/api/satp/reviews', (req, res) => {
    try {
      const { reviewer_id, reviewee_id, job_id, rating, comment, tx_signature } = req.body;

      if (!reviewer_id || !reviewee_id || !rating) {
        return res.status(400).json({ error: 'reviewer_id, reviewee_id, and rating are required' });
      }
      if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        return res.status(400).json({ error: 'rating must be integer 1-5' });
      }
      if (reviewer_id === reviewee_id) {
        return res.status(400).json({ error: 'Cannot review yourself' });
      }

      // Validate wallet addresses
      try {
        new PublicKey(reviewer_id);
        new PublicKey(reviewee_id);
      } catch {
        return res.status(400).json({ error: 'reviewer_id and reviewee_id must be valid Solana addresses' });
      }

      const id = crypto.randomUUID();
      insertReview.run({
        id,
        reviewer_id,
        reviewee_id,
        job_id: job_id || null,
        rating,
        comment: comment || null,
        tx_signature: tx_signature || null,
      });

      // Compute PDAs for reference
      const reviewPDA = getReviewPDA(reviewer_id, reviewee_id, job_id);
      const reputationPDA = getReputationPDA(reviewee_id);

      res.status(201).json({
        id,
        reviewPDA: reviewPDA.toBase58(),
        reputationPDA: reputationPDA.toBase58(),
        message: 'Review submitted',
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit review', detail: err.message });
    }
  });

  // Get reviews for an agent
  app.get('/api/satp/reviews', async (req, res) => {
    try {
      const { agent } = req.query;
      if (!agent) {
        return res.status(400).json({ error: 'agent query parameter required' });
      }
      try { new PublicKey(agent); } catch {
        return res.status(400).json({ error: 'agent must be a valid Solana address' });
      }

      // Try on-chain first, fall back to SQLite
      let reviews, source = 'solana';
      try {
        const onchain = await getOnChainReviews(agent);
        reviews = onchain.received.items || [];
      } catch (e) {
        reviews = getReviewsByAgent.all(agent);
        source = 'sqlite-fallback';
      }

      const identityPDA = getIdentityPDA(agent);

      res.json({
        agent,
        identityPDA: identityPDA.toBase58(),
        reviews,
        total: reviews.length,
        source,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch reviews', detail: err.message });
    }
  });

  // Aggregate stats for an agent
  app.get('/api/satp/reviews/stats/:wallet', (req, res) => {
    try {
      const { wallet } = req.params;
      try { new PublicKey(wallet); } catch {
        return res.status(400).json({ error: 'wallet must be a valid Solana address' });
      }

      const stats = getStats.get(wallet);
      const reputationPDA = getReputationPDA(wallet);

      res.json({
        wallet,
        reputationPDA: reputationPDA.toBase58(),
        ...stats,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch stats', detail: err.message });
    }
  });
}

module.exports = { registerRoutes, PROGRAM_IDS, getIdentityPDA, getReputationPDA, getReviewPDA };
