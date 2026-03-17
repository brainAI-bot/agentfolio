/**
 * AgentFolio Scoring Engine v2 - 2D Scoring System  
 * Replaces all existing scoring systems with clean 2D approach
 * Based on specs/scoring-redesign-v1.md
 */

// Verification Level Requirements (0-5)
const VERIFICATION_LEVELS = {
  0: {
    name: 'Unregistered',
    requirements: {},
    description: 'No requirements'
  },
  1: {
    name: 'Registered', 
    requirements: {
      profileCreated: true,
      basicInfo: true // name, handle filled
    },
    description: 'Profile created, basic info filled'
  },
  2: {
    name: 'Verified',
    requirements: {
      verificationCount: 2,
      anyCategory: true
    },
    description: '2+ verifications from any category'
  },
  3: {
    name: 'On-Chain',
    requirements: {
      satpIdentity: true, // mandatory
      verificationCount: 5,
      categoryCount: 2, // from 2+ categories
      completeProfile: true // bio, avatar, 2+ skills
    },
    description: 'SATP identity + 5 verifications from 2+ categories + complete profile'
  },
  4: {
    name: 'Trusted',
    requirements: {
      level3: true,
      completedEscrowJob: true,
      receivedReview: true
    },
    description: 'Level 3 + completed escrow job + received review'
  },
  5: {
    name: 'Sovereign',
    requirements: {
      level4: true,
      burnToBecomeAvatar: true,
      reviewCount: 3,
      humanVerification: true // GitHub or X OAuth
    },
    description: 'Level 4 + Burn-to-Become avatar + 3+ reviews + human verification'
  }
};

// Verification Categories for Level 3+ requirements
const VERIFICATION_CATEGORIES = {
  wallets: ['solana', 'ethereum', 'bitcoin', 'hyperliquid', 'polymarket'],
  platforms: ['agentmail', 'moltbook', 'telegram', 'discord', 'farcaster'],
  infrastructure: ['domain', 'mcp', 'a2a', 'openclaw', 'did', 'website'],
  onchain: ['ens', 'eas']
};

// Human-required verifications (for Level 5)
const HUMAN_VERIFICATIONS = ['github', 'x'];

/**
 * Calculate Verification Level (0-5) - deterministic
 */
function calculateVerificationLevel(profile) {
  if (!profile) return 0;
  
  // Check each level in sequence
  for (let level = 5; level >= 0; level--) {
    if (meetsLevelRequirements(profile, level)) {
      return level;
    }
  }
  
  return 0;
}

/**
 * Check if profile meets requirements for specific level
 */
function meetsLevelRequirements(profile, level) {
  const requirements = VERIFICATION_LEVELS[level].requirements;
  
  // Level 0 - always passes
  if (level === 0) return true;
  
  // Level 1 - basic profile info
  if (level === 1) {
    return profile.name && profile.handle;
  }
  
  // Level 2 - 2+ verifications from any category
  if (level === 2) {
    const verificationCount = countVerifications(profile);
    return verificationCount >= 2;
  }
  
  // Level 3 - SATP + 5 verifications from 2+ categories + complete profile
  if (level === 3) {
    const hasSATP = profile.verificationData?.satp?.verified || false;
    const verificationCount = countVerifications(profile);
    const categoryCount = countVerificationCategories(profile);
    const completeProfile = isCompleteProfile(profile);
    
    return hasSATP && verificationCount >= 5 && categoryCount >= 2 && completeProfile;
  }
  
  // Level 4 - Level 3 + completed escrow job + review
  if (level === 4) {
    const hasLevel3 = meetsLevelRequirements(profile, 3);
    const completedJob = hasCompletedEscrowJob(profile);
    const hasReview = hasReceivedReview(profile);
    
    return hasLevel3 && completedJob && hasReview;
  }
  
  // Level 5 - Level 4 + burn-to-become + 3+ reviews + human verification
  if (level === 5) {
    const hasLevel4 = meetsLevelRequirements(profile, 4);
    const burnToBecomeAvatar = hasBurnToBecomeAvatar(profile);
    const reviewCount = getReviewCount(profile);
    const humanVerification = hasHumanVerification(profile);
    
    return hasLevel4 && burnToBecomeAvatar && reviewCount >= 3 && humanVerification;
  }
  
  return false;
}

/**
 * Count total verifications (excluding basic profile data)
 */
function countVerifications(profile) {
  if (!profile.verificationData) return 0;
  
  let count = 0;
  for (const [provider, data] of Object.entries(profile.verificationData)) {
    if (data && (data.verified || data.success)) {
      count++;
    }
  }
  
  return count;
}

/**
 * Count verification categories for Level 3+ requirement
 */
