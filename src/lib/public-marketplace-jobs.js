'use strict';

const { isFixtureJob } = require('./public-traction');

// Keep the public read bounded while making this exact SQLite cohort the single
// source for list pagination and advertised marketplace totals.
const PUBLIC_MARKETPLACE_DATABASE_BOUND = 1000;

function getPublicMarketplaceCohort(db, databaseBound = PUBLIC_MARKETPLACE_DATABASE_BOUND) {
  const bound = Math.max(1, Math.min(Number(databaseBound) || PUBLIC_MARKETPLACE_DATABASE_BOUND, PUBLIC_MARKETPLACE_DATABASE_BOUND));
  const scannedRows = db.prepare(`
    SELECT * FROM jobs
    ORDER BY datetime(created_at) DESC
    LIMIT ?
  `).all(bound);
  const rows = scannedRows.filter((job) => !isFixtureJob(job));

  return {
    rows,
    total: rows.length,
    scanned: scannedRows.length,
    excludedFixtures: scannedRows.length - rows.length,
    databaseBound: bound,
  };
}

function summarizePublicMarketplaceCohort(cohort) {
  const rows = cohort.rows;
  return {
    totalJobs: rows.length,
    openJobs: rows.filter((job) => job.status === 'open').length,
    inProgressJobs: rows.filter((job) => job.status === 'in_progress').length,
    awaitingFundingJobs: rows.filter((job) => job.status === 'awaiting_funding').length,
    completedJobs: rows.filter((job) => job.status === 'completed').length,
    disputedJobs: rows.filter((job) => job.status === 'disputed').length,
    closedJobs: rows.filter((job) => ['closed', 'cancelled'].includes(job.status)).length,
    totalVolume: rows.reduce(
      (sum, job) => sum + (Number(job.agreed_budget ?? job.budget_amount) || 0),
      0
    ),
  };
}

module.exports = {
  PUBLIC_MARKETPLACE_DATABASE_BOUND,
  getPublicMarketplaceCohort,
  summarizePublicMarketplaceCohort,
};
