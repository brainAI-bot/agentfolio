const LEVEL_LABELS = ['Unverified', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];
const TRUST_LEVEL_LABELS = ['Unclaimed', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];
const LEVEL_BADGES = ['\u26aa', '\ud83d\udfe1', '\ud83d\udd35', '\ud83d\udfe2', '\ud83d\udfe0', '\ud83d\udfe3'];

const LEVEL_MAP = {
  NEW: 0,
  UNCLAIMED: 0,
  UNVERIFIED: 0,
  REGISTERED: 1,
  L1: 1,
  BASIC: 2,
  VERIFIED: 2,
  L2: 2,
  ESTABLISHED: 3,
  L3: 3,
  TRUSTED: 4,
  L4: 4,
  SOVEREIGN: 5,
  ELITE: 5,
  L5: 5,
};

function normalizeTrustScoreValue(score) {
  const numeric = Number(score || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric > 800 ? Math.min(Math.round(numeric / 10000), 800) : Math.max(0, Math.round(numeric));
}

function normalizeLevel(value, score = 0) {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.min(5, Number(value)));
  const mapped = LEVEL_MAP[String(value || '').trim().toUpperCase()];
  if (mapped !== undefined) return mapped;
  if (score >= 600) return 5;
  if (score >= 450) return 4;
  if (score >= 300) return 3;
  if (score >= 100) return 2;
  if (score > 0) return 1;
  return 0;
}

function pluralize(count, singular, plural = singular + 's') {
  return `${count} ${count === 1 ? singular : plural}`;
}

function queryOne(db, sql, params = [], fallback = null) {
  try {
    return db.prepare(sql).get(...params) || fallback;
  } catch (_) {
    return fallback;
  }
}

function summarizeReviews(input = {}) {
  const count = Math.max(0, Number(input.count ?? input.total ?? input.total_reviews ?? 0) || 0);
  const averageRating = count > 0 ? Number(input.averageRating ?? input.avgRating ?? input.avg_rating ?? 0) || 0 : 0;
  const roundedAverage = count > 0 ? Number(averageRating.toFixed(2)) : 0;

  return {
    count,
    averageRating: roundedAverage,
    label: count > 0
      ? `${roundedAverage.toFixed(1)} average from ${pluralize(count, 'review')}`
      : 'No reviews yet',
    fallback: count === 0,
  };
}

function summarizeJobHistory(input = {}) {
  const completed = Math.max(0, Number(input.completed ?? input.completedJobs ?? input.completed_jobs ?? 0) || 0);
  const posted = Math.max(0, Number(input.posted ?? input.postedJobs ?? input.posted_jobs ?? 0) || 0);
  const total = Math.max(completed + posted, Number(input.total ?? input.totalJobs ?? input.total_jobs ?? 0) || 0);

  let label = 'No jobs yet';
  if (completed > 0 && posted > 0) {
    label = `${pluralize(completed, 'completed job')} / ${pluralize(posted, 'posted job')}`;
  } else if (completed > 0) {
    label = pluralize(completed, 'completed job');
  } else if (posted > 0) {
    label = pluralize(posted, 'posted job');
  }

  return {
    completed,
    posted,
    total,
    label,
    fallback: total === 0,
  };
}

function loadReviewSummary(db, profileId, fallback = {}) {
  const row = queryOne(
    db,
    'SELECT COUNT(*) AS count, AVG(rating) AS averageRating FROM reviews WHERE reviewee_id = ?',
    [profileId],
    fallback
  );
  return summarizeReviews(row || fallback);
}

function loadJobHistory(db, profileId, fallback = {}) {
  const row = queryOne(
    db,
    `SELECT
       SUM(CASE WHEN client_id = ? THEN 1 ELSE 0 END) AS posted,
       SUM(CASE WHEN selected_agent_id = ? AND status = 'completed' THEN 1 ELSE 0 END) AS completed,
       COUNT(*) AS total
     FROM jobs
     WHERE client_id = ? OR selected_agent_id = ?`,
    [profileId, profileId, profileId, profileId],
    fallback
  );
  return summarizeJobHistory(row || fallback);
}

function buildReputationSurface({
  profile,
  unified,
  v3Score = null,
  score = null,
  level = null,
  levelName = null,
  source = null,
  db = null,
  reviewSummary = null,
  jobHistory = null,
  trustLevelLabels = false,
} = {}) {
  const profileId = profile?.id || profile?.profileId || null;
  const displayScore = normalizeTrustScoreValue(score ?? v3Score?.reputationScore ?? unified?.score ?? unified?.trustScore ?? 0);
  const displayLevel = normalizeLevel(
    level ?? v3Score?.verificationLevel ?? unified?.level,
    displayScore
  );
  const labels = trustLevelLabels ? TRUST_LEVEL_LABELS : LEVEL_LABELS;
  const displayLevelName =
    levelName ||
    v3Score?.verificationLabel ||
    v3Score?.tierLabel ||
    v3Score?.tier ||
    unified?.levelName ||
    labels[displayLevel] ||
    labels[0];

  const reviews = reviewSummary
    ? summarizeReviews(reviewSummary)
    : (db && profileId ? loadReviewSummary(db, profileId) : summarizeReviews());
  const jobs = jobHistory
    ? summarizeJobHistory(jobHistory)
    : (db && profileId ? loadJobHistory(db, profileId) : summarizeJobHistory());
  const breakdown = unified?.breakdown || {};
  const trustScoreBreakdown = unified?.trustBreakdown || breakdown;

  return {
    score: displayScore,
    trustScore: displayScore,
    reputationScore: displayScore,
    level: displayLevel,
    levelName: displayLevelName,
    verificationLevel: displayLevel,
    verificationLevelName: displayLevelName,
    verificationLabel: displayLevelName,
    tier: displayLevelName,
    verificationBadge: LEVEL_BADGES[displayLevel] || unified?.badge || LEVEL_BADGES[0],
    source: source || unified?.source || (v3Score ? 'v3-onchain' : 'scoring-v2-phase-a'),
    isBorn: !!(v3Score?.isBorn || unified?.hasBoaAvatar),
    reviewSummary: reviews,
    reviews,
    reviewCount: reviews.count,
    reviewAvg: reviews.averageRating,
    jobHistory: jobs,
    jobs,
    completedJobs: jobs.completed,
    jobsCompleted: jobs.completed,
    postedJobs: jobs.posted,
    totalJobs: jobs.total,
    breakdown,
    trustScoreBreakdown,
  };
}

module.exports = {
  LEVEL_LABELS,
  TRUST_LEVEL_LABELS,
  LEVEL_BADGES,
  normalizeTrustScoreValue,
  normalizeLevel,
  summarizeReviews,
  summarizeJobHistory,
  loadReviewSummary,
  loadJobHistory,
  buildReputationSurface,
};
