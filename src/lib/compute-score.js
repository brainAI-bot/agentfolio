/**
 * @deprecated Scoring v1 compatibility wrapper.
 *
 * Source of truth is now:
 * - computeVerificationLevel() in ./compute-level
 * - computeTrustScore() in ./compute-trust-score
 */

const { LEVELS, computeVerificationLevel, hasHumanVerificationCredential } = require('./compute-level');
const { computeTrustScore } = require('./compute-trust-score');
const {
  CATEGORY_MAP,
  normalizeVerificationPlatform,
  normalizeVerifications,
  isSatpPlatform,
  getVerificationCategory,
} = require('./verification-categories');
const {
  parseArrayish,
  countPortfolioItems,
  summarizeProfileCompleteness,
  isProfileCompleteForLevel,
  computeProfileCompleteness,
} = require('./profile-completeness');

function computeScore(verifications = [], opts = {}) {
  const profile = opts.profile || {};
  const level = computeVerificationLevel({ ...opts, verifications, profile });
  const trust = computeTrustScore({ ...opts, verifications, profile });

  return {
    score: trust.trustScore,
    trustScore: trust.trustScore,
    level: level.level,
    verificationLevel: level.level,
    levelName: level.levelName,
    verificationLabel: level.levelName,
    badge: level.badge,
    breakdown: trust.breakdown,
    trustBreakdown: trust.details,
    componentTotals: trust.componentTotals,
    verificationCount: level.verificationCount,
    effectiveVerificationCount: level.effectiveVerificationCount,
    categories: level.categories,
  };
}

module.exports = {
  LEVELS,
  CATEGORY_MAP,
  normalizeVerificationPlatform,
  normalizeVerifications,
  isSatpPlatform,
  getVerificationCategory,
  hasHumanVerificationCredential,
  parseSkills: parseArrayish,
  countPortfolioItems,
  summarizeProfileCompleteness,
  computeProfileCompleteness,
  isProfileCompleteForLevel,
  computeVerificationLevel,
  computeTrustScore,
  computeScore,
};
