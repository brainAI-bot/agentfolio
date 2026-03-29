/**
 * SATP On-Chain Reviews Reader (v2)
 * Reads review data directly from the satp_reviews program on Solana mainnet.
 * Uses real IDL discriminators and struct layouts from brainChain's deployed program.
 * 
 * Program: 8b2jb9U9whNjRWrCbBVR26AqhkPzXZL3yjBuAzauPYBy
 * 
 * ReviewAccount layout (v2):
 *   reviewer_did(32) + reviewed_did(32) + escrow_ref(32) + rating(1) +
 *   category_quality(1) + category_reliability(1) + category_communication(1) +
 *   reviewer_rep_weight(8) + comment_uri(4+N) + comment_hash(32) + timestamp(8) +
 *   has_response(1) + response_uri(4+N) + response_hash(32) + response_timestamp(8) + bump(1)
 */

const { Connection, PublicKey } = require('@solana/web3.js');

const REVIEWS_PROGRAM = new PublicKey('8b2jb9U9whNjRWrCbBVR26AqhkPzXZL3yjBuAzauPYBy');
const REPUTATION_PROGRAM = new PublicKey('TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Anchor discriminators from IDL
const REVIEW_DISCRIMINATOR = Buffer.from([119, 177, 213, 232, 143, 161, 255, 66]);
const REPUTATION_DISCRIMINATOR = Buffer.from([19, 185, 177, 157, 34, 87, 67, 233]);

/**
 * Parse a ReviewAccount from raw account data
 */
function parseReviewAccount(data) {
  if (!data || data.length < 80) return null;
  
  try {
    let offset = 8; // skip Anchor discriminator
    
    const reviewerDid = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    
    const reviewedDid = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    
    const escrowRef = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    
    const rating = data.readUInt8(offset); offset += 1;
    const categoryQuality = data.readUInt8(offset); offset += 1;
    const categoryReliability = data.readUInt8(offset); offset += 1;
    const categoryCommunication = data.readUInt8(offset); offset += 1;
    
    const reviewerRepWeight = Number(data.readBigUInt64LE(offset));
    offset += 8;
    
    // comment_uri: borsh string (u32 len + bytes)
    const commentUriLen = data.readUInt32LE(offset); offset += 4;
    const commentUri = commentUriLen > 0 && commentUriLen < 500
      ? data.slice(offset, offset + commentUriLen).toString('utf8') : '';
    offset += commentUriLen;
    
    // comment_hash: [u8; 32]
    const commentHash = data.slice(offset, offset + 32).toString('hex');
    offset += 32;
    
    // timestamp: i64
    const timestamp = Number(data.readBigInt64LE(offset));
    offset += 8;
    
    // has_response: bool
    const hasResponse = data.readUInt8(offset) === 1;
    offset += 1;
    
    // response_uri: borsh string
    const responseUriLen = data.readUInt32LE(offset); offset += 4;
    const responseUri = responseUriLen > 0 && responseUriLen < 500
      ? data.slice(offset, offset + responseUriLen).toString('utf8') : '';
    offset += responseUriLen;
    
    // response_hash: [u8; 32]
    const responseHash = data.slice(offset, offset + 32).toString('hex');
    offset += 32;
    
    // response_timestamp: i64
    const responseTimestamp = Number(data.readBigInt64LE(offset));
    offset += 8;
    
    // bump: u8
    const bump = data.readUInt8(offset);
    
    return {
      reviewerDid,
      reviewedDid,
      escrowRef,
      rating,
      categories: {
        quality: categoryQuality,
        reliability: categoryReliability,
        communication: categoryCommunication,
      },
      reviewerRepWeight,
      commentUri,
      commentHash,
      timestamp,
      createdAt: new Date(timestamp * 1000).toISOString(),
      hasResponse,
      response: hasResponse ? {
        uri: responseUri,
        hash: responseHash,
        timestamp: responseTimestamp,
        createdAt: new Date(responseTimestamp * 1000).toISOString(),
      } : null,
      bump,
    };
  } catch (err) {
    console.error('[SATP Reviews] Parse error:', err.message);
    return null;
  }
}

/**
 * Parse a ReputationAccount from raw data
 */
function parseReputationAccount(data) {
  if (!data || data.length < 80) return null;
  
  try {
    let offset = 8; // discriminator
    
    const owner = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    
    const score = Number(data.readBigUInt64LE(offset)); offset += 8;
    const endorsements = data.readUInt32LE(offset); offset += 4;
    const lastEndorser = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    const updatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const totalReviews = data.readUInt32LE(offset); offset += 4;
    const totalRatingSum = Number(data.readBigUInt64LE(offset)); offset += 8;
    const weightedRatingSum = Number(data.readBigUInt64LE(offset)); offset += 8;
    const totalWeight = Number(data.readBigUInt64LE(offset)); offset += 8;
    
    // Compute human-readable score
    const avgRating = totalReviews > 0 ? (totalRatingSum / totalReviews) : 0;
    const weightedAvg = totalWeight > 0 ? (weightedRatingSum / totalWeight) : 0;
    
    return {
      owner,
      score,
      scoreNormalized: score / 10000, // 0-100 scale
      endorsements,
      lastEndorser,
      updatedAt: new Date(updatedAt * 1000).toISOString(),
      totalReviews,
      totalRatingSum,
      weightedRatingSum,
      totalWeight,
      avgRating: Math.round(avgRating * 100) / 100,
      weightedAvgRating: Math.round(weightedAvg * 100) / 100,
    };
  } catch (err) {
    console.error('[SATP Reputation] Parse error:', err.message);
    return null;
  }
}

/**
 * Get all on-chain reviews for an agent (by reviewed_did wallet)
 */
async function getReviewsForAgent(walletPubkey) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = new PublicKey(walletPubkey);
  
  // Filter reviews by reviewed_did at offset 8 (disc) + 32 (reviewer_did) = 40
  const accounts = await connection.getProgramAccounts(REVIEWS_PROGRAM, {
    filters: [
      { memcmp: { offset: 40, bytes: wallet.toBase58() } },
    ],
  });
  
  return accounts
    .map(({ pubkey, account }) => {
      const review = parseReviewAccount(account.data);
      if (review) review.pda = pubkey.toBase58();
      return review;
    })
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get all on-chain reviews BY an agent (as reviewer)
 */
async function getReviewsByAgent(walletPubkey) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = new PublicKey(walletPubkey);
  
  // Filter by reviewer_did at offset 8
  const accounts = await connection.getProgramAccounts(REVIEWS_PROGRAM, {
    filters: [
      { memcmp: { offset: 8, bytes: wallet.toBase58() } },
    ],
  });
  
  return accounts
    .map(({ pubkey, account }) => {
      const review = parseReviewAccount(account.data);
      if (review) review.pda = pubkey.toBase58();
      return review;
    })
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get all reviews in the system (paginated)
 */
async function getAllReviews(limit = 50, offset = 0) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const accounts = await connection.getProgramAccounts(REVIEWS_PROGRAM);
  
  const reviews = accounts
    .map(({ pubkey, account }) => {
      const review = parseReviewAccount(account.data);
      if (review) review.pda = pubkey.toBase58();
      return review;
    })
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp);
  
  return {
    reviews: reviews.slice(offset, offset + limit),
    total: reviews.length,
    limit,
    offset,
  };
}

