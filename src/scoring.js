/**
 * AgentFolio Scoring Module v3
 * Implements the new two-dimension scoring system: Verification Level + Trust Score
 * Backward compatible with existing API endpoints
 */

const path = require('path');
const satpIdentity = require('./satp-identity-client');
const { getProfileScoring, checkBoaEligibility } = require('./lib/scoring-v2');

/**
 * Get activity data for a profile (placeholder - would be from database)
 */
function getActivityData(profile) {
  return {
    endorsementsGiven: 0,
    endorsementsReceived: [],
    completedJobs: 0,
    jobsPosted: 0,
    reviewsReceived: profile.reviews?.received ? [{
      rating: Math.round(profile.reviews.received.avg_rating || 0),
      count: profile.reviews.received.total_reviews || 0
    }] : [],
    attestationsReceived: 0,
    accountAgeDays: profile.created_at ? 
      Math.floor((Date.now() - new Date(profile.created_at)) / (1000 * 60 * 60 * 24)) : 0,
    successfulReferrals: 0,
    completionRate: 1.0
  };
}

/**
 * Compute score for a profile (backward compatibility wrapper)
 * Returns the old API format but uses new scoring v2 internally
 */
function computeScore(profile, onChainData = null) {
  if (!profile) {
    return {
      score: 0,
      level: 'NEW',
      breakdown: {},
      trustScore: 0,
      verificationLevel: 'L1'
    };
  }

  const activityData = getActivityData(profile);
  const scoring = getProfileScoring(profile.id, activityData);
  
  if (!scoring) {
    return {
      score: 0,
      level: 'NEW',
      breakdown: {},
      trustScore: 0,
      verificationLevel: 'L1'
    };
  }

  // Map new scoring to old API format for backward compatibility
  const oldFormatScore = Math.min(Math.floor(scoring.trustScore / 8), 100); // Scale 0-800 to 0-100
  
  // Map new levels to old level names
  const levelMap = {
    'L1': 'NEW',
    'L2': 'BASIC', 
    'L3': 'VERIFIED',
    'L4': 'PRO',
    'L5': 'ELITE'
  };

  return {
    score: oldFormatScore,
    level: levelMap[scoring.level] || 'NEW',
    breakdown: {
      trustScore: {
        score: scoring.trustScore,
        max: 800,
        categories: scoring.trustScoreBreakdown
      },
      verificationLevel: {
        level: scoring.level,
        name: scoring.levelName,
        count: scoring.verificationCount
      }
    },
    trustScore: scoring.trustScore,
    verificationLevel: scoring.level,
    verificationLevelName: scoring.levelName,
    verificationCount: scoring.verificationCount,
    onChain: !!onChainData?.identity,
    boaEligible: checkBoaEligibility(profile.id, activityData).eligible
  };
}

/**
 * Compute score with on-chain data integration
 */
function computeScoreWithOnChain(profile) {
  // Try to fetch on-chain data
  let onChainData = null;
  try {
    const wallet = typeof profile.wallets === 'string' ? 
      JSON.parse(profile.wallets) : profile.wallets;
    const solanaWallet = wallet?.solana;
    if (solanaWallet) {
      onChainData = fetchOnChainData(solanaWallet);
    }
  } catch (e) {
    // Continue without on-chain data
  }
  
  return computeScore(profile, onChainData);
}

/**
 * Compute leaderboard with new scoring
 */
function computeLeaderboard(profiles, limit = 50) {
  const scored = profiles.map(profile => {
    const score = computeScore(profile);
    return {
      ...profile,
      ...score
    };
  });

  // Sort by Trust Score within same Verification Level
  scored.sort((a, b) => {
    // First by verification level (L5 > L4 > L3 > L2 > L1)
    const levelOrder = { 'L5': 5, 'L4': 4, 'L3': 3, 'L2': 2, 'L1': 1 };
    const aLevel = levelOrder[a.verificationLevel] || 1;
    const bLevel = levelOrder[b.verificationLevel] || 1;
    
    if (aLevel !== bLevel) {
      return bLevel - aLevel; // Higher level first
    }
    
    // Then by trust score (higher first)
    return b.trustScore - a.trustScore;
  });

  return scored.slice(0, limit);
}

/**
 * Fetch on-chain data from SATP (placeholder)
 */
async function fetchOnChainData(solanaWallet) {
  try {
    // This would fetch from SATP Identity program
    // For now, return null to indicate no on-chain data
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Get new scoring API endpoint data
 */
function getV2Scoring(profileId, includeBreakdown = true) {
  const profile = require('./lib/profile').loadProfile(profileId);
  if (!profile) {
    return { error: 'Profile not found' };
  }

  const activityData = getActivityData(profile);
  const scoring = getProfileScoring(profileId, activityData);
  
  if (!scoring) {
    return { error: 'Could not calculate scoring' };
  }

  const result = {
    profileId,
    verificationLevel: {
      level: scoring.level,
      name: scoring.levelName,
      verificationCount: scoring.verificationCount
    },
    trustScore: {
      total: scoring.trustScore,
      max: 800
    }
  };

  if (includeBreakdown) {
    result.trustScore.breakdown = scoring.trustScoreBreakdown;
  }

  const boaCheck = checkBoaEligibility(profileId, activityData);
  result.boaEligible = boaCheck.eligible;
  if (!boaCheck.eligible) {
    result.boaRequirements = boaCheck.reason;
  }

  return result;
}

module.exports = {
  computeScore,
  computeScoreWithOnChain,
  computeLeaderboard,
  fetchOnChainData,
  getV2Scoring
};