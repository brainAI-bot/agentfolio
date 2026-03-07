/**
 * SATP Reviews module — on-chain reviews via Solana devnet.
 * Ported from brainChain's satp-reviews-api.
 */
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const {
  Connection, Keypair, PublicKey, Transaction,
  TransactionInstruction, SystemProgram,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const fs = require('fs');

const RPC_URL = process.env.SATP_RPC_URL || 'https://api.devnet.solana.com';
const WALLET_PATH = process.env.SATP_WALLET_PATH || '/home/ubuntu/.config/solana/brainchain-personal.json';
const DB_PATH = process.env.SATP_DB_PATH || path.join(__dirname, '..', '..', 'data', 'satp-reviews.db');

const PROGRAMS = {
  IDENTITY: new PublicKey('BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr'),
  REPUTATION: new PublicKey('TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh'),
  ESCROW: new PublicKey('STyY8w4ZHws3X1AMoocWuDYBoogVDwvymPy8Wifx5TH'),
  REVIEWS: new PublicKey('8b2jb9U9whNjRWrCbBVR26AqhkPzXZL3yjBuAzauPYBy'),
};

const connection = new Connection(RPC_URL, 'confirmed');

let signer = null;
try {
  const keyData = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
  signer = Keypair.fromSecretKey(Uint8Array.from(keyData));
  console.log(`[SATP Reviews] Signer wallet: ${signer.publicKey.toBase58()}`);
} catch (e) {
  console.log(`[SATP Reviews] No wallet at ${WALLET_PATH} — on-chain writes disabled`);
}

// Ensure data dir exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS satp_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reviewer_id TEXT NOT NULL,
    reviewee_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    comment_hash TEXT NOT NULL,
    tx_signature TEXT,
    review_pda TEXT,
    network TEXT DEFAULT 'devnet',
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(reviewer_id, job_id)
  );
  CREATE INDEX IF NOT EXISTS idx_satp_reviewee ON satp_reviews(reviewee_id);
  CREATE INDEX IF NOT EXISTS idx_satp_reviewer ON satp_reviews(reviewer_id);