/**
 * Get on-chain reputation account for a wallet
 */
async function getReputation(walletPubkey) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = new PublicKey(walletPubkey);
  
  const [repPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('reputation'), wallet.toBuffer()],
    REPUTATION_PROGRAM
  );
  
  const acct = await connection.getAccountInfo(repPDA);
  if (!acct) return null;
  
  const rep = parseReputationAccount(acct.data);
  if (rep) rep.pda = repPDA.toBase58();
  return rep;
}

/**
 * Compute aggregate stats from on-chain reviews for an agent
 */
async function getReviewStats(walletPubkey) {
  const reviews = await getReviewsForAgent(walletPubkey);
  
  if (reviews.length === 0) {
    return {
      wallet: walletPubkey,
      totalReviews: 0,
      avgRating: 0,
      categories: { quality: 0, reliability: 0, communication: 0 },
      positiveCount: 0,
      negativeCount: 0,
      source: 'on-chain',
    };
  }
  
  const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
  const total = reviews.length;
  
  return {
    wallet: walletPubkey,
    totalReviews: total,
    avgRating: Math.round(sum(reviews, r => r.rating) / total * 100) / 100,
    categories: {
      quality: Math.round(sum(reviews, r => r.categories.quality) / total * 100) / 100,
      reliability: Math.round(sum(reviews, r => r.categories.reliability) / total * 100) / 100,
      communication: Math.round(sum(reviews, r => r.categories.communication) / total * 100) / 100,
    },
    positiveCount: reviews.filter(r => r.rating >= 4).length,
    negativeCount: reviews.filter(r => r.rating <= 2).length,
    latestReview: reviews[0]?.createdAt || null,
    source: 'on-chain',
  };
}

module.exports = {
  REVIEWS_PROGRAM,
  REPUTATION_PROGRAM,
  parseReviewAccount,
  parseReputationAccount,
  getReviewsForAgent,
  getReviewsByAgent,
  getAllReviews,
  getReputation,
  getReviewStats,
};
