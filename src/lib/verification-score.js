/**
 * Verification Scoring System
 * Calculates a verificationScore based on specific verification actions.
 */

const SCORE_TABLE = {
  github:           { points: 20, label: 'GitHub Verified',           icon: '💻' },
  x:          { points: 15, label: 'Twitter/X Verified',        icon: '🐦' },
  solana:           { points: 20, label: 'Solana Wallet Verified',    icon: '◎' },
  email:            { points: 10, label: 'Email Verified',            icon: '📧' },
  custom:           { points: 10, label: 'Custom Provider Verified',  icon: '🔗' },
  satp:             { points: 30, label: 'SATP On-Chain Identity',    icon: '⛓️' },
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
  const vd = profile.verificationData || {};
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

  // Twitter
  if (vd.twitter?.verified) award('twitter'); else miss('twitter');

  // Solana wallet
  if (vd.solana?.verified) award('solana'); else miss('solana');

  // Email (check agentmail verification or email field)
  if (vd.email?.verified || vd.agentmail?.verified || profile.links?.agentmail) {
    award('email');
  } else {
    miss('email');
  }

  // Custom provider (any non-standard verification)
  const standardKeys = new Set(['github', 'twitter', 'solana', 'email', 'agentmail', 'satp', 'onboardingDismissed', 'hyperliquid', 'polymarket', 'telegram']);
  const customVerified = Object.entries(vd).some(([k, v]) => !standardKeys.has(k) && v?.verified);
  // Also count hyperliquid/polymarket as custom
  if (customVerified || vd.hyperliquid?.verified || vd.polymarket?.verified) {
    award('custom');
  } else {
    miss('custom');
  }

  // SATP on-chain
  if (vd.satp?.verified || profile.registeredOnChain) {
    award('satp');
  } else {
    miss('satp');
  }

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
