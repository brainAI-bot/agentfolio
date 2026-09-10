'use strict';

const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const marketplaceState = require('../lib/marketplace-state-machine');
const { initializeMarketplaceCoreSchema } = require('../lib/marketplace-schema');
const { createMarketplaceAuth, registerMarketplaceAuthChallengeRoute } = require('../lib/marketplace-wallet-auth');

const CATEGORIES = new Set(['trading', 'research', 'development', 'creative', 'other']);
const TIMELINES = new Set(['asap', '1w', '2w', 'flexible']);
const marketplaceJobMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'MARKETPLACE_RATE_LIMIT', error: 'Too many marketplace mutation requests' },
});

class MarketplaceJobError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requireJob(db, jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new MarketplaceJobError(404, 'JOB_NOT_FOUND', 'Job not found');
  return job;
}

function createJob(db, { actorId, body = {}, now = new Date().toISOString() }) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || 'other').trim().toLowerCase();
  const timeline = String(body.timeline || 'flexible').trim().toLowerCase();
  const amount = Number(body.budgetAmount);
  const currency = String(body.budgetCurrency || 'SOL').trim().toUpperCase();
  const budgetType = String(body.budgetType || 'fixed').trim().toLowerCase();
  const skills = body.skills;
  if (budgetType !== 'fixed') throw new MarketplaceJobError(409, 'FIXED_PRICE_ONLY', 'Only fixed-price jobs are supported');
  if (title.length < 3 || title.length > 200) throw new MarketplaceJobError(400, 'INVALID_JOB_TITLE', 'title must be between 3 and 200 characters');
  if (description.length < 10 || description.length > 20000) throw new MarketplaceJobError(400, 'INVALID_JOB_DESCRIPTION', 'description must be between 10 and 20000 characters');
  if (!CATEGORIES.has(category)) throw new MarketplaceJobError(400, 'INVALID_JOB_CATEGORY', 'Unsupported fixed-price job category');
  if (!TIMELINES.has(timeline)) throw new MarketplaceJobError(400, 'INVALID_JOB_TIMELINE', 'timeline must be asap, 1w, 2w, or flexible');
  if (!Number.isFinite(amount) || amount <= 0) throw new MarketplaceJobError(400, 'INVALID_JOB_BUDGET', 'budgetAmount must be positive');
  if (currency !== 'SOL') throw new MarketplaceJobError(409, 'ESCROW_ASSET_UNSUPPORTED', 'Fixed-price escrow is staged for SOL only');
  if (!Array.isArray(skills) || skills.length > 20 || skills.some((skill) => typeof skill !== 'string' || !skill.trim())) {
    throw new MarketplaceJobError(400, 'INVALID_JOB_SKILLS', 'skills must contain at most 20 non-empty strings');
  }
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= new Date(now).getTime())) {
    throw new MarketplaceJobError(400, 'INVALID_JOB_EXPIRY', 'expiresAt must be a future timestamp');
  }
  const id = `job_${crypto.randomBytes(8).toString('hex')}`;
  db.prepare(`
    INSERT INTO jobs (
      id, client_id, title, description, category, skills, budget_type,
      budget_amount, budget_currency, timeline, requirements, expires_at,
      status, escrow_required, escrow_funded, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'fixed', ?, 'SOL', ?, ?, ?, 'open', 1, 0, ?, ?)
  `).run(
    id, actorId, title, description, category,
    JSON.stringify([...new Set(skills.map((skill) => skill.trim()))]),
    amount, timeline, String(body.requirements || '').trim(),
    expiresAt ? expiresAt.toISOString() : null, now, now,
  );
  return {
    id,
    clientId: actorId,
    title,
    description,
    category,
    skills: [...new Set(skills.map((skill) => skill.trim()))],
    budgetType: 'fixed',
    budgetAmount: amount,
    budgetCurrency: 'SOL',
    timeline,
    status: 'open',
    escrow: { mode: 'staged', funded: false, moneyMoved: false },
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    createdAt: now,
  };
}

