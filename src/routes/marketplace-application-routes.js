'use strict';

const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const marketplaceState = require('../lib/marketplace-state-machine');
const { initializeMarketplaceCoreSchema } = require('../lib/marketplace-schema');
const { hasVerifiedCanonicalTrustData } = require('../lib/canonical-verification-providers');
const { createRequireAuth } = require('../middleware/auth');

const AWARD_TTL_MS = 48 * 60 * 60 * 1000;
const DAILY_APPLICATION_LIMIT = 10;
const CURRENCY_DECIMALS = Object.freeze({ SOL: 9, USDC: 6 });
const marketplaceMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'MARKETPLACE_RATE_LIMIT', error: 'Too many marketplace mutation requests' },
});

class MarketplaceApplicationError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'MarketplaceApplicationError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function initializeMarketplaceApplicationSchema(db) {
  initializeMarketplaceCoreSchema(db);

  const addColumn = (table, definition) => {
    const column = definition.trim().split(/\s+/, 1)[0];
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  };

  addColumn('profiles', 'api_key TEXT');
  addColumn('profiles', "verification_data TEXT DEFAULT '{}'");

  marketplaceState.initializeMarketplaceState(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS application_transition_audit (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(id),
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      UNIQUE (application_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS marketplace_escrow_adjustments (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      application_id TEXT NOT NULL,
      escrow_id TEXT NOT NULL,
      adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('refund', 'top_up')),
      funded_amount REAL NOT NULL,
      required_amount REAL NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('staged')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (application_id) REFERENCES applications(id),
      UNIQUE (job_id, application_id, escrow_id, funded_amount, required_amount)
    );

    CREATE TABLE IF NOT EXISTS marketplace_escrow_adjustment_resolutions (
      id TEXT PRIMARY KEY,
      adjustment_id TEXT NOT NULL UNIQUE,
      funded_amount REAL NOT NULL,
      required_amount REAL NOT NULL,
      currency TEXT NOT NULL,
      resolution TEXT NOT NULL CHECK(resolution IN ('funding_matched')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (adjustment_id) REFERENCES marketplace_escrow_adjustments(id)
    );

    CREATE TRIGGER IF NOT EXISTS immutable_application_transition_audit_update
    BEFORE UPDATE ON application_transition_audit
    BEGIN
      SELECT RAISE(ABORT, 'APPLICATION_TRANSITION_AUDIT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_application_transition_audit_delete
    BEFORE DELETE ON application_transition_audit
    BEGIN
      SELECT RAISE(ABORT, 'APPLICATION_TRANSITION_AUDIT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_escrow_adjustments_update
    BEFORE UPDATE ON marketplace_escrow_adjustments
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_ESCROW_ADJUSTMENT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_escrow_adjustments_delete
    BEFORE DELETE ON marketplace_escrow_adjustments
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_ESCROW_ADJUSTMENT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_escrow_adjustment_resolutions_update
    BEFORE UPDATE ON marketplace_escrow_adjustment_resolutions
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_ESCROW_ADJUSTMENT_RESOLUTION_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_escrow_adjustment_resolutions_delete
    BEFORE DELETE ON marketplace_escrow_adjustment_resolutions
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_ESCROW_ADJUSTMENT_RESOLUTION_IMMUTABLE');
    END;
  `);
}

function applicationResponse(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    agentId: row.agent_id,
    coverMessage: row.cover_message || '',
    proposedBudget: row.proposed_budget,
    proposedTimeline: row.proposed_timeline,
    portfolioItems: parseJson(row.portfolio_items, []),
    status: row.status,
    statusNote: row.status_note || null,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireJob(db, jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new MarketplaceApplicationError(404, 'JOB_NOT_FOUND', 'Job not found');
  return job;
}

function requireApplication(db, applicationId, expectedJobId = null) {
  const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(applicationId);
  if (!application || (expectedJobId && application.job_id !== expectedJobId)) {
    throw new MarketplaceApplicationError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }
  return application;
}

function requireFixedPrice(job) {
  if ((job.budget_type || 'fixed') !== 'fixed') {
    throw new MarketplaceApplicationError(409, 'FIXED_PRICE_ONLY', 'Only fixed-price jobs are supported');
  }
}

function transitionApplication(db, application, toStatus, actorId, reason, now, idempotencyKey) {
  db.prepare(`
    UPDATE applications
    SET status = ?, status_note = ?, updated_at = ?,
        withdrawn_at = CASE WHEN ? = 'withdrawn' THEN ? ELSE withdrawn_at END,
        rejected_at = CASE WHEN ? = 'rejected' THEN ? ELSE rejected_at END,
        declined_at = CASE WHEN ? = 'rejected' AND ? = 'agent_declined' THEN ? ELSE declined_at END,
        accepted_at = CASE WHEN ? = 'accepted' THEN ? ELSE accepted_at END
    WHERE id = ?
  `).run(
    toStatus, reason, now,
    toStatus, now,
    toStatus, now,
    toStatus, reason, now,
    toStatus, now,
    application.id,
  );
  db.prepare(`
    INSERT INTO application_transition_audit (
      id, application_id, job_id, from_status, to_status,
      actor_id, reason, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `ata_${crypto.randomUUID()}`,
    application.id,
    application.job_id,
    application.status,
    toStatus,
    actorId,
    reason,
    idempotencyKey,
    now,
  );
}

function fundedEscrowForJob(db, job) {
  if (!job.escrow_id || !(job.escrow_funded === 1 || job.escrow_funded === true)) return null;
  const escrow = db.prepare('SELECT * FROM escrows WHERE id = ? AND job_id = ?').get(job.escrow_id, job.id);
  if (!escrow) return null;
  if (!escrow.deposit_confirmed_at || !['funded', 'locked'].includes(escrow.status)) return null;
  return escrow;
}

function requiredAwardAmount(job, application) {
  const amount = Number(application.proposed_budget ?? job.budget_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MarketplaceApplicationError(409, 'INVALID_AWARD_AMOUNT', 'Accepted fixed amount must be positive');
  }
  return amount;
}

function normalizeCurrency(value) {
  return String(value || '').trim().toUpperCase();
}

function toMinorUnits(value, currency) {
  const decimals = CURRENCY_DECIMALS[currency];
  const amount = Number(value);
  if (!Number.isInteger(decimals) || !Number.isFinite(amount)) return null;
  const minorUnits = Math.round(amount * (10 ** decimals));
  return Number.isSafeInteger(minorUnits) ? minorUnits : null;
}

function resolveOutstandingAdjustments(db, job, application, escrow, fundedAmount, requiredAmount, currency, now) {
  const unresolved = db.prepare(`
    SELECT adjustment.id
    FROM marketplace_escrow_adjustments AS adjustment
    LEFT JOIN marketplace_escrow_adjustment_resolutions AS resolution
      ON resolution.adjustment_id = adjustment.id
    WHERE adjustment.job_id = ? AND adjustment.application_id = ?
      AND adjustment.escrow_id = ? AND resolution.id IS NULL
    ORDER BY adjustment.created_at ASC, adjustment.id ASC
  `).all(job.id, application.id, escrow.id);
  const insertResolution = db.prepare(`
    INSERT OR IGNORE INTO marketplace_escrow_adjustment_resolutions (
      id, adjustment_id, funded_amount, required_amount, currency, resolution, created_at
    ) VALUES (?, ?, ?, ?, ?, 'funding_matched', ?)
  `);
  for (const adjustment of unresolved) {
    insertResolution.run(
      `mer_${crypto.randomUUID()}`,
      adjustment.id,
      fundedAmount,
      requiredAmount,
      currency,
      now,
    );
  }
}

function assertFundingMatches(db, job, application, now) {
  const escrow = fundedEscrowForJob(db, job);
  const requiredAmount = requiredAwardAmount(job, application);
  if (!escrow) {
    throw new MarketplaceApplicationError(
      409,
      'ESCROW_FUNDING_REQUIRED',
      'Verified staged escrow funding is required before award',
      { requiredAmount, currency: job.budget_currency },
    );
  }

  const fundedCurrency = normalizeCurrency(escrow.currency);
  const requiredCurrency = normalizeCurrency(job.budget_currency);
  if (!fundedCurrency || !requiredCurrency || fundedCurrency !== requiredCurrency) {
    throw new MarketplaceApplicationError(
      409,
      'ESCROW_CURRENCY_MISMATCH',
      'Escrow currency must match the job budget currency',
      {
        escrowId: escrow.id,
        jobId: job.id,
        applicationId: application.id,
        fundedCurrency: fundedCurrency || null,
        requiredCurrency: requiredCurrency || null,
      },
    );
  }

  const fundedAmount = Number(escrow.amount);
  const fundedMinorUnits = toMinorUnits(fundedAmount, fundedCurrency);
  const requiredMinorUnits = toMinorUnits(requiredAmount, requiredCurrency);
  if (fundedMinorUnits === null || requiredMinorUnits === null
    || fundedMinorUnits <= 0 || requiredMinorUnits <= 0) {
    throw new MarketplaceApplicationError(
      409,
      'ESCROW_AMOUNT_INVALID',
      'Escrow and award amounts must fit the supported currency minor-unit range',
      { fundedAmount, requiredAmount, currency: fundedCurrency },
    );
  }
  if (fundedMinorUnits !== requiredMinorUnits) {
    const adjustmentType = fundedAmount > requiredAmount ? 'refund' : 'top_up';
    db.prepare(`
      INSERT OR IGNORE INTO marketplace_escrow_adjustments (
        id, job_id, application_id, escrow_id, adjustment_type,
        funded_amount, required_amount, currency, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?)
    `).run(
      `mea_${crypto.randomUUID()}`,
      job.id,
      application.id,
      escrow.id,
      adjustmentType,
      fundedAmount,
      requiredAmount,
      fundedCurrency,
      now,
    );
    throw new MarketplaceApplicationError(
      409,
      'ESCROW_ADJUSTMENT_REQUIRED',
      `A staged escrow ${adjustmentType} must be verified before award`,
      {
        adjustmentType,
        fundedAmount,
        requiredAmount,
        escrowId: escrow.id,
        jobId: job.id,
        applicationId: application.id,
        currency: fundedCurrency,
      },
    );
  }
  resolveOutstandingAdjustments(
    db,
    job,
    application,
    escrow,
    fundedAmount,
    requiredAmount,
    fundedCurrency,
    now,
  );
  return { escrow, requiredAmount };
}

function applyToJob(db, { jobId, actorId, body = {}, now = new Date().toISOString() }) {
  const execute = db.transaction(() => {
    const job = requireJob(db, jobId);
    requireFixedPrice(job);
    if (job.status !== marketplaceState.JOB_STATUS.OPEN) {
      throw new MarketplaceApplicationError(409, 'JOB_NOT_OPEN', 'Job is not open for applications');
    }
    if (job.client_id === actorId) {
      throw new MarketplaceApplicationError(403, 'SELF_APPLICATION_FORBIDDEN', 'Clients cannot apply to their own jobs');
    }

    const profile = db.prepare('SELECT id, verification_data FROM profiles WHERE id = ?').get(actorId);
    if (!profile || !hasVerifiedCanonicalTrustData(parseJson(profile.verification_data))) {
      throw new MarketplaceApplicationError(403, 'VERIFIED_AGENT_REQUIRED', 'Only verified AgentFolio profiles may apply');
    }
    if (db.prepare('SELECT id FROM applications WHERE job_id = ? AND agent_id = ?').get(jobId, actorId)) {
      throw new MarketplaceApplicationError(409, 'APPLICATION_ALREADY_EXISTS', 'Only one application per agent and job is allowed');
    }
    const since = new Date(new Date(now).getTime() - 24 * 60 * 60 * 1000).toISOString();
    const recentCount = db.prepare('SELECT COUNT(*) AS count FROM applications WHERE agent_id = ? AND created_at >= ?')
      .get(actorId, since).count;
    if (recentCount >= DAILY_APPLICATION_LIMIT) {
      throw new MarketplaceApplicationError(429, 'APPLICATION_DAILY_LIMIT', 'Application limit is 10 per 24 hours');
    }

    const coverMessage = String(body.coverMessage ?? body.cover_letter ?? body.proposal ?? '').trim();
    if (coverMessage.length < 10 || coverMessage.length > 5000) {
      throw new MarketplaceApplicationError(400, 'INVALID_COVER_MESSAGE', 'coverMessage must be between 10 and 5000 characters');
    }
    const proposedBudget = Number(body.proposedBudget ?? body.proposed_budget ?? job.budget_amount);
    if (!Number.isFinite(proposedBudget) || proposedBudget <= 0) {
      throw new MarketplaceApplicationError(400, 'INVALID_PROPOSED_BUDGET', 'proposedBudget must be positive');
    }
    const proposedTimeline = String(body.proposedTimeline ?? body.proposed_timeline ?? job.timeline ?? 'flexible').trim();
    const portfolioItems = body.portfolioItems ?? body.portfolio_items ?? [];
    if (!Array.isArray(portfolioItems) || portfolioItems.length > 10 || portfolioItems.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new MarketplaceApplicationError(400, 'INVALID_PORTFOLIO_ITEMS', 'portfolioItems must contain at most 10 non-empty strings');
    }

    const application = {
      id: `app_${crypto.randomBytes(8).toString('hex')}`,
      job_id: jobId,
      agent_id: actorId,
      cover_message: coverMessage,
      proposed_budget: proposedBudget,
      proposed_timeline: proposedTimeline,
      portfolio_items: JSON.stringify(portfolioItems),
      status: 'pending',
      status_note: null,
      accepted_at: null,
      created_at: now,
      updated_at: now,
    };
    db.prepare(`
      INSERT INTO applications (
        id, job_id, agent_id, cover_message, proposed_budget, proposed_timeline,
        portfolio_items, status, status_note, accepted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      application.id,
      application.job_id,
      application.agent_id,
      application.cover_message,
      application.proposed_budget,
      application.proposed_timeline,
      application.portfolio_items,
      application.status,
      application.status_note,
      application.accepted_at,
      application.created_at,
      application.updated_at,
    );
    db.prepare('UPDATE jobs SET application_count = COALESCE(application_count, 0) + 1, updated_at = ? WHERE id = ?')
      .run(now, jobId);
    transitionApplication(db, { ...application, status: null }, 'pending', actorId, 'agent_applied', now, `apply:${application.id}`);
    return applicationResponse(application);
  });
  return execute();
}

function withdrawApplication(db, { applicationId, jobId = null, actorId, now = new Date().toISOString() }) {
  return db.transaction(() => {
    const application = requireApplication(db, applicationId, jobId);
    if (application.agent_id !== actorId) {
      throw new MarketplaceApplicationError(403, 'APPLICATION_ACTOR_FORBIDDEN', 'Only the applicant may withdraw');
    }
    if (application.status !== 'pending') {
      throw new MarketplaceApplicationError(409, 'APPLICATION_NOT_PENDING', 'Only pending applications may be withdrawn');
    }
    transitionApplication(db, application, 'withdrawn', actorId, 'agent_withdrew', now, `withdraw:${application.id}`);
    db.prepare('UPDATE jobs SET application_count = MAX(application_count - 1, 0), updated_at = ? WHERE id = ?')
      .run(now, application.job_id);
    return applicationResponse(requireApplication(db, applicationId));
  })();
}

function rejectApplication(db, { applicationId, jobId = null, actorId, now = new Date().toISOString() }) {
  return db.transaction(() => {
    const application = requireApplication(db, applicationId, jobId);
    const job = requireJob(db, application.job_id);
    if (job.client_id !== actorId) {
      throw new MarketplaceApplicationError(403, 'CLIENT_ACTION_FORBIDDEN', 'Only the job client may reject applications');
    }
    if (application.status !== 'pending') {
      throw new MarketplaceApplicationError(409, 'APPLICATION_NOT_PENDING', 'Only pending applications may be rejected');
    }
    transitionApplication(db, application, 'rejected', actorId, 'client_rejected', now, `reject:${application.id}`);
    return applicationResponse(requireApplication(db, applicationId));
  })();
}

function selectApplication(db, { applicationId, jobId = null, actorId, now = new Date().toISOString() }) {
  const execute = db.transaction(() => {
    const application = requireApplication(db, applicationId, jobId);
    const job = requireJob(db, application.job_id);
    requireFixedPrice(job);
    if (job.client_id !== actorId) {
      throw new MarketplaceApplicationError(403, 'CLIENT_ACTION_FORBIDDEN', 'Only the job client may select an application');
    }
    if (job.status !== marketplaceState.JOB_STATUS.OPEN || application.status !== 'pending') {
      throw new MarketplaceApplicationError(409, 'APPLICATION_NOT_SELECTABLE', 'Application is not selectable');
    }

    const { requiredAmount, escrow } = assertFundingMatches(db, job, application, now);
    const awardExpiresAt = new Date(new Date(now).getTime() + AWARD_TTL_MS).toISOString();
    marketplaceState.transitionJobState(db, job.id, marketplaceState.JOB_STATUS.AWARDED, {
      actorId,
      reason: 'client selected funded application',
      source: 'marketplace-application-api',
      idempotencyKey: `select:${application.id}`,
      metadata: { applicationId: application.id, escrowId: escrow.id, agreedBudget: requiredAmount },
      now,
    });
    transitionApplication(db, application, 'selected', actorId, 'client_selected', now, `select:${application.id}`);
    db.prepare(`
      UPDATE jobs SET selected_agent_id = ?, selected_application_id = ?, selected_at = ?,
        award_expires_at = ?, agreed_budget = ?, agreed_timeline = ?, updated_at = ?
      WHERE id = ?
    `).run(
      application.agent_id,
      application.id,
      now,
      awardExpiresAt,
      requiredAmount,
      application.proposed_timeline || job.timeline,
      now,
      job.id,
    );
    return {
      jobId: job.id,
      application: applicationResponse(requireApplication(db, application.id)),
      status: marketplaceState.JOB_STATUS.AWARDED,
      awardExpiresAt,
      agreedBudget: requiredAmount,
    };
  });
  try {
    return execute();
  } catch (error) {
    persistEscrowAdjustmentAfterRollback(db, error, now);
    throw error;
  }
}

function persistEscrowAdjustmentAfterRollback(db, error, now) {
  if (!(error instanceof MarketplaceApplicationError) || error.code !== 'ESCROW_ADJUSTMENT_REQUIRED') return;
  const details = error.details || {};
  db.prepare(`
    INSERT OR IGNORE INTO marketplace_escrow_adjustments (
      id, job_id, application_id, escrow_id, adjustment_type,
      funded_amount, required_amount, currency, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?)
  `).run(
    `mea_${crypto.randomUUID()}`,
    details.jobId,
    details.applicationId,
    details.escrowId,
    details.adjustmentType,
    details.fundedAmount,
    details.requiredAmount,
    details.currency,
    now,
  );
}

function reopenAward(db, job, application, actorId, reason, now) {
  marketplaceState.transitionJobState(db, job.id, marketplaceState.JOB_STATUS.OPEN, {
    actorId,
    reason,
    source: 'marketplace-application-api',
    idempotencyKey: `${reason}:${application.id}`,
    metadata: { applicationId: application.id },
    now,
  });
  transitionApplication(db, application, 'rejected', actorId, reason, now, `${reason}:${application.id}`);
  db.prepare(`
    UPDATE jobs SET selected_agent_id = NULL, selected_application_id = NULL,
      selected_at = NULL, award_expires_at = NULL, agreed_budget = NULL,
      agreed_timeline = NULL, updated_at = ? WHERE id = ?
  `).run(now, job.id);
  return { jobId: job.id, applicationId: application.id, status: marketplaceState.JOB_STATUS.OPEN, reason };
}

function acceptAward(db, { applicationId, jobId = null, actorId, now = new Date().toISOString() }) {
  const execute = db.transaction(() => {
    const application = requireApplication(db, applicationId, jobId);
    const job = requireJob(db, application.job_id);
    if (application.agent_id !== actorId) {
      throw new MarketplaceApplicationError(403, 'APPLICATION_ACTOR_FORBIDDEN', 'Only the selected agent may accept');
    }
    if (job.status !== marketplaceState.JOB_STATUS.AWARDED || job.selected_application_id !== application.id || application.status !== 'selected') {
      throw new MarketplaceApplicationError(409, 'AWARD_NOT_ACCEPTABLE', 'Application does not have an active award');
    }
    if (!job.award_expires_at || new Date(now).getTime() >= new Date(job.award_expires_at).getTime()) {
      return {
        ...reopenAward(db, job, application, actorId, 'award_timed_out', now),
        code: 'AWARD_TIMED_OUT',
        error: 'Award timed out and the job was reopened',
        _httpStatus: 409,
      };
    }
    assertFundingMatches(db, job, application, now);
    marketplaceState.transitionJobState(db, job.id, marketplaceState.JOB_STATUS.IN_PROGRESS, {
      actorId,
      reason: 'selected agent accepted award',
      source: 'marketplace-application-api',
      idempotencyKey: `accept:${application.id}`,
      metadata: { applicationId: application.id },
      now,
    });
    transitionApplication(db, application, 'accepted', actorId, 'agent_accepted', now, `accept:${application.id}`);
    const pending = db.prepare("SELECT * FROM applications WHERE job_id = ? AND id <> ? AND status = 'pending'")
      .all(job.id, application.id);
    for (const other of pending) {
      transitionApplication(db, other, 'rejected', actorId, 'another_application_accepted', now, `auto-reject:${application.id}`);
    }
    return { jobId: job.id, application: applicationResponse(requireApplication(db, application.id)), status: marketplaceState.JOB_STATUS.IN_PROGRESS };
  });
  try {
    return execute();
  } catch (error) {
    persistEscrowAdjustmentAfterRollback(db, error, now);
    throw error;
  }
}

function declineAward(db, { applicationId, jobId = null, actorId, now = new Date().toISOString() }) {
  return db.transaction(() => {
    const application = requireApplication(db, applicationId, jobId);
    const job = requireJob(db, application.job_id);
    if (application.agent_id !== actorId) {
      throw new MarketplaceApplicationError(403, 'APPLICATION_ACTOR_FORBIDDEN', 'Only the selected agent may decline');
    }
    if (job.status !== marketplaceState.JOB_STATUS.AWARDED || job.selected_application_id !== application.id || application.status !== 'selected') {
      throw new MarketplaceApplicationError(409, 'AWARD_NOT_DECLINABLE', 'Application does not have an active award');
    }
    return reopenAward(db, job, application, actorId, 'agent_declined', now);
  })();
}

function expireAward(db, { jobId, actorId, now = new Date().toISOString() }) {
  return db.transaction(() => {
    const job = requireJob(db, jobId);
    if (job.client_id !== actorId) {
      throw new MarketplaceApplicationError(403, 'CLIENT_ACTION_FORBIDDEN', 'Only the job client may process an award timeout');
    }
    if (job.status !== marketplaceState.JOB_STATUS.AWARDED || !job.selected_application_id) {
      throw new MarketplaceApplicationError(409, 'NO_ACTIVE_AWARD', 'Job has no active award');
    }
    if (!job.award_expires_at || new Date(now).getTime() < new Date(job.award_expires_at).getTime()) {
      throw new MarketplaceApplicationError(409, 'AWARD_NOT_EXPIRED', 'Award has not reached its 48 hour timeout');
    }
    const application = requireApplication(db, job.selected_application_id, job.id);
    return reopenAward(db, job, application, actorId, 'award_timed_out', now);
  })();
}

function expireTimedOutAwards(db, { now = new Date().toISOString() } = {}) {
  const expiredJobs = db.prepare(`
    SELECT id, selected_application_id
    FROM jobs
    WHERE status = ? AND selected_application_id IS NOT NULL
      AND award_expires_at IS NOT NULL AND award_expires_at <= ?
    ORDER BY award_expires_at ASC, id ASC
  `).all(marketplaceState.JOB_STATUS.AWARDED, now);

  const results = [];
  for (const expired of expiredJobs) {
    const execute = db.transaction(() => {
      const job = requireJob(db, expired.id);
      if (job.status !== marketplaceState.JOB_STATUS.AWARDED || job.selected_application_id !== expired.selected_application_id) return null;
      const application = requireApplication(db, expired.selected_application_id, job.id);
      return reopenAward(db, job, application, 'system:award-timeout', 'award_timed_out', now);
    });
    const result = execute();
    if (result) results.push(result);
  }
  return results;
}

function registerMarketplaceApplicationRoutes(app, { getDb, closeDb = false, timeoutSweepIntervalMs = 0 } = {}) {
  if (typeof getDb !== 'function') throw new TypeError('getDb is required');
  const schemaDb = getDb();
  initializeMarketplaceApplicationSchema(schemaDb);
  if (closeDb) schemaDb.close();

  const requireAuth = createRequireAuth({
    getDb,
    closeDb,
    actorProperty: 'marketplaceActorId',
    invalidStatus: 403,
    missingBody: { code: 'AUTH_REQUIRED', error: 'Missing API key' },
    invalidBody: { code: 'AUTH_INVALID', error: 'Invalid API key' },
    failureBody: (error) => ({ code: 'AUTH_FAILURE', error: error.message }),
  });

  const invoke = (operation, successStatus = 200) => (req, res) => {
    const db = getDb();
    try {
      const result = operation(db, {
        jobId: req.params.jobId || req.params.id || null,
        applicationId: req.params.applicationId || null,
        actorId: req.marketplaceActorId,
        body: req.body || {},
      });
      const responseStatus = result?._httpStatus || successStatus;
      if (result && Object.prototype.hasOwnProperty.call(result, '_httpStatus')) delete result._httpStatus;
      return res.status(responseStatus).json(result);
    } catch (error) {
      if (error instanceof MarketplaceApplicationError) {
        return res.status(error.status).json({ code: error.code, error: error.message, ...error.details });
      }
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ code: 'APPLICATION_ALREADY_EXISTS', error: 'Only one application per agent and job is allowed' });
      }
      return res.status(500).json({ code: 'MARKETPLACE_APPLICATION_FAILURE', error: error.message });
    } finally {
      if (closeDb) db.close();
    }
  };

  const postAliases = (paths, handler) => paths.forEach((routePath) => (
    app.post(routePath, marketplaceMutationLimiter, requireAuth, handler)
  ));
  postAliases(['/api/jobs/:id/apply', '/api/marketplace/jobs/:id/apply'], invoke(applyToJob, 201));
  postAliases([
    '/api/applications/:applicationId/withdraw',
    '/api/jobs/:jobId/applications/:applicationId/withdraw',
    '/api/marketplace/applications/:applicationId/withdraw',
    '/api/marketplace/jobs/:jobId/applications/:applicationId/withdraw',
  ], invoke(withdrawApplication));
  postAliases([
    '/api/applications/:applicationId/reject',
    '/api/jobs/:jobId/applications/:applicationId/reject',
    '/api/marketplace/applications/:applicationId/reject',
    '/api/marketplace/jobs/:jobId/applications/:applicationId/reject',
  ], invoke(rejectApplication));
  postAliases([
    '/api/applications/:applicationId/select',
    '/api/jobs/:jobId/applications/:applicationId/select',
    '/api/marketplace/applications/:applicationId/select',
    '/api/marketplace/jobs/:jobId/applications/:applicationId/select',
  ], invoke(selectApplication));
  postAliases([
    '/api/applications/:applicationId/accept',
    '/api/jobs/:jobId/applications/:applicationId/accept',
    '/api/marketplace/applications/:applicationId/accept',
    '/api/marketplace/jobs/:jobId/applications/:applicationId/accept',
  ], invoke(acceptAward));
  postAliases([
    '/api/applications/:applicationId/decline',
    '/api/jobs/:jobId/applications/:applicationId/decline',
    '/api/marketplace/applications/:applicationId/decline',
    '/api/marketplace/jobs/:jobId/applications/:applicationId/decline',
  ], invoke(declineAward));
  postAliases([
    '/api/jobs/:jobId/award-timeout',
    '/api/marketplace/jobs/:jobId/award-timeout',
  ], invoke(expireAward));

  if (Number(timeoutSweepIntervalMs) > 0) {
    const timer = setInterval(() => {
      const db = getDb();
      try {
        expireTimedOutAwards(db);
      } catch (error) {
        console.error('[Marketplace] award timeout sweep failed:', error.message);
      } finally {
        if (closeDb) db.close();
      }
    }, Number(timeoutSweepIntervalMs));
    if (typeof timer.unref === 'function') timer.unref();
  }
}

module.exports = {
  AWARD_TTL_MS,
  DAILY_APPLICATION_LIMIT,
  MarketplaceApplicationError,
  initializeMarketplaceApplicationSchema,
  applyToJob,
  withdrawApplication,
  rejectApplication,
  selectApplication,
  acceptAward,
  declineAward,
  expireAward,
  expireTimedOutAwards,
  registerMarketplaceApplicationRoutes,
};