function countVerificationCategories(profile) {
  if (!profile.verificationData) return 0;
  
  const categoriesFound = new Set();
  
  for (const [provider, data] of Object.entries(profile.verificationData)) {
    if (!data || !data.verified) continue;
    
    // Find which category this provider belongs to
    for (const [categoryName, providers] of Object.entries(VERIFICATION_CATEGORIES)) {
      if (providers.includes(provider)) {
        categoriesFound.add(categoryName);
        break;
      }
    }
  }
  
  return categoriesFound.size;
}

/**
 * Check if profile has complete information for Level 3+
 */
function isCompleteProfile(profile) {
  const hasBio = profile.bio && profile.bio.trim().length > 0;
  const hasAvatar = profile.avatar && profile.avatar.trim().length > 0;
  const skillCount = profile.skills ? profile.skills.length : 0;
  
  return hasBio && hasAvatar && skillCount >= 2;
}

/**
 * Check if has completed escrow job (for Level 4+)
 */
function hasCompletedEscrowJob(profile) {
  // Check stats.jobsCompleted or marketplace data
  const stats = profile.stats || {};
  return (stats.jobsCompleted || 0) > 0;
}

/**
 * Check if has received review (for Level 4+)  
 */
function hasReceivedReview(profile) {
  return getReviewCount(profile) > 0;
}

/**
 * Get review count
 */
function getReviewCount(profile) {
  const stats = profile.stats || {};
  return stats.reviewsReceived || 0;
}

/**
 * Check if has burn-to-become avatar (for Level 5)
 */
function hasBurnToBecomeAvatar(profile) {
  return !!(profile.nftAvatar && profile.nftAvatar.verifiedOnChain);
}

/**
 * Check if has human-required verification (for Level 5)
 */
function hasHumanVerification(profile) {
  if (!profile.verificationData) return false;
  
  for (const provider of HUMAN_VERIFICATIONS) {
    if (profile.verificationData[provider]?.verified) {
      return true;
    }
  }
  
  return false;
}

/**
 * Calculate Reputation Score (0-1000) - behavioral signals
 */
function calculateReputationScore(profile) {
  if (!profile) return 0;
  
  let score = 0;
  
  // Base points for verification level (foundation)
  const level = calculateVerificationLevel(profile);
  score += level * 20; // 0-100 points from verification level
  
  // Reviews (heaviest weight)
  const reviews = getProfileReviews(profile);
  score += calculateReviewScore(reviews); // 0-500 points
  
  // Endorsements (weighted by endorser level/rep)
  const endorsements = getProfileEndorsements(profile);
  score += calculateEndorsementScore(endorsements, profile); // 0-200 points
  
  // Job completion rate and ratings
  const jobStats = getProfileJobStats(profile);
  score += calculateJobScore(jobStats); // 0-200 points
  
  // Time decay (inactive agents lose rep slowly)
  const activityMultiplier = calculateActivityMultiplier(profile);
  score = Math.floor(score * activityMultiplier);
  
  // Soft cap at 1000
  return Math.min(score, 1000);
}

/**
 * Calculate score from reviews (0-500 points)
 */
function calculateReviewScore(reviews) {
  if (!reviews || reviews.length === 0) return 0;
  
  const avgRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length;
  const reviewCount = reviews.length;
  
  // Base score from average rating (0-5 scale)
  let score = (avgRating / 5) * 200; // 0-200 points
  
  // Bonus for review count (diminishing returns)
  score += Math.min(reviewCount * 30, 300); // 0-300 points
  
  return Math.floor(score);
}

/**
 * Calculate score from endorsements (0-200 points)
 */
function calculateEndorsementScore(endorsements, profile) {
  if (!endorsements || endorsements.length === 0) return 0;
  
  let score = 0;
  
  for (const endorsement of endorsements) {
    const endorserLevel = endorsement.endorserLevel || 1;
    const endorserRep = endorsement.endorserReputation || 0;
    
    // Weight endorsement by endorser's level and reputation
    let weight = 1;
    weight *= Math.max(1, endorserLevel); // Level multiplier
    weight *= Math.max(1, endorserRep / 100); // Rep multiplier (soft)
    
    score += Math.min(weight * 10, 50); // Max 50 points per endorsement
  }
  
  return Math.min(Math.floor(score), 200);
}

/**
 * Calculate score from job performance (0-200 points)
 */
function calculateJobScore(jobStats) {
  if (!jobStats || jobStats.completed === 0) return 0;
  
  const completionRate = jobStats.completed / (jobStats.total || 1);
  const avgRating = jobStats.avgRating || 0;
  
  let score = completionRate * 100; // 0-100 for completion rate
  score += (avgRating / 5) * 100; // 0-100 for rating quality
  
  return Math.floor(score);
}

/**
 * Calculate activity-based multiplier (0.5-1.0)
 */
function calculateActivityMultiplier(profile) {
  const lastActivity = profile.lastActivity || profile.createdAt;
  if (!lastActivity) return 1.0;
  
  const daysSinceActivity = (Date.now() - new Date(lastActivity)) / (1000 * 60 * 60 * 24);
  
  // No decay for first 30 days
  if (daysSinceActivity <= 30) return 1.0;
  
  // Linear decay over next 335 days (1 year total)
  // At 365 days: 0.5x multiplier
  const decayRate = Math.max(0.5, 1.0 - ((daysSinceActivity - 30) / 670));
  
  return decayRate;
}

