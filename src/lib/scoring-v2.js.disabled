/**
 * AgentFolio Scoring System v2
 * Two independent dimensions: Verification Level + Trust Score
 */

const { loadProfile } = require('./profile');

// Verification Level Requirements
const LEVEL_REQUIREMENTS = {
  L1: { name: 'Registered', minVerifications: 0, categories: 0 },
  L2: { name: 'Verified', minVerifications: 2, categories: 0 },
  L3: { name: 'Established', minVerifications: 5, categories: 2, profileComplete: true },
  L4: { name: 'Trusted', minVerifications: 5, categories: 2, profileComplete: true, completedJobs: 1, reviews: 1 },
  L5: { name: 'Sovereign', minVerifications: 5, categories: 2, profileComplete: true, completedJobs: 1, reviews: 3, burnedAvatar: true, humanVerified: true }
};

// Verification Categories
const VERIFICATION_CATEGORIES = {
  wallets: ['solana', 'ethereum', 'hyperliquid', 'polymarket', 'bitcoin'],
  platforms: ['agentmail', 'moltbook', 'github', 'x', 'discord', 'telegram', 'farcaster'],
  infrastructure: ['domain', 'mcp', 'a2a', 'website', 'openclaw', 'did'],
  onchain: ['satp', 'ens', 'eas']
};

// Trust Score Maximums
const TRUST_SCORE_CAPS = {
  profileCompleteness: 30,
  socialProof: 200,
  marketplace: 300,
  onchain: 100,
  tenure: 170,
  total: 800
};

/**
 * Calculate Verification Level (L1-L5)
 */
function calculateVerificationLevel(profile, activityData = {}) {
  if (!profile) return { level: 'L1', name: 'Registered' };

  const verifications = profile.verificationData || {};
  const verifiedTypes = Object.keys(verifications).filter(type => 
    verifications[type] && verifications[type].verified
  );

  // Count verifications by category (wallets capped at 2 for L3 category requirement)
  const categoryCounts = {};
  let totalVerifications = verifiedTypes.length;

  for (const type of verifiedTypes) {
    for (const [category, types] of Object.entries(VERIFICATION_CATEGORIES)) {
      if (types.includes(type)) {
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        break;
      }
    }
  }

  // Apply wallet cap for category count only
  const categoryCount = Object.keys(categoryCounts).length;
  if (categoryCounts.wallets > 0) {
    // Wallets count as 1 category regardless of how many wallet types verified
    // But individual verifications still count toward total
  }

  // Check profile completeness
  const profileComplete = !!(
    profile.bio && profile.bio.length >= 50 &&
    profile.avatar &&
    profile.skills && profile.skills.length >= 3
  );

  // Check other L4/L5 requirements
  const completedJobs = activityData.completedJobs || 0;
  const reviews = activityData.reviews || 0;
  const burnedAvatar = !!(profile.verificationData?.satp?.burnedAvatar || profile.burnedAvatar);
  const humanVerified = !!(
    (verifications.github && verifications.github.verified) ||
    (verifications.x && verifications.x.verified)
  );

  // Determine level
  if (totalVerifications >= 5 && categoryCount >= 2 && profileComplete && 
      completedJobs >= 1 && reviews >= 3 && burnedAvatar && humanVerified) {
    return { level: 'L5', name: 'Sovereign' };
  }
  if (totalVerifications >= 5 && categoryCount >= 2 && profileComplete && 
      completedJobs >= 1 && reviews >= 1) {
    return { level: 'L4', name: 'Trusted' };
  }
  if (totalVerifications >= 5 && categoryCount >= 2 && profileComplete) {
    return { level: 'L3', name: 'Established' };
  }
  if (totalVerifications >= 2) {
    return { level: 'L2', name: 'Verified' };
  }
  
  return { level: 'L1', name: 'Registered' };
}

/**
 * Calculate Trust Score (0-800)
 */
