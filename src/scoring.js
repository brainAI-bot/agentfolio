/**
 * AgentFolio Scoring Module v2
 * Hybrid scoring: on-chain SATP scores (authoritative) + off-chain signals
 * On-chain scores come from SATP Identity program via CPI-computed reputation
 */

const path = require('path');
const satpIdentity = require('./satp-identity-client');

// ─── Scoring Weights ────────────────────────────────────
// On-chain SATP score is the primary signal (40%)
// Off-chain signals fill the remaining 60%
const WEIGHTS = {
  onChainReputation: 40,  // From SATP on-chain reputation_score (0-100 → 0-40)
  verifications: 20,      // Verified accounts (on-chain attestations + off-chain)
  reviews: 15,            // Review ratings
  activity: 10,           // Recent activity signals
  completeness: 10,       // Profile completeness
  tenure: 5,              // Account age
};

// Verification type scores (off-chain)
const VERIFICATION_SCORES = {
  github: 8,
  solana: 6,
  x: 5,
  discord: 4,
  telegram: 4,
  domain: 6,
  website: 5,
  eth: 6,
  ens: 5,
  farcaster: 4,
  agentmail: 3,
};

/**
 * Compute score for a profile, integrating on-chain SATP data
 * @param {object} profile - Profile from DB
 * @param {object} [onChainData] - Pre-fetched {identity, attestations} from SATP. If null, score without on-chain.
 */
