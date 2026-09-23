'use strict';

const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const marketplaceState = require('../lib/marketplace-state-machine');
const { initializeMarketplaceCoreSchema } = require('../lib/marketplace-schema');
const {
  MarketplaceAmountError,
  parseDecimalToMinorUnits,
  formatMinorUnits,
  exactMinorUnits,
} = require('../lib/marketplace-money');
const { liveEscrowGateStatus } = require('../lib/write-surface-gate');
const {
  EscrowOnChainReadbackError,
  readStagedEscrowFunding,
} = require('../lib/marketplace-escrow-readback');
const { createMarketplaceAuth, registerMarketplaceAuthChallengeRoute } = require('../lib/marketplace-wallet-auth');

const CATEGORIES = new Set(['trading', 'research', 'development', 'creative', 'other']);
const TIMELINES = new Set(['asap', '1w', '2w', 'flexible']);
const PICKUP_MODES = new Set(['select', 'claim']);
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

function idempotencyKey(options) {
  const key = String(options.idempotencyKey || '').trim();
  if (!key) throw new MarketplaceJobError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (key.length > 200) throw new MarketplaceJobError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be at most 200 characters');
  return key;
}

function jobResponse(row) {
  let skills = [];
  try { skills = JSON.parse(row.skills || '[]'); } catch (_) { skills = []; }
  const currency = row.budget_currency || 'SOL';
  const budgetAmountMinor = exactMinorUnits(row, 'budget_amount', 'budget_amount_minor');
  return {
    id: row.id,
    posterId: row.client_id,
    title: row.title,
    description: row.description || '',
    category: row.category || 'other',
    skills,
    budgetType: row.budget_type || 'fixed',
    budgetAmount: formatMinorUnits(budgetAmountMinor, currency),
    budgetAmountMinor,
    budgetCurrency: currency,
    timeline: row.timeline || 'flexible',
    pickupMode: row.pickup_mode || 'select',
    minimumVerificationLevel: Number(row.minimum_verification_level) || 1,
    minimumTrustScore: row.minimum_trust_score == null ? null : Number(row.minimum_trust_score),
    status: row.status,
    selectedAgentId: row.selected_agent_id || null,
    awardExpiresAt: row.award_expires_at || null,
    escrow: {
      mode: 'staged',
      funded: Boolean(row.escrow_funded),
      moneyMoved: false,
    },
    publicMetrics: { gmvMinorUnits: '0', outcomeReputationEligible: false },
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createJob(db, { actorId, body = {}, now = new Date().toISOString() }) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || 'other').trim().toLowerCase();
  const timeline = String(body.timeline || 'flexible').trim().toLowerCase();
  const currency = String(body.budgetCurrency || 'SOL').trim().toUpperCase();
  const budgetType = String(body.budgetType || 'fixed').trim().toLowerCase();
  const pickupMode = String(body.pickupMode || body.pickup_mode || 'select').trim().toLowerCase();
  const skills = body.skills;
  if (budgetType !== 'fixed') throw new MarketplaceJobError(409, 'FIXED_PRICE_ONLY', 'Only fixed-price jobs are supported');
  if (!PICKUP_MODES.has(pickupMode)) throw new MarketplaceJobError(400, 'INVALID_PICKUP_MODE', 'pickupMode must be select or claim');
  if (title.length < 3 || title.length > 200) throw new MarketplaceJobError(400, 'INVALID_JOB_TITLE', 'title must be between 3 and 200 characters');
  if (description.length < 10 || description.length > 20000) throw new MarketplaceJobError(400, 'INVALID_JOB_DESCRIPTION', 'description must be between 10 and 20000 characters');
  if (!CATEGORIES.has(category)) throw new MarketplaceJobError(400, 'INVALID_JOB_CATEGORY', 'Unsupported fixed-price job category');
  if (!TIMELINES.has(timeline)) throw new MarketplaceJobError(400, 'INVALID_JOB_TIMELINE', 'timeline must be asap, 1w, 2w, or flexible');
  if (currency !== 'SOL') throw new MarketplaceJobError(409, 'ESCROW_ASSET_UNSUPPORTED', 'Fixed-price escrow is staged for SOL only');
  let amountMinor;
  try { amountMinor = parseDecimalToMinorUnits(body.budgetAmount, currency); } catch (error) {
    if (error instanceof MarketplaceAmountError) throw new MarketplaceJobError(400, error.code, error.message);
    throw error;
  }
  if (!Array.isArray(skills) || skills.length > 20 || skills.some((skill) => typeof skill !== 'string' || !skill.trim())) {
    throw new MarketplaceJobError(400, 'INVALID_JOB_SKILLS', 'skills must contain at most 20 non-empty strings');
  }
  const minimumVerificationLevel = Number(body.minimumVerificationLevel ?? 1);
  if (!Number.isInteger(minimumVerificationLevel) || minimumVerificationLevel < 1 || minimumVerificationLevel > 5) {
    throw new MarketplaceJobError(400, 'INVALID_MINIMUM_VERIFICATION_LEVEL', 'minimumVerificationLevel must be an integer from 1 to 5');
  }
  const minimumTrustScore = body.minimumTrustScore == null ? null : Number(body.minimumTrustScore);
  if (minimumTrustScore != null && (!Number.isInteger(minimumTrustScore) || minimumTrustScore < 0 || minimumTrustScore > 100)) {
    throw new MarketplaceJobError(400, 'INVALID_MINIMUM_TRUST_SCORE', 'minimumTrustScore must be an integer from 0 to 100');
  }
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= new Date(now).getTime())) {
    throw new MarketplaceJobError(400, 'INVALID_JOB_EXPIRY', 'expiresAt must be a future timestamp');
  }
  const id = `job_${crypto.randomBytes(8).toString('hex')}`;
  const normalizedSkills = [...new Set(skills.map((skill) => skill.trim()))];
  db.prepare(`
    INSERT INTO jobs (
      id, client_id, title, description, category, skills, budget_type,
      budget_amount, budget_amount_minor, budget_currency, timeline, pickup_mode,
      minimum_verification_level, minimum_trust_score, requirements, expires_at,
      status, escrow_required, escrow_funded, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'fixed', ?, ?, 'SOL', ?, ?, ?, ?, ?, ?, 'open', 1, 0, ?, ?)
  `).run(
    id, actorId, title, description, category, JSON.stringify(normalizedSkills),
    Number(formatMinorUnits(amountMinor, currency)), amountMinor, timeline, pickupMode,
    minimumVerificationLevel, minimumTrustScore, String(body.requirements || '').trim(),
    expiresAt ? expiresAt.toISOString() : null, now, now,
  );
  return jobResponse(requireJob(db, id));
}

