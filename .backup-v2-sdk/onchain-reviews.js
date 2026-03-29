/**
 * On-Chain Reviews Fetcher for AgentFolio
 * Reads SATP reviews directly from Solana instead of SQLite.
 * Drop-in replacement for the SQLite review queries.
 */
const { Connection, PublicKey } = require('@solana/web3.js');
const { getReviewsForAgent, getReviewsByReviewer, getIdentityPDA } = require('./satp-reviews-client');

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

// Simple in-memory cache (5 min TTL)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 250);
    oldest.forEach(([k]) => cache.delete(k));
  }
}

/**
 * Fetch reviews for an agent wallet — returns same shape as the old SQLite queries.
 */
async function getReviewsForProfile(wallet) {
  const cacheKey = `reviews:${wallet}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try { new PublicKey(wallet); } catch { return emptyResult(); }

  try {
    const receivedRaw = await getReviewsForAgent(connection, wallet);
    const received = receivedRaw.map(formatReview);

    const [identityPDA] = getIdentityPDA(wallet);
    const givenRaw = await getReviewsByReviewer(connection, identityPDA.toBase58());
    const given = givenRaw.map(formatReview);

    const receivedStats = computeStats(received);
    const givenStats = computeStats(given);

    const result = {
      received: { items: received, ...receivedStats },
      given: { items: given, ...givenStats },
      source: 'solana',
    };

    setCache(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`[OnChain Reviews] Error fetching for ${wallet}:`, e.message);
    return { ...emptyResult(), error: e.message };
  }
}

function formatReview(r) {
  return {
    id: r.address,
    reviewer_id: r.reviewer_did,
    reviewee_id: r.reviewed_did,
    rating: r.rating,
    comment: r.comment_uri || '',
    comment_uri: r.comment_uri,
    comment_hash: r.comment_hash,
    tx_signature: r.address,
    created_at: r.timestampISO,
    timestamp: r.timestamp,
    source: 'solana',
  };
}

function computeStats(items) {
  if (items.length === 0) return { total_reviews: 0, avg_rating: null };
  const sum = items.reduce((s, r) => s + r.rating, 0);
  return {
    total_reviews: items.length,
    avg_rating: Math.round((sum / items.length) * 100) / 100,
  };
}

function emptyResult() {
  return {
    received: { items: [], total_reviews: 0, avg_rating: null },
    given: { items: [], total_reviews: 0, avg_rating: null },
  };
}

module.exports = { getReviewsForProfile, emptyResult };
