const { Connection, PublicKey, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const { createHash } = require('crypto');
const borsh = require('borsh');

// ─── Program IDs ─────────────────────────────────────────

const PROGRAMS = {
  IDENTITY: new PublicKey('BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr'),
  REPUTATION: new PublicKey('TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh'),
  VALIDATION: new PublicKey('AdDWFa9oEmZdrTrhu8YTWu4ozbTP7e6qa9rvyqfAvM7N'),
  ESCROW: new PublicKey('STyY8w4ZHws3X1AMoocWuDYBoogVDwvymPy8Wifx5TH'),
  REVIEWS: new PublicKey('8b2jb9U9whNjRWrCbBVR26AqhkPzXZL3yjBuAzauPYBy'),
};

// ─── PDA Derivation ──────────────────────────────────────

/**
 * Derive Review PDA: ["review", escrow_pubkey, reviewer_identity_pda]
 */
function getReviewPDA(escrowPubkey, reviewerIdentityPDA) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('review'),
      new PublicKey(escrowPubkey).toBuffer(),
      new PublicKey(reviewerIdentityPDA).toBuffer(),
    ],
    PROGRAMS.REVIEWS
  );
}

/**
 * Derive Identity PDA: ["identity", wallet_pubkey]
 */
function getIdentityPDA(walletPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), new PublicKey(walletPubkey).toBuffer()],
    PROGRAMS.IDENTITY
  );
}

/**
 * Derive Reputation PDA: ["reputation", wallet_pubkey]
 */
function getReputationPDA(walletPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reputation'), new PublicKey(walletPubkey).toBuffer()],
    PROGRAMS.REPUTATION
  );
}

// ─── Account Parsing ─────────────────────────────────────

const REVIEW_DISCRIMINATOR = Buffer.from(
  createHash('sha256').update('account:ReviewAccount').digest().slice(0, 8)
);

/**
 * Parse a ReviewAccount from raw account data.
 */
function parseReview(data) {
  if (!data || data.length < 350) return null;

  let offset = 8; // skip discriminator

  const reviewer_did = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const reviewed_did = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const escrow_ref = new PublicKey(data.slice(offset, offset + 32)).toBase58();
  offset += 32;

  const rating = data[offset];
  offset += 1;

  const uriLen = data.readUInt32LE(offset);
  offset += 4;
  const comment_uri = data.slice(offset, offset + uriLen).toString('utf8');
  offset += uriLen;

  const comment_hash = Buffer.from(data.slice(offset, offset + 32)).toString('hex');
  offset += 32;

  const timestamp = Number(data.readBigInt64LE(offset));
  offset += 8;

  const bump = data[offset];

  return {
    reviewer_did,
    reviewed_did,
    escrow_ref,
    rating,
    comment_uri,
    comment_hash,
    timestamp,
    timestampISO: new Date(timestamp * 1000).toISOString(),
    bump,
  };
}

// ─── Fetch Functions ─────────────────────────────────────

/**
 * Get all reviews for a specific agent (reviewed_did).
 * Uses memcmp filter on the reviewed_did field (offset 40 = 8 disc + 32 reviewer_did).
 */