function listJobs(db, { query = {} } = {}) {
  const mode = String(query.pickupMode || query.pickup_mode || '').trim().toLowerCase();
  const status = String(query.status || '').trim().toLowerCase();
  if (mode && !PICKUP_MODES.has(mode)) throw new MarketplaceJobError(400, 'INVALID_PICKUP_MODE', 'pickupMode must be select or claim');
  const clauses = [];
  const values = [];
  if (mode) { clauses.push('pickup_mode = ?'); values.push(mode); }
  if (status) { clauses.push('status = ?'); values.push(status); }
  const rows = db.prepare(`SELECT * FROM jobs ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC`).all(...values);
  return { jobs: rows.map(jobResponse), total: rows.length };
}

function getJob(db, { jobId }) {
  return jobResponse(requireJob(db, jobId));
}

function existingFundingEvent(db, jobId, key) {
  return db.prepare('SELECT * FROM marketplace_funding_effects WHERE job_id = ? AND idempotency_key = ?').get(jobId, key);
}

function fundingResponse(row, replayed = false) {
  return {
    effectId: row.id,
    jobId: row.job_id,
    escrowId: row.escrow_id,
    eventType: row.event_type,
    amountMinor: row.amount_minor,
    currency: row.currency,
    executionMode: row.execution_mode,
    status: row.status,
    verificationSource: row.verification_source || null,
    verificationResult: row.verification_result || null,
    gateStatus: row.gate_status,
    moneyMoved: false,
    publicGmvMinorUnits: '0',
    outcomeReputationEligible: false,
    liveEscrowWritesAllowed: false,
    replayed,
    createdAt: row.created_at,
  };
}