// Placeholder functions for data that would come from other systems

function getProfileReviews(profile) {
  // Use stats for review data
  const stats = profile.stats || {};
  const reviewCount = stats.reviewsReceived || 0;
  const avgRating = stats.rating || 0;
  if (reviewCount === 0) return [];
  // Synthesize review entries from stats
  return Array.from({length: reviewCount}, () => ({rating: avgRating}));
}

function getProfileEndorsements(profile) {
  return profile.endorsements || [];
}

function getProfileJobStats(profile) {
  const stats = profile.stats || {};
  return {
    completed: stats.jobsCompleted || 0,
    total: stats.jobsTotal || stats.jobsCompleted || 0,
    avgRating: stats.rating || 0
  };
}

/**
 * Get complete scoring information for a profile
 */
function getCompleteScore(profile) {
  const level = calculateVerificationLevel(profile);
  const reputation = calculateReputationScore(profile);
  
  return {
    verificationLevel: {
      level,
      name: VERIFICATION_LEVELS[level].name,
      description: VERIFICATION_LEVELS[level].description,
      progress: getProgressToNextLevel(profile, level)
    },
    reputationScore: {
      score: reputation,
      breakdown: getReputationBreakdown(profile),
      rank: getReputationRank(reputation)
    },
    overall: {
      tier: getTierFromLevelAndRep(level, reputation),
      summary: generateScoreSummary(level, reputation)
    }
  };
}

/**
 * Get progress information for next verification level
 */
function getProgressToNextLevel(profile, currentLevel) {
  if (currentLevel >= 5) return null;
  
  const nextLevel = currentLevel + 1;
  const nextRequirements = VERIFICATION_LEVELS[nextLevel].requirements;
  
  // Check what's missing for next level
  const missing = [];
  
  if (nextLevel === 2 && countVerifications(profile) < 2) {
    missing.push(`Need ${2 - countVerifications(profile)} more verifications`);
  }
  
  if (nextLevel === 3) {
    if (!profile.verificationData?.satp?.verified) missing.push('SATP identity required');
    if (countVerifications(profile) < 5) missing.push(`Need ${5 - countVerifications(profile)} more verifications`);
    if (countVerificationCategories(profile) < 2) missing.push('Need verifications from 2+ categories');
    if (!isCompleteProfile(profile)) missing.push('Complete profile (bio, avatar, 2+ skills)');
  }
  
  // TODO: Add requirements for levels 4-5
  
  return {
    nextLevel,
    nextLevelName: VERIFICATION_LEVELS[nextLevel].name,
    missing,
    progress: missing.length === 0 ? 100 : Math.max(0, 100 - (missing.length * 25))
  };
}

/**
 * Get reputation score breakdown
 */
function getReputationBreakdown(profile) {
  const level = calculateVerificationLevel(profile);
  const reviews = getProfileReviews(profile);
  const endorsements = getProfileEndorsements(profile);
  const jobStats = getProfileJobStats(profile);
  
  return {
    verificationBase: level * 20,
    reviews: calculateReviewScore(reviews),
    endorsements: calculateEndorsementScore(endorsements, profile),
    jobPerformance: calculateJobScore(jobStats),
    activityMultiplier: calculateActivityMultiplier(profile)
  };
}

/**
 * Get reputation rank/percentile
 */
function getReputationRank(score) {
  // Simple rank categories for now
  if (score >= 800) return 'Elite (Top 1%)';
  if (score >= 600) return 'Expert (Top 5%)';
  if (score >= 400) return 'Skilled (Top 15%)';
  if (score >= 200) return 'Competent (Top 40%)';
  if (score >= 100) return 'Developing (Top 70%)';
  return 'Newcomer';
}

/**
 * Get overall tier from level + reputation
 */
function getTierFromLevelAndRep(level, reputation) {
  if (level >= 5 && reputation >= 800) return 'Sovereign Elite';
  if (level >= 4 && reputation >= 600) return 'Trusted Expert';
  if (level >= 3 && reputation >= 400) return 'On-Chain Skilled';
  if (level >= 2 && reputation >= 200) return 'Verified Competent';
  if (level >= 1) return 'Registered';
  return 'Unregistered';
}

/**
 * Generate human-readable score summary
 */
function generateScoreSummary(level, reputation) {
  const levelName = VERIFICATION_LEVELS[level].name;
  const repRank = getReputationRank(reputation);
  
  return `${levelName} agent with ${repRank} reputation (${reputation}/1000)`;
}

module.exports = {
  calculateVerificationLevel,
  calculateReputationScore,
  getCompleteScore,
  VERIFICATION_LEVELS,
  VERIFICATION_CATEGORIES,
  HUMAN_VERIFICATIONS
};
