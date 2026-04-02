/**
 * SATP On-Chain Reviews Reader (v2) — with RPC cache + dedup + retry
 * Reads review data directly from the satp_reviews program on Solana mainnet.
 * 
 * Program: 8b2jb9U9whNjRWrCbBVR26AqhkPzXZL3yjBuAzauPYBy
 * 
 * OPTIMIZATION (2026-04-02): Single bulk getProgramAccounts for ALL reviews,
 * cached for 30min. Per-agent queries served from memory. Eliminates per-agent RPC calls.
 */

const { Connection, PublicKey } = require('@solana/web3.js');

const REVIEWS_PROGRAM = new PublicKey('8b2jb9U9whNjRWrCbBVR26AqhkPzXZL3yjBuAzauPYBy');
const REPUTATION_PROGRAM = new PublicKey('TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// ─── Shared connection ──────────────
const connection = new Connection(RPC_URL, 'confirmed');

// ─── BULK CACHE: single getProgramAccounts for ALL reviews ──────────────
const _bulkCache = {
  allReviews: [],           // All parsed reviews
  byReviewed: new Map(),    // reviewedDid -> [reviews]
  byReviewer: new Map(),    // reviewerDid -> [reviews]
  lastFetch: 0,
  loading: null,            // Promise (dedup concurrent loads)
};
const BULK_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — reviews change very rarely

// Reputation cache (individual lookups, longer TTL)
const _repCache = new Map(); // key -> { data, expires }
const REP_CACHE_TTL_MS = 30 * 60 * 1000;

// ─── Retry with exponential backoff on 429 ──────────────
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message && err.message.includes('429');
      if (is429 && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 8000);
        console.log(`[SATP Reviews] 429 hit, retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Load ALL reviews from chain in a single bulk call, then index by agent.
 * Deduplicates concurrent calls (thundering herd protection).
 */
async function ensureBulkCache() {
  const now = Date.now();
  if (_bulkCache.lastFetch && (now - _bulkCache.lastFetch) < BULK_CACHE_TTL_MS) {
    return; // Cache is fresh
  }

  // Dedup: if already loading, wait for that promise
  if (_bulkCache.loading) {
    await _bulkCache.loading;
    return;
  }

  _bulkCache.loading = _loadBulkReviews();
  try {
    await _bulkCache.loading;
  } finally {
    _bulkCache.loading = null;
  }
}

async function _loadBulkReviews() {
  try {
    const accounts = await withRetry(() =>
      connection.getProgramAccounts(REVIEWS_PROGRAM)
    );

    const allReviews = [];
    const byReviewed = new Map();
    const byReviewer = new Map();

    for (const { pubkey, account } of accounts) {
      const review = parseReviewAccount(account.data);
      if (!review) continue;
      review.pda = pubkey.toBase58();
      allReviews.push(review);

      // Index by reviewed agent
      if (!byReviewed.has(review.reviewedDid)) byReviewed.set(review.reviewedDid, []);
      byReviewed.get(review.reviewedDid).push(review);

      // Index by reviewer
      if (!byReviewer.has(review.reviewerDid)) byReviewer.set(review.reviewerDid, []);
      byReviewer.get(review.reviewerDid).push(review);
    }

    // Sort each list by timestamp desc
    allReviews.sort((a, b) => b.timestamp - a.timestamp);
    for (const list of byReviewed.values()) list.sort((a, b) => b.timestamp - a.timestamp);
    for (const list of byReviewer.values()) list.sort((a, b) => b.timestamp - a.timestamp);

    _bulkCache.allReviews = allReviews;
    _bulkCache.byReviewed = byReviewed;
    _bulkCache.byReviewer = byReviewer;
    _bulkCache.lastFetch = Date.now();

    console.log(`[SATP Reviews] Bulk cache loaded: ${allReviews.length} reviews, ${byReviewed.size} agents reviewed, ${byReviewer.size} reviewers`);
  } catch (err) {
    // If bulk load fails and we have stale data, keep serving it
    if (_bulkCache.allReviews.length > 0) {
      console.warn(`[SATP Reviews] Bulk refresh failed (serving stale ${_bulkCache.allReviews.length} reviews):`, err.message);
      _bulkCache.lastFetch = Date.now() - BULK_CACHE_TTL_MS + 5 * 60 * 1000; // Retry in 5min
    } else {
      console.error('[SATP Reviews] Bulk load failed with no fallback:', err.message);
      throw err;
    }
  }
}

/**
 * Parse a ReviewAccount from raw account data
 */
function parseReviewAccount(data) {
  if (!data || data.length < 80) return null;
  
  try {
    let offset = 8;
    
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
    
    const commentUriLen = data.readUInt32LE(offset); offset += 4;
    const commentUri = commentUriLen > 0 && commentUriLen < 500
      ? data.slice(offset, offset + commentUriLen).toString('utf8') : '';
    offset += commentUriLen;
    
    const commentHash = data.slice(offset, offset + 32).toString('hex');
    offset += 32;
    
    const timestamp = Number(data.readBigInt64LE(offset));
    offset += 8;
    
    const hasResponse = data.readUInt8(offset) === 1;
    offset += 1;
    
    const responseUriLen = data.readUInt32LE(offset); offset += 4;
    const responseUri = responseUriLen > 0 && responseUriLen < 500
      ? data.slice(offset, offset + responseUriLen).toString('utf8') : '';
    offset += responseUriLen;
    
    const responseHash = data.slice(offset, offset + 32).toString('hex');
    offset += 32;
    
    const responseTimestamp = Number(data.readBigInt64LE(offset));
    offset += 8;
    
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
    let offset = 8;
    
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
    
    const avgRating = totalReviews > 0 ? (totalRatingSum / totalReviews) : 0;
    const weightedAvg = totalWeight > 0 ? (weightedRatingSum / totalWeight) : 0;
    
    return {
      owner,
      score,
      scoreNormalized: score / 10000,
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
 * NOW: Served from bulk cache — zero per-agent RPC calls
 */
async function getReviewsForAgent(walletPubkey) {
  await ensureBulkCache();
  return _bulkCache.byReviewed.get(walletPubkey) || [];
}

/**
 * Get all on-chain reviews BY an agent (as reviewer)
 * NOW: Served from bulk cache — zero per-agent RPC calls
 */
async function getReviewsByAgent(walletPubkey) {
  await ensureBulkCache();
  return _bulkCache.byReviewer.get(walletPubkey) || [];
}

/**
 * Get all reviews in the system (paginated)
 * NOW: Served from bulk cache
 */
async function getAllReviews(limit = 50, offset = 0) {
  await ensureBulkCache();
  return {
    reviews: _bulkCache.allReviews.slice(offset, offset + limit),
    total: _bulkCache.allReviews.length,
    limit,
    offset,
  };
}

/**
 * Get on-chain reputation account for a wallet
 */
async function getReputation(walletPubkey) {
  const cacheKey = `reputation:${walletPubkey}`;
  const cached = _repCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;

  try {
    const wallet = new PublicKey(walletPubkey);
    const [repPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('reputation'), wallet.toBuffer()],
      REPUTATION_PROGRAM
    );
    
    const acct = await withRetry(() => connection.getAccountInfo(repPDA));
    if (!acct) {
      _repCache.set(cacheKey, { data: null, expires: Date.now() + REP_CACHE_TTL_MS });
      return null;
    }
    
    const rep = parseReputationAccount(acct.data);
    if (rep) rep.pda = repPDA.toBase58();
    _repCache.set(cacheKey, { data: rep, expires: Date.now() + REP_CACHE_TTL_MS });
    return rep;
  } catch (err) {
    // Return stale cache on error
    if (cached) return cached.data;
    throw err;
  }
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
