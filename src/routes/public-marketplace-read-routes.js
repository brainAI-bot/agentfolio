'use strict';

const { formatMinorUnits } = require('../lib/marketplace-money');
const { getPublicMarketplaceCohort } = require('../lib/public-marketplace-jobs');
const { isFixtureJob } = require('../lib/public-traction');

const PICKUP_MODES = new Set(['select', 'claim']);

function marketplaceProfileMap(db, profileIds) {
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const profiles = db.prepare(`SELECT id, name, wallet, wallets FROM profiles WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return new Map(profiles.map((profile) => {
    let solanaWallet = profile.wallet || null;
    try {
      const wallets = typeof profile.wallets === 'string' ? JSON.parse(profile.wallets || '{}') : (profile.wallets || {});
      if (wallets?.solana) solanaWallet = wallets.solana;
    } catch {}
    return [profile.id, profile.name || solanaWallet || profile.id];
  }));
}

function marketplaceApplicationCounts(db, jobIds) {
  if (!jobIds.length) return new Map();
  const rows = db.prepare(`SELECT job_id, COUNT(*) AS count FROM applications WHERE job_id IN (${jobIds.map(() => '?').join(',')}) GROUP BY job_id`).all(...jobIds);
  return new Map(rows.map((row) => [row.job_id, Number(row.count) || 0]));
}

function hasPublicBudget(row) {
  if (row.budget_amount_minor != null && /^\d+$/.test(String(row.budget_amount_minor))) {
    return BigInt(row.budget_amount_minor) > 0n;
  }
  return Number(row.budget_amount) > 0;
}

function mapSqliteMarketplaceJob(row, profileMap, applicationCounts) {
  const budgetCurrency = row.budget_currency || 'SOL';
  const budgetAmountMinor = row.agreed_budget_minor || row.budget_amount_minor || null;
  const budgetAmount = row.agreed_budget != null
    ? String(row.agreed_budget)
    : (budgetAmountMinor ? formatMinorUnits(budgetAmountMinor, budgetCurrency) : String(row.budget_amount ?? 0));
  let skills = [];
  let attachments = [];
  try { skills = JSON.parse(row.skills || '[]'); } catch {}
  try { attachments = JSON.parse(row.attachments || '[]'); } catch {}
  const applicationCount = applicationCounts.get(row.id) ?? (Number(row.application_count) || 0);
  return {
    ...row,
    budget: `${budgetAmount} ${budgetCurrency}`,
    budgetAmount,
    budgetAmountMinor,
    budgetCurrency,
    pickupMode: row.pickup_mode || 'select',
    minimumVerificationLevel: Number(row.minimum_verification_level) || 1,
    minimumTrustScore: row.minimum_trust_score == null ? null : Number(row.minimum_trust_score),
    poster: profileMap.get(row.client_id) || row.client_id || 'Unknown client',
    posterId: row.client_id,
    clientId: row.client_id,
    assignee: row.selected_agent_id ? (profileMap.get(row.selected_agent_id) || row.selected_agent_id) : null,
    assigneeId: row.selected_agent_id || null,
    selectedAgentId: row.selected_agent_id || null,
    selectedApplicationId: row.selected_application_id || null,
    awardExpiresAt: row.award_expires_at || null,
    expiresAt: row.expires_at || null,
    skills,
    skills_required: skills,
    attachments,
    applicationCount,
    proposals: applicationCount,
    escrow: {
      id: row.escrow_id || null,
      required: Boolean(row.escrow_required),
      funded: Boolean(row.escrow_funded),
      mode: 'staged',
      moneyMoved: false,
    },
    publicMetrics: {
      gmvMinorUnits: '0',
      outcomeReputationEligible: false,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadSqliteMarketplaceApplications(db, jobId) {
  const rows = db.prepare('SELECT * FROM applications WHERE job_id = ? ORDER BY datetime(created_at) DESC').all(jobId);
  const profileMap = marketplaceProfileMap(db, rows.map((row) => row.agent_id));
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    applicantId: row.agent_id,
    applicantProfileId: row.agent_id,
    applicantName: profileMap.get(row.agent_id) || row.agent_id || 'Unknown applicant',
    proposal: row.cover_message || '',
    bidAmount: row.proposed_budget,
    proposedTimeline: row.proposed_timeline,
    status: row.status || 'pending',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function createPublicMarketplaceReadHandlers({ getDb }) {
  if (typeof getDb !== 'function') throw new TypeError('getDb is required');

  function listSqliteMarketplaceJobs(req, res) {
    try {
      const db = getDb();
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const pickupMode = String(req.query.pickupMode || req.query.pickup_mode || '').trim().toLowerCase();
      const status = String(req.query.status || '').trim().toLowerCase();
      if (pickupMode && !PICKUP_MODES.has(pickupMode)) {
        return res.status(400).json({ code: 'INVALID_PICKUP_MODE', error: 'pickupMode must be select or claim' });
      }
      const cohort = getPublicMarketplaceCohort(db);
      const publicRows = cohort.rows.filter(hasPublicBudget);
      const filteredRows = publicRows.filter((row) => (
        (!pickupMode || (row.pickup_mode || 'select') === pickupMode)
        && (!status || row.status === status)
      ));
      const total = filteredRows.length;
      const offset = (page - 1) * limit;
      const rows = filteredRows.slice(offset, offset + limit);
      const profileMap = marketplaceProfileMap(db, rows.flatMap((row) => [row.client_id, row.selected_agent_id]));
      const applicationCounts = marketplaceApplicationCounts(db, rows.map((row) => row.id));
      const jobs = rows.map((row) => mapSqliteMarketplaceJob(row, profileMap, applicationCounts));
      return res.json({
        jobs,
        total,
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        publicTraction: {
          excludedFixtures: cohort.excludedFixtures,
          excludedInvalidBudgets: cohort.rows.length - publicRows.length,
          databaseBound: cohort.databaseBound,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  function getSqliteMarketplaceJob(req, res) {
    try {
      const db = getDb();
      const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
      if (!row || isFixtureJob(row) || !hasPublicBudget(row)) return res.status(404).json({ error: 'Job not found' });
      const applications = loadSqliteMarketplaceApplications(db, row.id);
      const profileMap = marketplaceProfileMap(db, [row.client_id, row.selected_agent_id]);
      const applicationCounts = new Map([[row.id, applications.length]]);
      return res.json({ ...mapSqliteMarketplaceJob(row, profileMap, applicationCounts), applications });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  function getSqliteMarketplaceApplications(req, res) {
    try {
      const db = getDb();
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
      if (!job || isFixtureJob(job) || !hasPublicBudget(job)) return res.status(404).json({ error: 'Job not found' });
      const applications = loadSqliteMarketplaceApplications(db, job.id);
      return res.json({ applications, total: applications.length });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return { listSqliteMarketplaceJobs, getSqliteMarketplaceJob, getSqliteMarketplaceApplications };
}

function registerPublicMarketplaceReadRoutes(app, { getDb, limiter = (_req, _res, next) => next() } = {}) {
  const handlers = createPublicMarketplaceReadHandlers({ getDb });
  app.get('/api/jobs', limiter, handlers.listSqliteMarketplaceJobs);
  app.get('/api/jobs/:id', limiter, handlers.getSqliteMarketplaceJob);
  app.get('/api/jobs/:id/applications', limiter, handlers.getSqliteMarketplaceApplications);
  app.get('/api/marketplace/jobs', limiter, handlers.listSqliteMarketplaceJobs);
  app.get('/api/marketplace/jobs/:id', limiter, handlers.getSqliteMarketplaceJob);
  app.get('/api/marketplace/jobs/:id/applications', limiter, handlers.getSqliteMarketplaceApplications);
  return handlers;
}

module.exports = {
  createPublicMarketplaceReadHandlers,
  registerPublicMarketplaceReadRoutes,
};