`);

const insertReview = db.prepare(`INSERT INTO satp_reviews (reviewer_id, reviewee_id, job_id, rating, comment, comment_hash, tx_signature, review_pda, network, status) VALUES (@reviewer_id, @reviewee_id, @job_id, @rating, @comment, @comment_hash, @tx_signature, @review_pda, @network, @status)`);
const getByAgent = db.prepare(`SELECT * FROM satp_reviews WHERE reviewee_id = ? ORDER BY created_at DESC`);
const getByReviewer = db.prepare(`SELECT * FROM satp_reviews WHERE reviewer_id = ? ORDER BY created_at DESC`);
const getByJobReviewer = db.prepare(`SELECT * FROM satp_reviews WHERE job_id = ? AND reviewer_id = ?`);
const getStats = db.prepare(`SELECT COUNT(*) as total_reviews, ROUND(AVG(rating), 2) as avg_rating, SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star, SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star, SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star, SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star FROM satp_reviews WHERE reviewee_id = ? AND status = 'confirmed'`);

function getIdentityPDA(wallet) {
  return PublicKey.findProgramAddressSync([Buffer.from('identity'), new PublicKey(wallet).toBuffer()], PROGRAMS.IDENTITY);
}
function getReviewPDA(escrowPubkey, reviewerIdentityPDA) {
  return PublicKey.findProgramAddressSync([Buffer.from('review'), new PublicKey(escrowPubkey).toBuffer(), new PublicKey(reviewerIdentityPDA).toBuffer()], PROGRAMS.REVIEWS);
}

async function submitReview({ reviewer_id, reviewee_id, job_id, rating, comment }) {
  if (!reviewer_id || !reviewee_id || !job_id) return { error: 'Missing required fields: reviewer_id, reviewee_id, job_id', status: 400 };
  if (!rating || rating < 1 || rating > 5) return { error: 'Rating must be between 1 and 5', status: 400 };
  if (!comment || comment.trim().length === 0) return { error: 'Comment is required', status: 400 };
  if (comment.length > 1000) return { error: 'Comment must be 1000 characters or fewer', status: 400 };
  if (reviewer_id === reviewee_id) return { error: 'Cannot review yourself', status: 400 };

  try { new PublicKey(reviewer_id); new PublicKey(reviewee_id); new PublicKey(job_id); } catch { return { error: 'Invalid Solana public key format', status: 400 }; }

  const existing = getByJobReviewer.get(job_id, reviewer_id);
  if (existing) return { error: 'Review already exists for this job by this reviewer', review: existing, status: 409 };

  const commentHash = crypto.createHash('sha256').update(comment).digest('hex');
  let txSignature = null, reviewPDA = null, status = 'offline';

  // Derive PDA
  try {
    const [reviewerIdentity] = getIdentityPDA(reviewer_id);
    const [pda] = getReviewPDA(job_id, reviewerIdentity);
    reviewPDA = pda.toBase58();
  } catch {}

  // On-chain tx (if signer available)
  if (signer) {
    try {
      const commentUri = `data:text/plain;hash=${commentHash}`;
      const reviewerKey = signer.publicKey;
      const escrowKey = new PublicKey(job_id);
      const reviewedKey = new PublicKey(reviewee_id);
      const [reviewerIdentity] = getIdentityPDA(reviewerKey);
      const [pda] = getReviewPDA(escrowKey, reviewerIdentity);
      reviewPDA = pda.toBase58();
      const [reviewedReputation] = PublicKey.findProgramAddressSync([Buffer.from('reputation'), reviewedKey.toBuffer()], PROGRAMS.REPUTATION);
      const commentHashBuf = crypto.createHash('sha256').update(comment || '').digest();
      const discriminator = crypto.createHash('sha256').update('global:submit_review').digest().slice(0, 8);
      const uriBytes = Buffer.from(commentUri, 'utf8');
      const data = Buffer.alloc(8 + 1 + 4 + uriBytes.length + 32);
      let offset = 0;
      discriminator.copy(data, offset); offset += 8;
      data.writeUInt8(rating, offset); offset += 1;
      data.writeUInt32LE(uriBytes.length, offset); offset += 4;
      uriBytes.copy(data, offset); offset += uriBytes.length;
      commentHashBuf.copy(data, offset);
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: reviewerKey, isSigner: true, isWritable: true },
          { pubkey: reviewerIdentity, isSigner: false, isWritable: false },
          { pubkey: escrowKey, isSigner: false, isWritable: false },
          { pubkey: pda, isSigner: false, isWritable: true },
          { pubkey: reviewedReputation, isSigner: false, isWritable: true },
          { pubkey: PROGRAMS.IDENTITY, isSigner: false, isWritable: false },
          { pubkey: PROGRAMS.ESCROW, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAMS.REVIEWS,
        data,
      });
      const tx = new Transaction().add(ix);
      txSignature = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'confirmed' });
      status = 'confirmed';
    } catch (e) {
      status = 'failed_onchain';
      console.error(`[SATP Reviews] On-chain tx failed: ${e.message}`);
    }
  }

  const result = insertReview.run({
    reviewer_id, reviewee_id, job_id, rating: Math.floor(rating),
    comment: comment.trim(), comment_hash: commentHash,
    tx_signature: txSignature, review_pda: reviewPDA,
    network: 'devnet', status,
  });

  return {
    success: true,
    review: { id: result.lastInsertRowid, reviewer_id, reviewee_id, job_id, rating: Math.floor(rating), comment: comment.trim(), comment_hash: commentHash, tx_signature: txSignature, review_pda: reviewPDA, network: 'devnet', status },
    status: status === 'confirmed' ? 201 : 202,
  };
}

function getReviews({ agent, reviewer }) {
  if (agent) return { agent, reviews: getByAgent.all(agent), stats: getStats.get(agent) };
  if (reviewer) return { reviewer, reviews: getByReviewer.all(reviewer) };
  return { error: 'Provide ?agent=<wallet> or ?reviewer=<wallet>', status: 400 };
}

function getReviewStatsForWallet(wallet) {
  try { new PublicKey(wallet); } catch { return { error: 'Invalid wallet address', status: 400 }; }
  const stats = getStats.get(wallet);
  const reviews = getByAgent.all(wallet);
  return { wallet, stats: stats || { total_reviews: 0, avg_rating: 0 }, recent_reviews: reviews.slice(0, 5) };
}

module.exports = { submitReview, getReviews, getReviewStatsForWallet };