function stageFunding(db, options) {
  const key = idempotencyKey(options);
  return db.transaction(() => {
    const job = requireJob(db, options.jobId);
    if (job.client_id !== options.actorId) throw new MarketplaceJobError(403, 'CLIENT_ACTION_FORBIDDEN', 'Only the job client may stage funding');
    if (job.status !== marketplaceState.JOB_STATUS.OPEN) throw new MarketplaceJobError(409, 'JOB_NOT_OPEN', 'Funding can only be staged for an open job');
    const replay = existingFundingEvent(db, job.id, key);
    if (replay) return fundingResponse(replay, true);
    if (options.body.escrowReference !== undefined || options.body.escrowId !== undefined) {
      throw new MarketplaceJobError(400, 'SERVER_ESCROW_REFERENCE_REQUIRED', 'Staged escrow references are generated by the server');
    }
    const escrowId = `staged:${crypto.randomUUID()}`;
    const amountMinor = parseDecimalToMinorUnits(options.body.amount, job.budget_currency);
    const expectedMinor = exactMinorUnits(job, 'budget_amount', 'budget_amount_minor');
    if (amountMinor !== expectedMinor) {
      throw new MarketplaceJobError(409, 'ESCROW_FUNDING_MISMATCH', 'Staged funding must exactly match the advertised amount', { expectedMinor, actualMinor: amountMinor, currency: job.budget_currency });
    }
    if (job.escrow_id && job.escrow_id !== escrowId) throw new MarketplaceJobError(409, 'ESCROW_REFERENCE_MISMATCH', 'Job already has a different staged escrow reference');
    const now = options.now || new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO escrows (id, job_id, client_id, amount, amount_minor, currency, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(escrowId, job.id, job.client_id, Number(formatMinorUnits(amountMinor, job.budget_currency)), amountMinor, job.budget_currency, now, now);
    db.prepare('UPDATE jobs SET escrow_id = ?, updated_at = ? WHERE id = ?').run(escrowId, now, job.id);
    const gate = liveEscrowGateStatus({});
    const id = `mfe_${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO marketplace_funding_effects
      (id, job_id, escrow_id, event_type, amount_minor, currency, execution_mode, status, gate_status, idempotency_key, created_at)
      VALUES (?, ?, ?, 'funding_staged', ?, ?, 'staged', 'staged', ?, ?, ?)`)
      .run(id, job.id, escrowId, amountMinor, job.budget_currency, gate.status, key, now);
    return fundingResponse(existingFundingEvent(db, job.id, key));
  })();
}

function verifyFunding(db, options) {
  const key = idempotencyKey(options);
  return db.transaction(() => {
    const job = requireJob(db, options.jobId);
    if (job.client_id !== options.actorId) throw new MarketplaceJobError(403, 'CLIENT_ACTION_FORBIDDEN', 'Only the job client may verify staged funding');
    const replay = existingFundingEvent(db, job.id, key);
    if (replay) return fundingResponse(replay, true);
    if (!job.escrow_id) throw new MarketplaceJobError(409, 'ESCROW_FUNDING_REQUIRED', 'Stage funding before verification');
    const escrowReference = String(options.body.escrowReference || '').trim();
    if (!escrowReference || escrowReference !== job.escrow_id) throw new MarketplaceJobError(409, 'ESCROW_REFERENCE_MISMATCH', 'Verification reference does not match staged funding');
    let readback;
    try {
      readback = readStagedEscrowFunding(db, { jobId: job.id, escrowReference });
    } catch (error) {
      if (error instanceof EscrowOnChainReadbackError) {
        throw new MarketplaceJobError(error.statusCode, 'ESCROW_FUNDING_READBACK_FAILED', error.message, { reason: error.reason });
      }
      throw error;
    }
    const amountMinor = readback.amountMinor;
    const expectedMinor = exactMinorUnits(job, 'budget_amount', 'budget_amount_minor');
    if (amountMinor !== expectedMinor || readback.currency !== job.budget_currency) {
      throw new MarketplaceJobError(409, 'ESCROW_FUNDING_MISMATCH', 'Verified funding must exactly match the advertised amount', { expectedMinor, actualMinor: amountMinor, currency: job.budget_currency });
    }
    const source = readback.source;
    const now = options.now || new Date().toISOString();
    db.prepare("UPDATE escrows SET status = 'funded', deposit_confirmed_at = ?, updated_at = ? WHERE id = ?").run(now, now, readback.escrowReference);
    db.prepare('UPDATE jobs SET escrow_funded = 1, deposit_confirmed_at = ?, updated_at = ? WHERE id = ?').run(now, now, job.id);
    const gate = liveEscrowGateStatus({});
    const id = `mfe_${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO marketplace_funding_effects
      (id, job_id, escrow_id, event_type, amount_minor, currency, execution_mode, status,
       verification_source, verification_result, gate_status, idempotency_key, created_at)
      VALUES (?, ?, ?, 'funding_verified', ?, ?, 'staged', 'verified', ?, 'exact_match', ?, ?, ?)`)
      .run(id, job.id, readback.escrowReference, amountMinor, job.budget_currency, source, gate.status, key, now);
    return fundingResponse(existingFundingEvent(db, job.id, key));
  })();
}

