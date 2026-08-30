'use strict';

const RELEASED_ESCROW_STATUSES = new Set([
  'released',
  'auto_released',
  'release_complete',
  'completed',
  'paid',
  'settled',
]);

function safeAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (_) {
    return [];
  }
}

function safeGet(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params) || null;
  } catch (_) {
    return null;
  }
}

function tableColumns(db, table) {
  return new Set(safeAll(db, `PRAGMA table_info(${table})`).map((row) => row.name));
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

function findCanonicalEscrow(db, review) {
  if (!nonEmpty(review?.job_id)) return null;
  const escrows = safeAll(db, 'SELECT * FROM escrows WHERE job_id = ?', [review.job_id]);
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

function isReviewerWalletBound(db, review) {
  const wallet = review?.reviewer_wallet;
  const chain = String(review?.chain || '').toLowerCase();
  if (!nonEmpty(wallet) || !['solana', 'ethereum'].includes(chain)) return false;

  const columns = tableColumns(db, 'profiles');
  if (!columns.has('id')) return false;
  const selected = ['id', 'wallet', 'claimed_by', 'wallets', 'verification_data']
    .filter((column) => columns.has(column));
  const profile = safeGet(
    db,
    `SELECT ${selected.join(', ')} FROM profiles WHERE id = ?`,
    [review.reviewer_id]
  );
  const expected = normalizeIdentity(wallet, chain);
  return profileWalletCandidates(profile, chain)
    .some((candidate) => normalizeIdentity(candidate, chain) === expected);
}

function classifyJobReview(db, review) {
  const escrow = findCanonicalEscrow(db, review);
  if (!escrow) {
    return { eligible: false, reason: 'missing_matching_released_escrow' };
  }
  return {
    eligible: true,
    reason: null,
    escrowId: escrow.id,
    canonicalReleasedEscrowReview: true,
    reviewerIdentityBound: true,
    signatureVerified: false,
  };
}

function classifyPeerReview(db, review) {
  const base = classifyJobReview(db, review);
  if (!base.eligible) return base;
  if (Number(review.verified || 0) !== 1 || !nonEmpty(review.signature)) {
    return { eligible: false, reason: 'missing_verified_reviewer_signature' };
  }
  if (!isReviewerWalletBound(db, review)) {
    return { eligible: false, reason: 'reviewer_wallet_not_bound_to_identity' };
  }
  return { ...base, signatureVerified: true };
}

function decorate(review, classification, source) {
  return {
    ...review,
    reviewSource: source,
    canonicalReleasedEscrowReview: classification.canonicalReleasedEscrowReview === true,
    reviewerIdentityBound: classification.reviewerIdentityBound === true,
    signatureVerified: classification.signatureVerified === true,
    canonicalEscrowId: classification.escrowId || null,
  };
}

function listCanonicalJobReviews(db, { revieweeId = null, reviewerId = null } = {}) {
  const columns = tableColumns(db, 'reviews');
  if (!columns.has('reviewee_id') || !columns.has('reviewer_id') || !columns.has('job_id')) return [];
  const clauses = [];
  const params = [];
  if (revieweeId !== null) { clauses.push('reviewee_id = ?'); params.push(revieweeId); }
  if (reviewerId !== null) { clauses.push('reviewer_id = ?'); params.push(reviewerId); }
  const rows = safeAll(db, `SELECT * FROM reviews${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`, params);
  return rows.flatMap((review) => {
    const classification = classifyJobReview(db, review);
    return classification.eligible ? [decorate(review, classification, 'reviews')] : [];
  });
}

function listCanonicalPeerReviews(db, { revieweeId = null, reviewerId = null } = {}) {
  const columns = tableColumns(db, 'peer_reviews');
  if (!columns.has('reviewee_id') || !columns.has('reviewer_id') || !columns.has('job_id')) return [];
  const clauses = [];
  const params = [];
  if (revieweeId !== null) { clauses.push('reviewee_id = ?'); params.push(revieweeId); }
  if (reviewerId !== null) { clauses.push('reviewer_id = ?'); params.push(reviewerId); }
  const rows = safeAll(db, `SELECT * FROM peer_reviews${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`, params);
  return rows.flatMap((review) => {
    const classification = classifyPeerReview(db, review);
    return classification.eligible ? [decorate(review, classification, 'peer_reviews')] : [];
  });
}

function listCanonicalReviews(db, options = {}) {
  return [
    ...listCanonicalJobReviews(db, options),
    ...listCanonicalPeerReviews(db, options),
  ];
}

function summarizeCanonicalReviews(db, options = {}) {
  const reviews = listCanonicalReviews(db, options);
  const ratings = reviews.map((review) => Number(review.rating)).filter(Number.isFinite);
  return {
    reviews,
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
