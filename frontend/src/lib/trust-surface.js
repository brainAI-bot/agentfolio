const TRUST_LEVEL_NAMES = ['Unclaimed', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];
const TRUST_LEVEL_BADGES = ['⚪', '🟡', '🔵', '🟢', '🟠', '🟣'];
const UNAVAILABLE_REVIEW_COPY = 'No reviews yet';
const UNAVAILABLE_JOB_COPY = 'No completed jobs yet';

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTrustScore(score) {
  return clamp(Math.round(finiteNumber(score, 0)), 0, 800);
}

function normalizeVerificationLevel(level) {
  return clamp(Math.round(finiteNumber(level, 0)), 0, 5);
}

function formatTrustScore(score) {
  return `${normalizeTrustScore(score)} Trust`;
}

function formatTrustScoreFraction(score) {
  return `${normalizeTrustScore(score)}/800`;
}

function formatTrustTier(level, label) {
  const normalizedLevel = normalizeVerificationLevel(level);
  return `L${normalizedLevel} · ${label || TRUST_LEVEL_NAMES[normalizedLevel] || TRUST_LEVEL_NAMES[0]}`;
}

function formatReviewSummary(reviewCount, rating) {
  const count = Math.max(0, Math.round(finiteNumber(reviewCount, 0)));
  const avg = finiteNumber(rating, 0);
  if (count <= 0) return UNAVAILABLE_REVIEW_COPY;
  return `${avg > 0 ? avg.toFixed(1) : '0.0'}★ (${count} ${count === 1 ? 'review' : 'reviews'})`;
}

function formatJobHistory(jobsCompleted) {
  const count = Math.max(0, Math.round(finiteNumber(jobsCompleted, 0)));
  if (count <= 0) return UNAVAILABLE_JOB_COPY;
  return `${count} completed ${count === 1 ? 'job' : 'jobs'}`;
}

function getTrustSurface(agent = {}, overrides = {}) {
  const trustScore = normalizeTrustScore(
    overrides.trustScore ?? overrides.reputationScore ?? agent.reputationScore ?? agent.trustScore
  );
  const verificationLevel = normalizeVerificationLevel(
    overrides.verificationLevel ?? agent.verificationLevel ?? agent.tier
  );
  const verificationLevelName = overrides.verificationLevelName
    || agent.verificationLevelName
    || TRUST_LEVEL_NAMES[verificationLevel]
    || TRUST_LEVEL_NAMES[0];
  const verificationBadge = overrides.verificationBadge
    || TRUST_LEVEL_BADGES[verificationLevel]
    || agent.verificationBadge
    || TRUST_LEVEL_BADGES[0];
  const reviewCount = Math.max(0, Math.round(finiteNumber(
    overrides.reviewCount ?? agent.reviewCount ?? agent.reviewsReceived,
    0
  )));
  const rating = finiteNumber(overrides.rating ?? agent.rating, 0);
  const jobsCompleted = Math.max(0, Math.round(finiteNumber(
    overrides.jobsCompleted ?? agent.jobsCompleted,
    0
  )));

  return {
    trustScore,
    trustScoreLabel: formatTrustScore(trustScore),
    trustScoreFraction: formatTrustScoreFraction(trustScore),
    verificationLevel,
    verificationLevelName,
    verificationBadge,
    tierLabel: formatTrustTier(verificationLevel, verificationLevelName),
    reputationRank: overrides.reputationRank || agent.reputationRank || verificationLevelName,
    reviewCount,
    rating,
    reviewSummary: formatReviewSummary(reviewCount, rating),
    jobsCompleted,
    jobHistory: formatJobHistory(jobsCompleted),
  };
}

module.exports = {
  TRUST_LEVEL_NAMES,
  TRUST_LEVEL_BADGES,
  UNAVAILABLE_REVIEW_COPY,
  UNAVAILABLE_JOB_COPY,
  formatTrustScore,
  formatTrustScoreFraction,
  formatTrustTier,
  formatReviewSummary,
  formatJobHistory,
  getTrustSurface,
};
