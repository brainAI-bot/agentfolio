/**
 * Verification Scoring System
 * Calculates a verificationScore based on specific verification actions.
 */

const { filterCanonicalTrustData } = require('./canonical-verification-providers');

const SCORE_TABLE = {
  github:           { points: 20, label: 'GitHub Verified',           icon: '💻' },
  solana:           { points: 20, label: 'Solana Wallet Verified',    icon: '◎' },
  domain:           { points: 20, label: 'Domain Verified',           icon: '🔗' },
  website:          { points: 20, label: 'Website Verified',          icon: '🌐' },
  marketplace_job:  { points: 25, label: 'Completed 1+ Job',         icon: '💼' },
  profile_complete: { points: 10, label: 'Profile Complete',          icon: '✅' },
};

const MAX_SCORE = Object.values(SCORE_TABLE).reduce((sum, v) => sum + v.points, 0); // 140

/**
 * Calculate verification score breakdown for a profile.
 * @param {object} profile - Full profile object
 * @param {object} [opts] - Optional: { marketplaceStats }
 * @returns {{ score: number, maxScore: number, breakdown: Array, missing: Array, percentage: number }}
 */
function calculateVerificationScore(profile, opts = {}) {
  const vd = filterCanonicalTrustData(profile.verificationData || profile.verification_data || {});
  const breakdown = [];
  const missing = [];
  let score = 0;

  function award(key) {
    const entry = SCORE_TABLE[key];
    breakdown.push({ key, ...entry, earned: true });
    score += entry.points;
  }

  function miss(key) {
    const entry = SCORE_TABLE[key];
    missing.push({ key, ...entry, earned: false });
  }

  // GitHub
  if (vd.github?.verified) award('github'); else miss('github');

  // Solana wallet
  if (vd.solana?.verified) award('solana'); else miss('solana');

  if (vd.domain?.verified) award('domain'); else miss('domain');

  if (vd.website?.verified) award('website'); else miss('website');

  // Marketplace job completed
  const mktStats = opts.marketplaceStats || {};
  if ((mktStats.completedJobs || 0) >= 1 || (profile.stats?.jobsCompleted || 0) >= 1) {
    award('marketplace_job');
  } else {
    miss('marketplace_job');
  }

  // Profile completeness
  const hasBio = profile.bio && profile.bio.length > 20;
  const hasAvatar = profile.avatar && profile.avatar !== '/default-avatar.png';
  const hasSkills = profile.skills && profile.skills.length >= 2;
  if (hasBio && hasAvatar && hasSkills) {
    award('profile_complete');
  } else {
    miss('profile_complete');
  }

  return {
    score,
    maxScore: MAX_SCORE,
    percentage: Math.round((score / MAX_SCORE) * 100),
    breakdown,
    missing,
    tier: score >= 100 ? 'trusted' : score >= 65 ? 'established' : score >= 30 ? 'verified' : 'basic',
  };
}

module.exports = { calculateVerificationScore, SCORE_TABLE, MAX_SCORE };