function closeOpenJob(db, {
  jobId,
  actorId,
  targetStatus,
  reason,
  source = 'marketplace-job-api',
  now = new Date().toISOString(),
  idempotencyKey: requestKey,
}) {
  const key = String(requestKey || '').trim();
  if (!key) throw new MarketplaceJobError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (key.length > 200) throw new MarketplaceJobError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be at most 200 characters');
  const transitionKey = `${targetStatus}:${key}`;
  return db.transaction(() => {
    const prior = lifecycleReplay(db, jobId, transitionKey);
    if (prior) {
      const current = requireJob(db, jobId);
      const effect = db.prepare('SELECT * FROM marketplace_escrow_effects WHERE transition_audit_id = ?').get(prior.id);
      return {
        jobId,
        status: current.status,
        transitionAuditId: prior.id,
        escrow: effect
          ? { effect: effect.effect_type, mode: effect.execution_mode, status: effect.status, moneyMoved: false }
          : { mode: 'staged', status: 'not_funded', moneyMoved: false },
        replayed: true,
      };
    }
    const job = requireJob(db, jobId);
    const automaticExpiry = targetStatus === marketplaceState.JOB_STATUS.EXPIRED && actorId === 'system:job-expiry';
    if (job.client_id !== actorId && !automaticExpiry) throw new MarketplaceJobError(403, 'CLIENT_ACTION_FORBIDDEN', 'Only the job client may perform this action');
    if (job.status !== marketplaceState.JOB_STATUS.OPEN) throw new MarketplaceJobError(409, 'ILLEGAL_JOB_TRANSITION', `Only open jobs may become ${targetStatus}`, { fromStatus: job.status, toStatus: targetStatus });
    if (targetStatus === marketplaceState.JOB_STATUS.EXPIRED && (!job.expires_at || new Date(now).getTime() < new Date(job.expires_at).getTime())) {
      throw new MarketplaceJobError(409, 'JOB_NOT_EXPIRED', 'Job has not reached its expiry time');
    }
    const transition = marketplaceState.transitionJobState(db, jobId, targetStatus, {
      actorId,
      reason,
      source,
      idempotencyKey: transitionKey,
      metadata: { lifecycleReason: reason },
      now,
      env: {},
    });
    const timestampColumn = targetStatus === marketplaceState.JOB_STATUS.EXPIRED ? 'expired_at' : 'cancelled_at';
    const reasonColumn = targetStatus === marketplaceState.JOB_STATUS.EXPIRED ? 'expiry_reason' : 'cancel_reason';
    db.prepare(`UPDATE jobs SET ${timestampColumn} = ?, ${reasonColumn} = ? WHERE id = ?`).run(now, reason, jobId);
    return { jobId, status: targetStatus, transitionAuditId: transition.audit.id, escrow: transition.escrowEffect ? { effect: transition.escrowEffect.effectType, mode: transition.escrowEffect.executionMode, status: transition.escrowEffect.status, moneyMoved: false } : { mode: 'staged', status: 'not_funded', moneyMoved: false } };
  })();
}

function cancelJob(db, options) {
  const reason = String(options.body?.reason || '').trim();
  if (!reason || reason.length > 1000) throw new MarketplaceJobError(400, 'INVALID_CANCEL_REASON', 'reason must be between 1 and 1000 characters');
  return closeOpenJob(db, { ...options, targetStatus: marketplaceState.JOB_STATUS.CANCELLED, reason });
}
function expireJob(db, options) { return closeOpenJob(db, { ...options, targetStatus: marketplaceState.JOB_STATUS.EXPIRED, reason: 'listing_expired' }); }

