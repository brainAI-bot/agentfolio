const { computeUnifiedTrustScore } = require('./unified-trust-score');

const FEE_TRUST_THRESHOLDS = Object.freeze({
  0: 0,
  1: 0,
  2: 240,
  3: 400,
  4: 560,
});

const BOA_MIN_LEVEL = 3;
const BOA_MIN_TRUST_SCORE = 50;

function normalizeTrustScoreValue(value) {
  const score = Number(value || 0);
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(800, Math.round(score));
}

function resolveTrustScoreFromDb(db, profileId, options = {}) {
  if (!db || !profileId) {
    return {
      profileId,
      trustScore: 0,
      score: 0,
      verificationLevel: 0,
      verificationLevelName: 'Unverified',
      source: 'missing-profile',
      breakdown: {},
    };
  }

  try {
    const profile = options.profile || db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) {
      return {
        profileId,
        trustScore: 0,
        score: 0,
        verificationLevel: 0,
        verificationLevelName: 'Unverified',
        source: 'missing-profile',
        breakdown: {},
      };
    }

    const unified = computeUnifiedTrustScore(db, profile, options);
    const trustScore = normalizeTrustScoreValue(unified.trustScore ?? unified.score);

    return {
      ...unified,
      profileId,
      trustScore,
      score: trustScore,
      reputationScore: trustScore,
      verificationLevel: Number(unified.level || unified.verificationLevel || 0),
      verificationLevelName: unified.levelName || unified.verificationLevelName || 'Unverified',
    };
  } catch (_) {
    return {
      profileId,
      trustScore: 0,
      score: 0,
      verificationLevel: 0,
      verificationLevelName: 'Unverified',
      source: 'trust-score-error',
      breakdown: {},
    };
  }
}

function getFeeTierForTrustScore(trustScore, tiers) {
  const score = normalizeTrustScoreValue(trustScore);
  let bestTier = 0;

  for (const tier of tiers || []) {
    if (tier.tier === 5) continue;
    const required = tier.minTrustScore ?? FEE_TRUST_THRESHOLDS[tier.tier] ?? 0;
    if (score >= required) bestTier = tier.tier;
  }

  return bestTier;
}

function checkBoaEligibilityFromTrust(trust = {}) {
  const level = Number(trust.verificationLevel ?? trust.level ?? 0);
  const trustScore = normalizeTrustScoreValue(trust.trustScore ?? trust.score ?? trust.reputationScore);

  if (level < BOA_MIN_LEVEL) {
    return {
      eligible: false,
      reason: `Level ${level} insufficient (need L${BOA_MIN_LEVEL}+)`,
      level,
      trustScore,
    };
  }

  if (trustScore < BOA_MIN_TRUST_SCORE) {
    return {
      eligible: false,
      reason: `Trust Score ${trustScore} insufficient (need ${BOA_MIN_TRUST_SCORE}+)`,
      level,
      trustScore,
    };
  }

  return { eligible: true, level, trustScore };
}

function getReviewWeightForTrustScore(trustScore) {
  const score = normalizeTrustScoreValue(trustScore);
  if (score >= 560) return 3;
  if (score >= 320) return 2;
  return 1;
}

module.exports = {
  BOA_MIN_LEVEL,
  BOA_MIN_TRUST_SCORE,
  FEE_TRUST_THRESHOLDS,
  normalizeTrustScoreValue,
  resolveTrustScoreFromDb,
  getFeeTierForTrustScore,
  checkBoaEligibilityFromTrust,
  getReviewWeightForTrustScore,
};