function computeScore(profile, onChainData = null) {
  let breakdown = {};
  let total = 0;

  // 1. On-Chain SATP Reputation (max 40) — THE authoritative score
  const onChain = onChainData || {};
  const satpScore = onChain.identity?.reputationScore || 0; // 0-100 from on-chain
  const satpLevel = onChain.identity?.verificationLevel || 0; // 0-5 from on-chain
  const onChainPts = Math.min((satpScore / 100) * WEIGHTS.onChainReputation, WEIGHTS.onChainReputation);
  breakdown.onChainReputation = {
    score: Math.round(onChainPts * 10) / 10,
    max: WEIGHTS.onChainReputation,
    satpScore,
    satpLevel,
    satpLabel: satpIdentity.levelToLabel(satpLevel),
    onChain: !!onChain.identity,
    pda: onChain.identity?.pda || null,
  };
  total += breakdown.onChainReputation.score;

  // 2. Verifications (max 20) — combine on-chain attestations + off-chain
  const offChainVerifications = profile.verifications || [];
  const onChainAttestations = onChain.attestations || [];
  let verScore = 0;
  const verifiedTypes = [];

  // Off-chain verifications
  for (const v of offChainVerifications) {
    const type = v.type || v.provider;
    if (type && VERIFICATION_SCORES[type] && !verifiedTypes.includes(type)) {
      verScore += VERIFICATION_SCORES[type];
      verifiedTypes.push(type);
    }
  }

  // On-chain attestations (bonus: on-chain proof > off-chain claim)
  for (const att of onChainAttestations) {
    if (att.verified && !att.expired) {
      const type = att.attestationType;
      if (!verifiedTypes.includes(type)) {
        verScore += (VERIFICATION_SCORES[type] || 4) * 1.5; // 1.5x for on-chain proof
        verifiedTypes.push(type + ':onchain');
      }
    }
  }

  breakdown.verifications = {
    score: Math.min(Math.round(verScore * 10) / 10, WEIGHTS.verifications),
    max: WEIGHTS.verifications,
    types: verifiedTypes,
    onChainAttestations: onChainAttestations.length,
  };
  total += breakdown.verifications.score;

  // 3. Reviews (max 15)
  const reviews = profile.reviews?.received || {};
  const avgRating = reviews.avg_rating || 0;
  const reviewCount = reviews.total_reviews || 0;
  const reviewScore = reviewCount > 0
    ? Math.min((avgRating / 5) * 12 + Math.min(reviewCount, 10) * 0.3, WEIGHTS.reviews)
    : 0;
  breakdown.reviews = { score: Math.round(reviewScore * 10) / 10, max: WEIGHTS.reviews, avgRating, count: reviewCount };
  total += breakdown.reviews.score;

  // 4. Activity (max 10)
  const trading = profile.trading || {};
  let actScore = 0;
  if (trading.totalTrades > 0) actScore += Math.min(trading.totalTrades / 10, 5);
  if (trading.winRate > 0.5) actScore += 2;
  if (profile.lastActive || profile.last_active_at) {
    const lastActive = profile.lastActive || profile.last_active_at;
    const daysSinceActive = (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActive < 7) actScore += 3;
    else if (daysSinceActive < 30) actScore += 1;
  }
  breakdown.activity = { score: Math.min(Math.round(actScore * 10) / 10, WEIGHTS.activity), max: WEIGHTS.activity };
  total += breakdown.activity.score;

  // 5. Completeness (max 10)
  let completeScore = 0;
  if (profile.name) completeScore += 2;
  if ((profile.description || profile.bio) && (profile.description || profile.bio).length > 20) completeScore += 2;
  if (profile.avatar || profile.image) completeScore += 2;
  if (profile.website || profile.url || profile.links) completeScore += 1;
  if (offChainVerifications.length > 0 || onChainAttestations.length > 0) completeScore += 2;
  if (profile.tags?.length > 0 || profile.skills) completeScore += 1;
  breakdown.completeness = { score: Math.min(completeScore, WEIGHTS.completeness), max: WEIGHTS.completeness };
  total += breakdown.completeness.score;

  // 6. Tenure (max 5)
  let tenureScore = 0;
  const createdAt = profile.createdAt || profile.created_at;
  if (createdAt) {
    const daysOld = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    tenureScore = Math.min(daysOld / 60, 5); // 1pt per 2 months, max 5
  }
  breakdown.tenure = { score: Math.round(tenureScore * 10) / 10, max: WEIGHTS.tenure };
  total += breakdown.tenure.score;

  // Level assignment — on-chain SATP level takes priority if registered
  total = Math.round(total * 10) / 10;
  let level;
  if (satpLevel >= 5) level = 'ELITE';
  else if (satpLevel >= 4 || total >= 80) level = 'ELITE';
  else if (satpLevel >= 3 || total >= 60) level = 'PRO';
  else if (satpLevel >= 2 || total >= 40) level = 'VERIFIED';
  else if (satpLevel >= 1 || total >= 20) level = 'BASIC';
  else level = 'NEW';

  return {
    profileId: profile.id,
    score: total,
    maxScore: 100,
    level,
    breakdown,
    onChainRegistered: !!onChain.identity,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Fetch on-chain SATP data for a wallet address
 * Returns { identity, attestations } or null
 */
async function fetchOnChainData(walletAddress) {
  if (!walletAddress) return null;
  try {
    const [identity, attestations] = await Promise.all([
      satpIdentity.getAgentIdentity(walletAddress).catch(() => null),
      satpIdentity.getAgentAttestations(walletAddress).catch(() => []),
    ]);
    return { identity, attestations };
  } catch (e) {
    console.error('[Scoring] on-chain fetch error:', e.message);
    return null;
  }
}

/**
 * Compute score with automatic on-chain lookup
 * @param {object} profile - Profile from DB (must have wallets field)
 */
async function computeScoreWithOnChain(profile) {
  // Extract wallet from profile
  let wallet = null;
  try {
    const wallets = typeof profile.wallets === 'string' ? JSON.parse(profile.wallets) : profile.wallets;
    wallet = wallets?.solana || wallets?.ethereum || null;
  } catch (e) { /* no wallet */ }

  const onChainData = wallet ? await fetchOnChainData(wallet) : null;
  return computeScore(profile, onChainData);
}

/**
 * Compute leaderboard with on-chain data
 */
async function computeLeaderboard(profiles, limit = 50) {
  const scored = await Promise.all(profiles.map(p => computeScoreWithOnChain(p)));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s, i) => ({
    rank: i + 1,
    ...s,
  }));
}

module.exports = {
  computeScore,
  computeScoreWithOnChain,
  computeLeaderboard,
  fetchOnChainData,
  WEIGHTS,
  VERIFICATION_SCORES,
};