function expireDueJobs(db, { now = new Date().toISOString() } = {}) {
  const due = db.prepare(`
    SELECT id FROM jobs
    WHERE status = ? AND expires_at IS NOT NULL AND expires_at <= ?
    ORDER BY expires_at ASC, id ASC
  `).all(marketplaceState.JOB_STATUS.OPEN, now);
  const results = [];
  const errors = [];
  for (const candidate of due) {
    try {
      results.push(closeOpenJob(db, {
        jobId: candidate.id,
        actorId: 'system:job-expiry',
        targetStatus: marketplaceState.JOB_STATUS.EXPIRED,
        reason: 'listing_expired',
        source: 'marketplace-job-expiry-timer',
        now,
        idempotencyKey: `automatic:${candidate.id}:${now}`,
      }));
    } catch (error) {
      errors.push({
        jobId: candidate.id,
        code: error.code || 'JOB_EXPIRY_FAILED',
        error: error.message,
      });
    }
  }
  return { results, errors };
}

function lifecycleReplay(db, jobId, key) {
  return db.prepare('SELECT * FROM job_transition_audit WHERE job_id = ? AND idempotency_key = ?').get(jobId, key);
}

function releaseApprovedJob(db, options) {
  const requestKey = idempotencyKey(options);
  return db.transaction(() => {
    const job = requireJob(db, options.jobId);
    if (job.client_id !== options.actorId) throw new MarketplaceJobError(403, 'CLIENT_ACTION_FORBIDDEN', 'Only the job client may stage release');
    const transitionKey = `release:${requestKey}`;
    const prior = lifecycleReplay(db, job.id, transitionKey);
    if (prior) {
      const effect = db.prepare('SELECT * FROM marketplace_escrow_effects WHERE transition_audit_id = ?').get(prior.id);
      return { jobId: job.id, status: job.status, transitionAuditId: prior.id, effectId: effect?.id || null, executionMode: effect?.execution_mode || 'staged', moneyMoved: false, replayed: true };
    }
    if (job.status !== marketplaceState.JOB_STATUS.APPROVED) throw new MarketplaceJobError(409, 'ILLEGAL_JOB_TRANSITION', 'Only approved jobs may stage release', { fromStatus: job.status, toStatus: marketplaceState.JOB_STATUS.RELEASED });
    if (!job.escrow_id || !job.escrow_funded) throw new MarketplaceJobError(409, 'ESCROW_FUNDING_REQUIRED', 'Verified staged funding is required before release');
    const transition = marketplaceState.transitionJobState(db, job.id, marketplaceState.JOB_STATUS.RELEASED, {
      actorId: options.actorId,
      reason: 'client staged approved release',
      source: 'marketplace-job-api',
      idempotencyKey: transitionKey,
      metadata: { stagedOnly: true },
      now: options.now,
      env: {},
    });
    db.prepare('UPDATE jobs SET released_at = ?, updated_at = ? WHERE id = ?').run(options.now, options.now, job.id);
    return {
      jobId: job.id,
      status: transition.job.status,
      transitionAuditId: transition.audit.id,
      effectId: transition.escrowEffect.id,
      executionMode: transition.escrowEffect.executionMode,
      effect: transition.escrowEffect.payload,
      moneyMoved: false,
      publicGmvMinorUnits: '0',
      outcomeReputationEligible: false,
      transaction: undefined,
    };
  })();
}

function closeReleasedJob(db, options) {
  const requestKey = idempotencyKey(options);
  return db.transaction(() => {
    const job = requireJob(db, options.jobId);
    if (job.client_id !== options.actorId && job.selected_agent_id !== options.actorId) throw new MarketplaceJobError(403, 'JOB_PARTY_REQUIRED', 'Only a job party may close a released job');
    const transitionKey = `close:${requestKey}`;
    const prior = lifecycleReplay(db, job.id, transitionKey);
    if (prior) return { jobId: job.id, status: job.status, transitionAuditId: prior.id, moneyMoved: false, replayed: true };
    const transition = marketplaceState.transitionJobState(db, job.id, marketplaceState.JOB_STATUS.CLOSED, {
      actorId: options.actorId,
      reason: 'released job bookkeeping closed',
      source: 'marketplace-job-api',
      idempotencyKey: transitionKey,
      metadata: { moneyAction: false },
      now: options.now,
      env: {},
    });
    db.prepare('UPDATE jobs SET closed_at = ?, updated_at = ? WHERE id = ?').run(options.now, options.now, job.id);
    return { jobId: job.id, status: transition.job.status, transitionAuditId: transition.audit.id, moneyMoved: false };
  })();
}

