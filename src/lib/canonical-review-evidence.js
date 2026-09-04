'use strict';

const RELEASED_ESCROW_STATUSES = new Set([
  'released',
  'auto_released',
  'release_complete',
  'completed',
  'paid',
  'settled',
]);
const REPORTED_EVALUATION_FAILURES = new Set();

function createEvaluation() {
  return { evaluable: true, errors: [] };
}

function markEvaluationFailure(evaluation, operation, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (evaluation) {
    evaluation.evaluable = false;
    if (!evaluation.errors.some((item) => item.operation === operation && item.message === message)) {
      evaluation.errors.push({ operation, message });
    }
  }
  const reportKey = `${operation}\n${message}`;
  if (REPORTED_EVALUATION_FAILURES.has(reportKey)) return;
  REPORTED_EVALUATION_FAILURES.add(reportKey);
  console.error(`[CanonicalReviewEvidence] Cannot evaluate ${operation}: ${message}`);
}

function safeAll(db, sql, params = [], evaluation = null, operation = 'query') {
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    markEvaluationFailure(evaluation, operation, error);
    return [];
  }
}

function safeGet(db, sql, params = [], evaluation = null, operation = 'query') {
  try {
    return db.prepare(sql).get(...params) || null;
  } catch (error) {
    markEvaluationFailure(evaluation, operation, error);
    return null;
  }
}

function tableColumns(db, table, evaluation = null) {
  return new Set(safeAll(
    db,
    `PRAGMA table_info(${table})`,
    [],
    evaluation,
    `${table} schema`
  ).map((row) => row.name));
}