async function getReviewsForAgent(connection, agentWallet) {
  const accounts = await connection.getProgramAccounts(PROGRAMS.REVIEWS, {
    filters: [
      { dataSize: 350 }, // ReviewAccount size
      {
        memcmp: {
          offset: 40, // 8 (discriminator) + 32 (reviewer_did)
          bytes: new PublicKey(agentWallet).toBase58(),
        },
      },
    ],
  });

  return accounts
    .map(({ pubkey, account }) => ({
      address: pubkey.toBase58(),
      ...parseReview(account.data),
    }))
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get all reviews written by a specific reviewer.
 * Uses memcmp filter on reviewer_did field (offset 8).
 */
async function getReviewsByReviewer(connection, reviewerIdentityPDA) {
  const accounts = await connection.getProgramAccounts(PROGRAMS.REVIEWS, {
    filters: [
      { dataSize: 350 },
      {
        memcmp: {
          offset: 8, // 8 (discriminator)
          bytes: new PublicKey(reviewerIdentityPDA).toBase58(),
        },
      },
    ],
  });

  return accounts
    .map(({ pubkey, account }) => ({
      address: pubkey.toBase58(),
      ...parseReview(account.data),
    }))
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get the review for a specific escrow by a specific reviewer.
 */
async function getReviewForEscrow(connection, escrowPubkey, reviewerIdentityPDA) {
  const [reviewPDA] = getReviewPDA(escrowPubkey, reviewerIdentityPDA);
  const account = await connection.getAccountInfo(reviewPDA);
  if (!account) return null;
  return {
    address: reviewPDA.toBase58(),
    ...parseReview(account.data),
  };
}

/**
 * Get all reviews for a specific escrow.
 * Uses memcmp filter on escrow_ref field (offset 72 = 8 + 32 + 32).
 */
async function getReviewsForEscrow(connection, escrowPubkey) {
  const accounts = await connection.getProgramAccounts(PROGRAMS.REVIEWS, {
    filters: [
      { dataSize: 350 },
      {
        memcmp: {
          offset: 72, // 8 + 32 + 32
          bytes: new PublicKey(escrowPubkey).toBase58(),
        },
      },
    ],
  });

  return accounts
    .map(({ pubkey, account }) => ({
      address: pubkey.toBase58(),
      ...parseReview(account.data),
    }))
    .filter(Boolean);
}

/**
 * Get aggregate review stats for an agent.
 */
async function getAgentReviewStats(connection, agentWallet) {
  const reviews = await getReviewsForAgent(connection, agentWallet);

  if (reviews.length === 0) {
    return { totalReviews: 0, averageRating: 0, ratings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
  }

  const ratings = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of reviews) {
    ratings[r.rating] = (ratings[r.rating] || 0) + 1;
    sum += r.rating;
  }

  return {
    totalReviews: reviews.length,
    averageRating: Math.round((sum / reviews.length) * 100) / 100,
    ratings,
    latestReview: reviews[0],
    oldestReview: reviews[reviews.length - 1],
  };
}

// ─── Transaction Builder ─────────────────────────────────

/**
 * Build a submit_review instruction.
 *
 * @param {Object} params
 * @param {PublicKey} params.reviewer - Reviewer's wallet (signer)
 * @param {PublicKey} params.escrow - Completed escrow account
 * @param {PublicKey} params.reviewedWallet - The other party's wallet
 * @param {number} params.rating - 1-5
 * @param {string} params.commentUri - Arweave URI of the comment text
 * @param {string} params.commentText - Raw comment text (hashed for integrity)
 * @returns {TransactionInstruction}
 */
function buildSubmitReviewInstruction({
  reviewer,
  escrow,
  reviewedWallet,
  rating,
  commentUri,
  commentText,
}) {
  const reviewerKey = new PublicKey(reviewer);
  const escrowKey = new PublicKey(escrow);
  const reviewedKey = new PublicKey(reviewedWallet);

  // Derive PDAs
  const [reviewerIdentity] = getIdentityPDA(reviewerKey);
  const [reviewPDA] = getReviewPDA(escrowKey, reviewerIdentity);
  const [reviewedReputation] = getReputationPDA(reviewedKey);

  // Hash the comment text
  const commentHash = createHash('sha256').update(commentText || '').digest();

  // Anchor discriminator for submit_review
  const discriminator = createHash('sha256')
    .update('global:submit_review')
    .digest()
    .slice(0, 8);

  // Serialize args: rating(u8) + comment_uri(string: u32 len + bytes) + comment_hash([u8;32])
  const uriBytes = Buffer.from(commentUri, 'utf8');
  const dataLen = 8 + 1 + 4 + uriBytes.length + 32;
  const data = Buffer.alloc(dataLen);
  let offset = 0;

  discriminator.copy(data, offset); offset += 8;
  data.writeUInt8(rating, offset); offset += 1;
  data.writeUInt32LE(uriBytes.length, offset); offset += 4;
  uriBytes.copy(data, offset); offset += uriBytes.length;
  commentHash.copy(data, offset);

  const keys = [
    { pubkey: reviewerKey, isSigner: true, isWritable: true },
    { pubkey: reviewerIdentity, isSigner: false, isWritable: false },
    { pubkey: escrowKey, isSigner: false, isWritable: false },
    { pubkey: reviewPDA, isSigner: false, isWritable: true },
    { pubkey: reviewedReputation, isSigner: false, isWritable: true },
    { pubkey: PROGRAMS.IDENTITY, isSigner: false, isWritable: false },
    { pubkey: PROGRAMS.ESCROW, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: PROGRAMS.REVIEWS,
    data,
  });
}

/**
 * Hash comment text for on-chain integrity verification.
 */
function hashComment(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Verify that a comment matches its on-chain hash.
 */
function verifyCommentIntegrity(commentText, onChainHash) {
  const computed = hashComment(commentText);
  return computed === onChainHash;
}

// ─── Exports ─────────────────────────────────────────────

module.exports = {
  PROGRAMS,
  getReviewPDA,
  getIdentityPDA,
  getReputationPDA,
  parseReview,
  getReviewsForAgent,
  getReviewsByReviewer,
  getReviewForEscrow,
  getReviewsForEscrow,
  getAgentReviewStats,
  buildSubmitReviewInstruction,
  hashComment,
  verifyCommentIntegrity,
  REVIEW_DISCRIMINATOR,
};
