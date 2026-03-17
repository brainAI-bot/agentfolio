/**
 * Polymarket Verification Module
 * Verifies trading activity on Polymarket via data-api.polymarket.com
 */
const crypto = require('crypto');

const challenges = new Map();
const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';

/**
 * Initiate Polymarket verification.
 * Checks wallet address for activity on Polymarket.
 */
async function initiatePolymarketVerification(profileId, walletAddress) {
  const clean = walletAddress.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) {
    throw new Error('Invalid Ethereum wallet address');
  }

  const challengeId = crypto.randomUUID();

  challenges.set(challengeId, {
    profileId,
    walletAddress: clean.toLowerCase(),
    createdAt: Date.now(),
    verified: false,
  });

  // Cleanup old
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }

  return {
    success: true,
    challengeId,
    walletAddress: clean.toLowerCase(),
    instructions: `We'll check Polymarket activity for wallet ${clean}. Click "Verify" to proceed. Your wallet must have at least 1 trade on Polymarket.`,
    expiresIn: '30 minutes',
  };
}

/**
 * Verify Polymarket challenge by querying Polymarket data API.
 */
async function verifyPolymarketChallenge(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired');
  }

  let activityData = null;

  try {
    // Check Polymarket profile/activity
    const profileRes = await fetch(`${POLYMARKET_DATA_API}/profile/${ch.walletAddress}`, {
      headers: { 'User-Agent': 'AgentFolio-Verification/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (profileRes.ok) {
      activityData = await profileRes.json();
    }
  } catch (e) {
    // Profile endpoint may not exist, try activity endpoint
  }

  // If profile didn't work, try fetching positions/trades
  if (!activityData) {
    try {
      const activityRes = await fetch(`${POLYMARKET_DATA_API}/activity/${ch.walletAddress}`, {
        headers: { 'User-Agent': 'AgentFolio-Verification/1.0' },
        signal: AbortSignal.timeout(10000),
      });

      if (activityRes.ok) {
        activityData = await activityRes.json();
      }
    } catch (e) {
      // Try the gamma API as fallback
    }
  }

  // Fallback: check gamma-api for positions
  if (!activityData) {
    try {
      const gammaRes = await fetch(`https://gamma-api.polymarket.com/query?active=true&closed=true&limit=5&maker_address=${ch.walletAddress}`, {
        headers: { 'User-Agent': 'AgentFolio-Verification/1.0' },
        signal: AbortSignal.timeout(10000),
      });

      if (gammaRes.ok) {
        const gammaData = await gammaRes.json();
        if (Array.isArray(gammaData) && gammaData.length > 0) {
          activityData = { trades: gammaData.length, source: 'gamma-api' };
        }
      }
    } catch (e) {
      // All API attempts exhausted
    }
  }

  if (!activityData) {
    return {
      verified: false,
      error: `No Polymarket activity found for wallet ${ch.walletAddress}. Make sure you have at least one trade.`,
    };
  }

  ch.verified = true;

  // Save verification
  try {
    const profileStore = require('./profile-store');
    profileStore.addVerification(ch.profileId, 'polymarket', ch.walletAddress, {
      challengeId,
      walletAddress: ch.walletAddress,
      method: 'activity-check',
      activitySummary: {
        source: activityData.source || 'data-api',
        hasActivity: true,
      },
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[PolymarketVerify] Failed to save:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    platform: 'polymarket',
    identifier: ch.walletAddress,
    profileId: ch.profileId,
  };
}

function getPolymarketVerificationStatus(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) return { found: false };
  return {
    found: true,
    verified: ch.verified,
    walletAddress: ch.walletAddress,
    expiresAt: new Date(ch.createdAt + CHALLENGE_TTL_MS).toISOString(),
  };
}

module.exports = {
  initiatePolymarketVerification,
  verifyPolymarketChallenge,
  getPolymarketVerificationStatus,
};
