/**
 * Reviews V2 — On-Chain Reviews with Wallet Signature Verification
 * 
 * Enhancements over peer-reviews.js:
 * 1. Wallet signature required to submit reviews (EIP-191 or Solana ed25519)
 * 2. On-chain Memo attestation for each review
 * 3. GET /api/reviews/recent endpoint
 * 4. Challenge-response pattern to prevent replay attacks
 * 
 * Flow:
 * 1. POST /api/reviews/challenge — get a challenge message to sign
 * 2. POST /api/reviews/submit — submit signed review
 */
const crypto = require('crypto');
const database = require('./database');
const db = database.db;

let ethers;
try { ethers = require('ethers'); } catch {}

let nacl;
try { nacl = require('tweetnacl'); } catch {}

let bs58;
try { bs58 = require('bs58'); } catch {}

// Ensure v2 columns exist
try {
  db.exec(`ALTER TABLE peer_reviews ADD COLUMN reviewer_wallet TEXT DEFAULT ''`);
} catch (e) { /* column exists */ }
try {
  db.exec(`ALTER TABLE peer_reviews ADD COLUMN signature TEXT DEFAULT ''`);
} catch (e) { /* column exists */ }
try {
  db.exec(`ALTER TABLE peer_reviews ADD COLUMN chain TEXT DEFAULT ''`);
} catch (e) { /* column exists */ }
try {
  db.exec(`ALTER TABLE peer_reviews ADD COLUMN memo_tx TEXT DEFAULT ''`);
} catch (e) { /* column exists */ }
try {
  db.exec(`ALTER TABLE peer_reviews ADD COLUMN challenge_nonce TEXT DEFAULT ''`);
} catch (e) { /* column exists */ }

const challenges = new Map();
const CHALLENGE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CHALLENGES_PER_IP = 20;

/**
 * Generate a review challenge — caller must sign this message with their wallet
 */
function generateReviewChallenge(reviewerId, revieweeId, rating, chain) {
  if (!reviewerId || !revieweeId) throw new Error('reviewerId and revieweeId required');
  if (reviewerId === revieweeId) throw new Error('Cannot review yourself');
  if (!rating || rating < 1 || rating > 5) throw new Error('Rating must be 1-5');
  if (!chain || !['solana', 'ethereum'].includes(chain)) throw new Error('chain must be "solana" or "ethereum"');

  const challengeId = crypto.randomUUID();
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString();

  const message = [
    'AgentFolio Review Attestation',
    '',
    `Reviewer: ${reviewerId}`,
    `Target: ${revieweeId}`,
    `Rating: ${rating}/5`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');

  challenges.set(challengeId, {
    reviewerId,
    revieweeId,
    rating: Math.min(5, Math.max(1, Math.round(rating))),
    chain,
    nonce,
    message,
    createdAt: Date.now(),
  });

  // Cleanup expired
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }

  return {
    success: true,
    challengeId,
    message,
    chain,
    instructions: chain === 'solana'
      ? 'Sign this message with your Solana wallet (base58 encoded signature), then POST to /api/reviews/submit'
      : 'Sign this message with your Ethereum wallet (EIP-191), then POST to /api/reviews/submit',
    expiresIn: '15 minutes',
  };
}

/**
 * Verify a Solana ed25519 signature
 */
function verifySolanaSignature(message, signatureB58, publicKeyB58) {
  if (!nacl || !bs58) return { valid: false, error: 'tweetnacl/bs58 not available' };
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signatureB58);
    const publicKeyBytes = bs58.decode(publicKeyB58);
    const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    return { valid };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/**
 * Verify an Ethereum EIP-191 signature
 */
function verifyEthSignature(message, signature, expectedAddress) {
  if (!ethers) return { valid: false, error: 'ethers not available' };
  try {
    let recovered;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      try {
        recovered = ethers.utils.verifyMessage(message, signature);
      } catch {
        return { valid: false, error: 'Cannot verify signature' };
      }
    }
    const valid = recovered.toLowerCase() === expectedAddress.toLowerCase();
    return { valid, recovered };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

/**
 * Submit a signed review
 */
function submitSignedReview({ challengeId, signature, walletAddress, comment }) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired. Generate a new one.');
  }

  if (!signature || !walletAddress) {
    throw new Error('signature and walletAddress required');
  }

  // Verify signature based on chain
  let sigResult;
  if (ch.chain === 'solana') {
    sigResult = verifySolanaSignature(ch.message, signature, walletAddress);
  } else if (ch.chain === 'ethereum') {
    sigResult = verifyEthSignature(ch.message, signature, walletAddress);
  }

  if (!sigResult || !sigResult.valid) {
    return {
      verified: false,
      error: 'Signature verification failed: ' + (sigResult?.error || 'invalid signature'),
    };
  }

  // Check for existing review (one per reviewer-reviewee pair)
  const { createPeerReview } = require('./peer-reviews');
  const result = createPeerReview({
    reviewerId: ch.reviewerId,
    revieweeId: ch.revieweeId,
    rating: ch.rating,
    comment: (comment || '').slice(0, 500),
    context: 'general',
  });

  if (result.error) {
    return { verified: false, error: result.error };
  }

  // Update with v2 fields
  try {
    db.prepare(`
      UPDATE peer_reviews SET 
        reviewer_wallet = ?, signature = ?, chain = ?, challenge_nonce = ?, verified = 1
      WHERE id = ?
    `).run(walletAddress, signature.slice(0, 200), ch.chain, ch.nonce, result.review.id);
  } catch (e) {
    console.error('[ReviewsV2] Failed to update v2 fields:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    review: {
      ...result.review,
      walletAddress,
      chain: ch.chain,
      signatureVerified: true,
    },
  };
}

/**
 * Get recent reviews across all profiles
 */
function getRecentReviews(limit = 20) {
  const rows = db.prepare(`
    SELECT * FROM peer_reviews
    ORDER BY created_at DESC
    LIMIT ?
  `).all(Math.min(limit, 100));

  return rows.map(row => ({
    id: row.id,
    reviewerId: row.reviewer_id,
    revieweeId: row.reviewee_id,
    rating: row.rating,
    comment: row.comment,
    context: row.context,
    walletAddress: row.reviewer_wallet || null,
    chain: row.chain || null,
    signatureVerified: !!row.verified,
    memoTx: row.memo_tx || null,
    createdAt: row.created_at,
  }));
}

/**
 * Update review with on-chain memo TX
 */
function setReviewMemoTx(reviewId, txSignature) {
  try {
    db.prepare('UPDATE peer_reviews SET memo_tx = ? WHERE id = ?').run(txSignature, reviewId);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  generateReviewChallenge,
  submitSignedReview,
  getRecentReviews,
  setReviewMemoTx,
};