function registerMarketplaceJobRoutes(app, {
  getDb,
  closeDb = false,
  expirySweepIntervalMs = 0,
  clock = () => new Date().toISOString(),
} = {}) {
  if (typeof getDb !== 'function') throw new TypeError('getDb is required');
  const schemaDb = getDb();
  initializeMarketplaceCoreSchema(schemaDb);
  marketplaceState.initializeMarketplaceState(schemaDb);
  if (closeDb) schemaDb.close();
  registerMarketplaceAuthChallengeRoute(app, { getDb, closeDb });
  const authorize = createMarketplaceAuth({ getDb, closeDb, actorProperty: 'marketplaceJobActorId' });
  const invoke = (operation, successStatus = 200, authenticated = true) => (req, res) => {
    const db = getDb();
    try {
      const result = operation(db, {
        jobId: req.params.id,
        actorId: authenticated ? req.marketplaceJobActorId : null,
        body: req.body || {},
        query: req.query || {},
        idempotencyKey: req.get('Idempotency-Key'),
        now: clock(),
      });
      return res.status(successStatus).json(result);
    } catch (error) {
      if (error instanceof MarketplaceAmountError) return res.status(400).json({ code: error.code, error: error.message });
      if (error instanceof MarketplaceJobError) return res.status(error.status).json({ code: error.code, error: error.message, ...error.details });
      if (error instanceof marketplaceState.MarketplaceTransitionError) return res.status(409).json({ code: error.code, error: error.message, ...error.details });
      return res.status(500).json({ code: 'MARKETPLACE_JOB_FAILURE', error: error.message });
    } finally { if (closeDb) db.close(); }
  };
  for (const route of ['/api/jobs', '/api/marketplace/jobs']) {
    app.post(route, marketplaceJobMutationLimiter, authorize({ action: 'create', resourceId: (_req, actorId) => actorId }), invoke(createJob, 201));
  }
  for (const prefix of ['/api/jobs/:id', '/api/marketplace/jobs/:id']) {
    app.post(`${prefix}/fund-staged`, marketplaceJobMutationLimiter, authorize({ action: 'fund-staged', resourceId: (req) => req.params.id }), invoke(stageFunding, 201));
    app.post(`${prefix}/fund-staged/verify`, marketplaceJobMutationLimiter, authorize({ action: 'verify-funding', resourceId: (req) => req.params.id }), invoke(verifyFunding));
    app.post(`${prefix}/cancel`, marketplaceJobMutationLimiter, authorize({ action: 'cancel', resourceId: (req) => req.params.id }), invoke(cancelJob));
    app.post(`${prefix}/expire`, marketplaceJobMutationLimiter, authorize({ action: 'expire', resourceId: (req) => req.params.id }), invoke(expireJob));
    app.post(`${prefix}/release`, marketplaceJobMutationLimiter, authorize({ action: 'release', resourceId: (req) => req.params.id }), invoke(releaseApprovedJob));
    app.post(`${prefix}/close`, marketplaceJobMutationLimiter, authorize({ action: 'close', resourceId: (req) => req.params.id }), invoke(closeReleasedJob));
  }
  if (Number(expirySweepIntervalMs) > 0) {
    const timer = setInterval(() => {
      const db = getDb();
      try {
        const result = expireDueJobs(db, { now: clock() });
        for (const failure of result.errors) {
          console.error('[Marketplace] job expiry skipped %s: %s (%s)', failure.jobId, failure.code, failure.error);
        }
      } catch (error) {
        console.error('[Marketplace] job expiry sweep failed:', error.message);
      } finally {
        if (closeDb) db.close();
      }
    }, Number(expirySweepIntervalMs));
    if (typeof timer.unref === 'function') timer.unref();
  }
}

module.exports = {
  MarketplaceJobError,
  createJob,
  listJobs,
  getJob,
  stageFunding,
  verifyFunding,
  cancelJob,
  expireJob,
  expireDueJobs,
  releaseApprovedJob,
  closeReleasedJob,
  registerMarketplaceJobRoutes,
};