function closeOpenJob(db, { jobId, actorId, targetStatus, reason, now = new Date().toISOString() }) {
  const job = requireJob(db, jobId);
  if (job.client_id !== actorId) throw new MarketplaceJobError(403, 'CLIENT_ACTION_FORBIDDEN', 'Only the job client may perform this action');
  if (job.status !== marketplaceState.JOB_STATUS.OPEN) {
    throw new MarketplaceJobError(409, 'ILLEGAL_JOB_TRANSITION', `Only open jobs may become ${targetStatus}`, { fromStatus: job.status, toStatus: targetStatus });
  }
  if (targetStatus === marketplaceState.JOB_STATUS.EXPIRED
    && (!job.expires_at || new Date(now).getTime() < new Date(job.expires_at).getTime())) {
    throw new MarketplaceJobError(409, 'JOB_NOT_EXPIRED', 'Job has not reached its expiry time');
  }
  const transition = marketplaceState.transitionJobState(db, jobId, targetStatus, {
    actorId,
    reason,
    source: 'marketplace-job-api',
    idempotencyKey: `${targetStatus}:${jobId}`,
    now,
  });
  const timestampColumn = targetStatus === marketplaceState.JOB_STATUS.EXPIRED ? 'expired_at' : 'cancelled_at';
  const reasonColumn = targetStatus === marketplaceState.JOB_STATUS.EXPIRED ? 'expiry_reason' : 'cancel_reason';
  db.prepare(`UPDATE jobs SET ${timestampColumn} = ?, ${reasonColumn} = ? WHERE id = ?`).run(now, reason, jobId);
  return {
    jobId,
    status: targetStatus,
    transitionAuditId: transition.audit.id,
    escrow: transition.escrowEffect ? {
      effect: transition.escrowEffect.effectType,
      mode: transition.escrowEffect.executionMode,
      status: transition.escrowEffect.status,
      moneyMoved: false,
    } : { mode: 'staged', status: 'not_funded', moneyMoved: false },
  };
}

function cancelJob(db, options) {
  const reason = String(options.body?.reason || '').trim();
  if (!reason || reason.length > 1000) throw new MarketplaceJobError(400, 'INVALID_CANCEL_REASON', 'reason must be between 1 and 1000 characters');
  return closeOpenJob(db, { ...options, targetStatus: marketplaceState.JOB_STATUS.CANCELLED, reason });
}

function expireJob(db, options) {
  return closeOpenJob(db, { ...options, targetStatus: marketplaceState.JOB_STATUS.EXPIRED, reason: 'listing_expired' });
}

function registerMarketplaceJobRoutes(app, { getDb, closeDb = false } = {}) {
  if (typeof getDb !== 'function') throw new TypeError('getDb is required');
  const schemaDb = getDb();
  initializeMarketplaceCoreSchema(schemaDb);
  marketplaceState.initializeMarketplaceState(schemaDb);
  if (closeDb) schemaDb.close();
  registerMarketplaceAuthChallengeRoute(app, { getDb, closeDb });
  const authorize = createMarketplaceAuth({ getDb, closeDb, actorProperty: 'marketplaceJobActorId' });
  const invoke = (operation, successStatus = 200) => (req, res) => {
    const db = getDb();
    try {
      const result = operation(db, {
        jobId: req.params.id,
        actorId: req.marketplaceJobActorId,
        body: req.body || {},
      });
      return res.status(successStatus).json(result);
    } catch (error) {
      if (error instanceof MarketplaceJobError) return res.status(error.status).json({ code: error.code, error: error.message, ...error.details });
      return res.status(500).json({ code: 'MARKETPLACE_JOB_FAILURE', error: error.message });
    } finally {
      if (closeDb) db.close();
    }
  };
  for (const route of ['/api/jobs', '/api/marketplace/jobs']) {
    app.post(route, marketplaceJobMutationLimiter, authorize({ action: 'create', resourceId: (_req, actorId) => actorId }), invoke(createJob, 201));
  }
  for (const prefix of ['/api/jobs/:id', '/api/marketplace/jobs/:id']) {
    app.post(`${prefix}/cancel`, marketplaceJobMutationLimiter, authorize({ action: 'cancel', resourceId: (req) => req.params.id }), invoke(cancelJob));
    app.post(`${prefix}/expire`, marketplaceJobMutationLimiter, authorize({ action: 'expire', resourceId: (req) => req.params.id }), invoke(expireJob));
  }
}

module.exports = { MarketplaceJobError, createJob, cancelJob, expireJob, registerMarketplaceJobRoutes };