function requireColumns(columns, required, table, evaluation) {
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length === 0) return true;
  markEvaluationFailure(
    evaluation,
    `${table} schema`,
    new Error(`missing required columns: ${missing.join(', ')}`)
  );
  return false;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeIdentity(value, chain = '') {
  const normalized = String(value || '').trim();
  return String(chain || '').toLowerCase() === 'ethereum'
    ? normalized.toLowerCase()
    : normalized;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function isReleasedEscrow(escrow) {
  if (!escrow || !RELEASED_ESCROW_STATUSES.has(String(escrow.status || '').toLowerCase())) {
    return false;
  }
  return nonEmpty(escrow.release_tx_hash);
}

function escrowBindsReview(escrow, review) {
  if (!isReleasedEscrow(escrow) || !review) return false;
  return (
    (escrow.client_id === review.reviewer_id && escrow.agent_id === review.reviewee_id) ||
    (escrow.agent_id === review.reviewer_id && escrow.client_id === review.reviewee_id)
  );
}

function findCanonicalEscrow(db, review, evaluation = null) {
  if (!nonEmpty(review?.job_id)) return null;
  const escrows = safeAll(
    db,
    'SELECT * FROM escrows WHERE job_id = ?',
    [review.job_id],
    evaluation,
    'released escrow lookup'
  );
  return escrows.find((escrow) => escrowBindsReview(escrow, review)) || null;
}

function profileWalletCandidates(profile, chain) {
  if (!profile) return [];
  const wallets = parseJson(profile.wallets);
  const verificationData = parseJson(profile.verification_data);
  return [
    profile.id,
    profile.wallet,
    profile.claimed_by,
    wallets?.[chain],
    chain === 'solana' ? wallets?.solana_wallet : null,
    wallets?.wallet,
    verificationData?.[chain]?.address,
    verificationData?.[chain]?.wallet,
  ].filter(nonEmpty);
}

function isReviewerWalletBound(db, review, evaluation = null) {
  const wallet = review?.reviewer_wallet;
  const chain = String(review?.chain || '').toLowerCase();
  if (!nonEmpty(wallet) || !['solana', 'ethereum'].includes(chain)) return false;

  const columns = tableColumns(db, 'profiles', evaluation);
  if (!requireColumns(columns, ['id'], 'profiles', evaluation)) return false;
  const selected = ['id', 'wallet', 'claimed_by', 'wallets', 'verification_data']
    .filter((column) => columns.has(column));
  const profile = safeGet(
    db,
    `SELECT ${selected.join(', ')} FROM profiles WHERE id = ?`,
    [review.reviewer_id],
    evaluation,
    'reviewer profile lookup'
  );
  const expected = normalizeIdentity(wallet, chain);
  return profileWalletCandidates(profile, chain)
    .some((candidate) => normalizeIdentity(candidate, chain) === expected);
}

function classifyJobReview(db, review, evaluation = null) {
  const escrow = findCanonicalEscrow(db, review, evaluation);
  if (!escrow) {
    return { eligible: false, reason: 'missing_matching_released_escrow' };
  }
  return {
    eligible: true,
    reason: null,
    escrowId: escrow.id,
    canonicalReleasedEscrowReview: true,
    escrowParticipantMatch: true,
    reviewerIdentityBound: false,
    signatureVerified: false,
  };
}

function classifyPeerReview(db, review, evaluation = null) {
  const base = classifyJobReview(db, review, evaluation);
  if (!base.eligible) return base;
  if (Number(review.verified || 0) !== 1 || !nonEmpty(review.signature)) {
    return { eligible: false, reason: 'missing_verified_reviewer_signature' };
  }
  if (!isReviewerWalletBound(db, review, evaluation)) {
    return { eligible: false, reason: 'reviewer_wallet_not_bound_to_identity' };
  }
  return { ...base, reviewerIdentityBound: true, signatureVerified: true };
}

function decorate(review, classification, source) {
  return {
    ...review,
    reviewSource: source,
    canonicalReleasedEscrowReview: classification.canonicalReleasedEscrowReview === true,
    escrowParticipantMatch: classification.escrowParticipantMatch === true,
    reviewerIdentityBound: classification.reviewerIdentityBound === true,
    signatureVerified: classification.signatureVerified === true,
    canonicalEscrowId: classification.escrowId || null,
  };
}

function listCanonicalJobReviews(
  db,
  { revieweeId = null, reviewerId = null } = {},
  evaluation = createEvaluation()
) {
  const columns = tableColumns(db, 'reviews', evaluation);
  if (!requireColumns(columns, ['reviewee_id', 'reviewer_id', 'job_id'], 'reviews', evaluation)) return [];
  const clauses = [];
  const params = [];
  if (revieweeId !== null) { clauses.push('reviewee_id = ?'); params.push(revieweeId); }
  if (reviewerId !== null) { clauses.push('reviewer_id = ?'); params.push(reviewerId); }
  const rows = safeAll(
    db,
    `SELECT * FROM reviews${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`,
    params,
    evaluation,
    'job review lookup'
  );
  return rows.flatMap((review) => {
    const classification = classifyJobReview(db, review, evaluation);
    return classification.eligible ? [decorate(review, classification, 'reviews')] : [];
  });
}

function listCanonicalPeerReviews(
  db,
  { revieweeId = null, reviewerId = null } = {},
  evaluation = createEvaluation()
) {
  const columns = tableColumns(db, 'peer_reviews', evaluation);
  if (!requireColumns(columns, ['reviewee_id', 'reviewer_id', 'job_id'], 'peer_reviews', evaluation)) return [];
  const clauses = [];
  const params = [];
  if (revieweeId !== null) { clauses.push('reviewee_id = ?'); params.push(revieweeId); }
  if (reviewerId !== null) { clauses.push('reviewer_id = ?'); params.push(reviewerId); }
  const rows = safeAll(
    db,
    `SELECT * FROM peer_reviews${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`,
    params,
    evaluation,
    'peer review lookup'
  );
  return rows.flatMap((review) => {
    const classification = classifyPeerReview(db, review, evaluation);
    return classification.eligible ? [decorate(review, classification, 'peer_reviews')] : [];
  });
}

function listCanonicalReviews(db, options = {}, evaluation = createEvaluation()) {
  return [
    ...listCanonicalJobReviews(db, options, evaluation),
    ...listCanonicalPeerReviews(db, options, evaluation),
  ];
}

function summarizeCanonicalReviews(db, options = {}) {
  const evaluation = createEvaluation();
  const reviews = listCanonicalReviews(db, options, evaluation);
  const ratings = reviews.map((review) => Number(review.rating)).filter(Number.isFinite);
  return {
    reviews,
    evaluable: evaluation.evaluable,
    evaluationErrors: evaluation.errors,
    count: ratings.length,
    averageRating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0,
    positive: ratings.filter((rating) => rating >= 4).length,
    negative: ratings.filter((rating) => rating <= 2).length,
  };
}

module.exports = {
  RELEASED_ESCROW_STATUSES,
  classifyJobReview,
  classifyPeerReview,
  isReviewerWalletBound,
  listCanonicalJobReviews,
  listCanonicalPeerReviews,
  listCanonicalReviews,
  summarizeCanonicalReviews,
};
