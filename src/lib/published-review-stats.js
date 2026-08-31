'use strict';

function buildPublishedReviewStats(summary) {
  const total = Number(summary?.count || 0);
  return {
    total,
    avg_rating: total > 0
      ? Math.round(Number(summary.averageRating) * 100) / 100
      : null,
  };
}

module.exports = { buildPublishedReviewStats };