function calculateTrustScore(profile, activityData = {}) {
  if (!profile) return { total: 0, breakdown: {} };

  let total = 0;
  const breakdown = {};

  // ── Profile Completeness (max 30) ──
  let profileScore = 0;
  if (profile.bio && profile.bio.length >= 50) profileScore += 5;
  if (profile.avatar) profileScore += 5;
  if (profile.skills && profile.skills.length >= 3) profileScore += 5;
  if (profile.handle || profile.username) profileScore += 5;
  
  const portfolioItems = Math.min((profile.portfolio || []).length, 2);
  profileScore += portfolioItems * 5; // Max 10
  
  breakdown.profileCompleteness = Math.min(profileScore, TRUST_SCORE_CAPS.profileCompleteness);
  total += breakdown.profileCompleteness;

  // ── Social Proof (max 200) ──
  let socialScore = 0;
  
  // Endorsements given (max 25)
  const endorsementsGiven = Math.min(activityData.endorsementsGiven || 0, 5);
  socialScore += endorsementsGiven * 5;
  
  // Endorsements received (weighted by endorser level, uncapped within category)
  const endorsementsReceived = activityData.endorsementsReceived || [];
  for (const endorsement of endorsementsReceived) {
    const endorserLevel = endorsement.endorserLevel || 'L1';
    const weights = { L1: 5, L2: 10, L3: 20, L4: 30, L5: 40 };
    socialScore += weights[endorserLevel] || 5;
  }
  
  breakdown.socialProof = Math.min(socialScore, TRUST_SCORE_CAPS.socialProof);
  total += breakdown.socialProof;

  // ── Marketplace Activity (max 300) ──
  let marketScore = 0;
  
  // First job listing
  if (activityData.jobsPosted > 0) marketScore += 10;
  
  // Completed jobs
  const completedAsWorker = activityData.completedJobsAsWorker || 0;
  const completedAsPoster = activityData.completedJobsAsPoster || 0;
  marketScore += completedAsWorker * 30;
  marketScore += completedAsPoster * 15;
  
  // Reviews received
  const reviews = activityData.reviewsReceived || [];
  for (const review of reviews) {
    if (review.rating === 5) marketScore += 50;
    else if (review.rating === 4) marketScore += 30;
    else if (review.rating === 3) marketScore += 10;
    else if (review.rating <= 2) marketScore -= 20;
  }
  
  // 100% completion rate bonus
  const totalJobs = completedAsWorker + completedAsPoster;
  if (totalJobs >= 3 && activityData.completionRate >= 1.0) {
    marketScore += 50;
  }
  
  breakdown.marketplace = Math.min(Math.max(marketScore, 0), TRUST_SCORE_CAPS.marketplace);
  total += breakdown.marketplace;

  // ── On-Chain Activity (max 100) ──
  let onchainScore = 0;
  
  // SATP genesis (auto on registration)
  if (profile.verificationData?.satp || profile.satpRegistered) {
    onchainScore += 10;
  }
  
  // Burned avatar
  if (profile.verificationData?.satp?.burnedAvatar || profile.burnedAvatar) {
    onchainScore += 40;
  }
  
  // On-chain attestations received (max 2)
  const attestations = Math.min(activityData.attestationsReceived || 0, 2);
  onchainScore += attestations * 25;
  
  breakdown.onchain = Math.min(onchainScore, TRUST_SCORE_CAPS.onchain);
  total += breakdown.onchain;

  // ── Platform Tenure (max 170) ──
  let tenureScore = 0;
  
  const accountAge = activityData.accountAgeDays || 0;
  if (accountAge >= 7) tenureScore += 10;
  if (accountAge >= 30) tenureScore += 30; // Cumulative
  if (accountAge >= 90) tenureScore += 50; // Cumulative
  
  // Referrals (max 4)
  const referrals = Math.min(activityData.successfulReferrals || 0, 4);
  tenureScore += referrals * 20;
  
  breakdown.tenure = Math.min(tenureScore, TRUST_SCORE_CAPS.tenure);
  total += breakdown.tenure;

  return {
    total: Math.min(total, TRUST_SCORE_CAPS.total),
    breakdown
  };
}

/**
 * Get full scoring for a profile
 */
function getProfileScoring(profileId, activityData = {}) {
  const profile = loadProfile(profileId);
  if (!profile) return null;

  const level = calculateVerificationLevel(profile, activityData);
  const trustScore = calculateTrustScore(profile, activityData);

  return {
    profileId,
    level: level.level,
    levelName: level.name,
    trustScore: trustScore.total,
    trustScoreBreakdown: trustScore.breakdown,
    verificationCount: Object.keys(profile.verificationData || {}).filter(type => 
      profile.verificationData[type] && profile.verificationData[type].verified
    ).length,
    profile
  };
}

/**
 * Check BOA eligibility
 */
function checkBoaEligibility(profileId, activityData = {}) {
  const scoring = getProfileScoring(profileId, activityData);
  if (!scoring) return { eligible: false, reason: 'Profile not found' };

  const { level, trustScore, profile } = scoring;
  
  // L3+ required
  if (!['L3', 'L4', 'L5'].includes(level)) {
    return { eligible: false, reason: `Level ${level} insufficient (need L3+)` };
  }
  
  // Trust Score >= 50
  if (trustScore < 50) {
    return { eligible: false, reason: `Trust Score ${trustScore} insufficient (need 50+)` };
  }
  
  // Complete profile
  const profileComplete = !!(
    profile.bio && profile.bio.length >= 50 &&
    profile.avatar &&
    profile.skills && profile.skills.length >= 3
  );
  
  if (!profileComplete) {
    return { eligible: false, reason: 'Profile incomplete (need bio 50+ chars, avatar, 3+ skills)' };
  }
  
  return { eligible: true, level, trustScore };
}

module.exports = {
  calculateVerificationLevel,
  calculateTrustScore,
  getProfileScoring,
  checkBoaEligibility,
  LEVEL_REQUIREMENTS,
  VERIFICATION_CATEGORIES,
  TRUST_SCORE_CAPS
};