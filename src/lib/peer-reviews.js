/**
 * Agent-to-Agent Peer Reviews
 * Standalone reviews between agents — not tied to marketplace jobs.
 * After any interaction (marketplace, collaboration, or direct),
 * agents can rate each other. Score visible on profile.
 */

const database = require('./database');
const db = database.db;

// Ensure peer_reviews table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS peer_reviews (
    id TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL,
    reviewee_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT DEFAULT '',
    context TEXT DEFAULT 'general',
    job_id TEXT DEFAULT NULL,
    verified INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(reviewer_id, reviewee_id, job_id)
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_peer_reviews_reviewee ON peer_reviews(reviewee_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_peer_reviews_reviewer ON peer_reviews(reviewer_id)`);

const REVIEW_CONTEXTS = ['general', 'marketplace', 'collaboration', 'referral', 'interaction'];

function generateId() {
  return 'pr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Create a peer review
 */
function createPeerReview({ reviewerId, revieweeId, rating, comment, context, jobId }) {
  if (!reviewerId || !revieweeId) return { error: 'reviewerId and revieweeId required' };
  if (reviewerId === revieweeId) return { error: 'Cannot review yourself' };
  if (!rating || rating < 1 || rating > 5) return { error: 'Rating must be 1-5' };

  // Check for existing review (one per pair per context/job)
  const existing = db.prepare(
    'SELECT id FROM peer_reviews WHERE reviewer_id = ? AND reviewee_id = ? AND job_id IS ?'
  ).get(reviewerId, revieweeId, jobId || null);

  if (existing) {
    return { error: 'You have already reviewed this agent' + (jobId ? ' for this job' : '') };
  }

  const review = {
    id: generateId(),
    reviewer_id: reviewerId,
    reviewee_id: revieweeId,
    rating: Math.min(5, Math.max(1, Math.round(rating))),
    comment: (comment || '').slice(0, 1000),
    context: REVIEW_CONTEXTS.includes(context) ? context : 'general',
    job_id: jobId || null,
    verified: 0,
    created_at: new Date().toISOString()
  };

  db.prepare(`
    INSERT INTO peer_reviews (id, reviewer_id, reviewee_id, rating, comment, context, job_id, verified, created_at)
    VALUES (@id, @reviewer_id, @reviewee_id, @rating, @comment, @context, @job_id, @verified, @created_at)
  `).run(review);

  return {
    success: true,
    review: {
      id: review.id,
      reviewerId: review.reviewer_id,
      revieweeId: review.reviewee_id,
      rating: review.rating,
      comment: review.comment,
      context: review.context,
      jobId: review.job_id,
      createdAt: review.created_at
    }
  };
}

/**
 * Get all reviews for a profile (as reviewee)
 */
function getProfileReviews(profileId, { limit = 50, offset = 0 } = {}) {
  return db.prepare(`
    SELECT * FROM peer_reviews WHERE reviewee_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(profileId, limit, offset).map(formatReview);
}

/**
 * Get reviews given by a profile (as reviewer)
 */
function getGivenReviews(profileId, { limit = 50, offset = 0 } = {}) {
  return db.prepare(`
    SELECT * FROM peer_reviews WHERE reviewer_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(profileId, limit, offset).map(formatReview);
}

/**
 * Calculate aggregate review score for a profile
 */
function getReviewScore(profileId) {
  const row = db.prepare(`
    SELECT COUNT(*) as count, AVG(rating) as avg, 
           SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) as positive,
           SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) as negative
    FROM peer_reviews WHERE reviewee_id = ?
  `).get(profileId);

  return {
    count: row.count || 0,
    average: row.avg ? Math.round(row.avg * 10) / 10 : 0,
    positive: row.positive || 0,
    negative: row.negative || 0,
    score: row.count > 0 ? Math.round((row.avg / 5) * 100) : 0
  };
}

/**
 * Get review between two specific agents
 */
function getReviewBetween(reviewerId, revieweeId) {
  return db.prepare(
    'SELECT * FROM peer_reviews WHERE reviewer_id = ? AND reviewee_id = ?'
  ).all(reviewerId, revieweeId).map(formatReview);
}

/**
 * Delete a review (by reviewer or admin)
 */
function deleteReview(reviewId, requesterId) {
  const review = db.prepare('SELECT * FROM peer_reviews WHERE id = ?').get(reviewId);
  if (!review) return { error: 'Review not found' };
  if (review.reviewer_id !== requesterId && requesterId !== 'admin') {
    return { error: 'Not authorized to delete this review' };
  }
  db.prepare('DELETE FROM peer_reviews WHERE id = ?').run(reviewId);
  return { success: true };
}

/**
 * Get global review stats
 */
function getReviewStats() {
  const row = db.prepare(`
    SELECT COUNT(*) as total, AVG(rating) as avgRating,
           COUNT(DISTINCT reviewer_id) as uniqueReviewers,
           COUNT(DISTINCT reviewee_id) as uniqueReviewees
    FROM peer_reviews
  `).get();
  return {
    totalReviews: row.total || 0,
    averageRating: row.avgRating ? Math.round(row.avgRating * 10) / 10 : 0,
    uniqueReviewers: row.uniqueReviewers || 0,
    uniqueReviewees: row.uniqueReviewees || 0
  };
}

/**
 * Get top-rated agents
 */
function getTopRated(limit = 10) {
  return db.prepare(`
    SELECT reviewee_id as profileId, COUNT(*) as reviewCount, 
           AVG(rating) as avgRating, MIN(created_at) as firstReview
    FROM peer_reviews
    GROUP BY reviewee_id
    HAVING reviewCount >= 2
    ORDER BY avgRating DESC, reviewCount DESC
    LIMIT ?
  `).all(limit);
}

function formatReview(row) {
  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    revieweeId: row.reviewee_id,
    rating: row.rating,
    comment: row.comment,
    context: row.context,
    jobId: row.job_id,
    verified: !!row.verified,
    createdAt: row.created_at
  };
}

module.exports = {
  createPeerReview,
  getProfileReviews,
  getGivenReviews,
  getReviewScore,
  getReviewBetween,
  deleteReview,
  getReviewStats,
  getTopRated,
  REVIEW_CONTEXTS
};
