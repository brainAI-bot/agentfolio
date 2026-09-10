'use strict';

const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const marketplaceState = require('../lib/marketplace-state-machine');
const { initializeMarketplaceCoreSchema } = require('../lib/marketplace-schema');
const { createMarketplaceAuth, registerMarketplaceAuthChallengeRoute } = require('../lib/marketplace-wallet-auth');

const AUTO_APPROVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REVISION_REQUESTS = 2;
const marketplaceMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'MARKETPLACE_RATE_LIMIT', error: 'Too many marketplace mutation requests' },
});

class MarketplaceDeliveryError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'MarketplaceDeliveryError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function parseJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function initializeMarketplaceDeliverySchema(db) {
  initializeMarketplaceCoreSchema(db);
  marketplaceState.initializeMarketplaceState(db);
  const profileColumns = db.prepare('PRAGMA table_info(profiles)').all();
  if (!profileColumns.some((entry) => entry.name === 'api_key')) {
    db.exec('ALTER TABLE profiles ADD COLUMN api_key TEXT');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_deliverables (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      submission_number INTEGER NOT NULL CHECK(submission_number > 0),
      text TEXT NOT NULL,
      links TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL,
      submitted_by TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      auto_approve_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      UNIQUE (job_id, submission_number),
      UNIQUE (job_id, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_marketplace_deliverables_job
      ON marketplace_deliverables(job_id, submitted_at, id);
    CREATE INDEX IF NOT EXISTS idx_marketplace_deliverables_auto_approve
      ON marketplace_deliverables(auto_approve_at, job_id);

    CREATE TABLE IF NOT EXISTS marketplace_revision_requests (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      deliverable_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL CHECK(revision_number BETWEEN 1 AND 2),
      reason TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (deliverable_id) REFERENCES marketplace_deliverables(id),
      UNIQUE (job_id, revision_number),
      UNIQUE (job_id, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_marketplace_revision_requests_job
      ON marketplace_revision_requests(job_id, created_at, id);

    CREATE TABLE IF NOT EXISTS marketplace_job_comments (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      text TEXT NOT NULL,
      attachment_links TEXT NOT NULL DEFAULT '[]',
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      UNIQUE (job_id, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_marketplace_job_comments_job
      ON marketplace_job_comments(job_id, created_at, id);

    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_deliverables_update
    BEFORE UPDATE ON marketplace_deliverables
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_DELIVERABLE_IMMUTABLE');
    END;
    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_deliverables_delete
    BEFORE DELETE ON marketplace_deliverables
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_DELIVERABLE_IMMUTABLE');
    END;
    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_revision_requests_update
    BEFORE UPDATE ON marketplace_revision_requests
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_REVISION_REQUEST_IMMUTABLE');
    END;
    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_revision_requests_delete
    BEFORE DELETE ON marketplace_revision_requests
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_REVISION_REQUEST_IMMUTABLE');
    END;
    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_job_comments_update
    BEFORE UPDATE ON marketplace_job_comments
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_JOB_COMMENT_IMMUTABLE');
    END;
    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_job_comments_delete
    BEFORE DELETE ON marketplace_job_comments
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_JOB_COMMENT_IMMUTABLE');
    END;
  `);
}

function requireJob(db, jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new MarketplaceDeliveryError(404, 'JOB_NOT_FOUND', 'Job not found');
  if ((job.budget_type || 'fixed') !== 'fixed') {
    throw new MarketplaceDeliveryError(409, 'FIXED_PRICE_ONLY', 'Only fixed-price jobs are supported');
  }
  return job;
}

function normalizeLinks(value, fieldName, maxItems = 20) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new MarketplaceDeliveryError(400, `INVALID_${fieldName.toUpperCase()}`, `${fieldName} must be an array of at most ${maxItems} links`);
  }
  const links = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (links.some((link) => {
    try {
      const url = new URL(link);
      return !['https:', 'http:'].includes(url.protocol);
    } catch (_) {
      return true;
    }
  })) {
    throw new MarketplaceDeliveryError(400, `INVALID_${fieldName.toUpperCase()}`, `${fieldName} must contain only HTTP(S) links`);
  }
  return [...new Set(links)];
}

function deliverableResponse(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    submissionNumber: row.submission_number,
    text: row.text,
    links: parseJson(row.links, []),
    contentHash: row.content_hash,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    autoApproveAt: row.auto_approve_at,
  };
}

function revisionResponse(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    deliverableId: row.deliverable_id,
    revisionNumber: row.revision_number,
    reason: row.reason,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
  };
}

function commentResponse(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    authorId: row.author_id,
    text: row.text,
    attachmentLinks: parseJson(row.attachment_links, []),
    createdAt: row.created_at,
  };
}

function latestDeliverable(db, jobId) {
  return db.prepare(`
    SELECT * FROM marketplace_deliverables
    WHERE job_id = ? ORDER BY submission_number DESC LIMIT 1
  `).get(jobId);
}

function requireCurrentDeliverable(db, jobId, deliverableId = null) {
  const deliverable = latestDeliverable(db, jobId);
  if (!deliverable || (deliverableId && deliverable.id !== deliverableId)) {
    throw new MarketplaceDeliveryError(404, 'DELIVERABLE_NOT_FOUND', 'Current deliverable not found');
  }
  return deliverable;
}

function parseAdminIds(value = process.env.MARKETPLACE_ADMIN_PROFILE_IDS || '') {
  return new Set(String(value).split(',').map((id) => id.trim()).filter(Boolean));
}

function assertParty(job, actorId, adminIds = parseAdminIds()) {
  if (![job.client_id, job.selected_agent_id].includes(actorId) && !adminIds.has(actorId)) {
    throw new MarketplaceDeliveryError(403, 'JOB_PARTY_REQUIRED', 'Only job parties or marketplace admins may access the job thread');
  }
}

function submitDeliverable(db, {
  jobId,
  actorId,
  body = {},
  now = new Date().toISOString(),
  idempotencyKey = null,
}) {
  initializeMarketplaceDeliverySchema(db);
  return db.transaction(() => {
    const job = requireJob(db, jobId);
    if (job.selected_agent_id !== actorId) {
      throw new MarketplaceDeliveryError(403, 'WORKER_ACTION_FORBIDDEN', 'Only the awarded worker may submit a deliverable');
    }
    if (job.status !== marketplaceState.JOB_STATUS.IN_PROGRESS) {
      throw new MarketplaceDeliveryError(409, 'JOB_NOT_IN_PROGRESS', 'The awarded job must be in progress before delivery');
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 20000) {
      throw new MarketplaceDeliveryError(400, 'INVALID_DELIVERABLE_TEXT', 'text must be between 1 and 20000 characters');
    }
    const links = normalizeLinks(body.links, 'deliverable_links');
    const contentHash = crypto.createHash('sha256').update(JSON.stringify({ text, links })).digest('hex');
    if (body.contentHash && String(body.contentHash).toLowerCase() !== contentHash) {
      throw new MarketplaceDeliveryError(400, 'CONTENT_HASH_MISMATCH', 'contentHash does not match the canonical deliverable content');
    }
    const key = String(idempotencyKey || body.idempotencyKey || `submit:${crypto.randomUUID()}`);
    const replay = db.prepare('SELECT * FROM marketplace_deliverables WHERE job_id = ? AND idempotency_key = ?').get(jobId, key);
    if (replay) return { deliverable: deliverableResponse(replay), status: marketplaceState.JOB_STATUS.SUBMITTED, replayed: true };

    const submissionNumber = Number(db.prepare('SELECT COUNT(*) AS count FROM marketplace_deliverables WHERE job_id = ?').get(jobId).count) + 1;
    const deliverable = {
      id: `mdl_${crypto.randomUUID()}`,
      job_id: jobId,
      submission_number: submissionNumber,
      text,
      links: JSON.stringify(links),
      content_hash: contentHash,
      submitted_by: actorId,
      idempotency_key: key,
      submitted_at: now,
      auto_approve_at: new Date(new Date(now).getTime() + AUTO_APPROVAL_MS).toISOString(),
    };
    db.prepare(`
      INSERT INTO marketplace_deliverables (
        id, job_id, submission_number, text, links, content_hash,
        submitted_by, idempotency_key, submitted_at, auto_approve_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...Object.values(deliverable));
    marketplaceState.transitionJobState(db, jobId, marketplaceState.JOB_STATUS.SUBMITTED, {
      actorId,
      reason: 'awarded worker submitted deliverable',
      source: 'marketplace-delivery-api',
      idempotencyKey: `deliverable-submit:${deliverable.id}`,
      metadata: { deliverableId: deliverable.id, submissionNumber, contentHash },
      now,
    });
    return { deliverable: deliverableResponse(deliverable), status: marketplaceState.JOB_STATUS.SUBMITTED };
  })();
}

function requestRevision(db, {
  jobId,
  deliverableId = null,
  actorId,
  body = {},
  now = new Date().toISOString(),
  idempotencyKey = null,
}) {
  initializeMarketplaceDeliverySchema(db);
  return db.transaction(() => {
    const job = requireJob(db, jobId);
    if (job.client_id !== actorId) {
      throw new MarketplaceDeliveryError(403, 'CLIENT_ACTION_FORBIDDEN', 'Only the job client may request revisions');
    }
    if (job.status !== marketplaceState.JOB_STATUS.SUBMITTED) {
      throw new MarketplaceDeliveryError(409, 'JOB_NOT_SUBMITTED', 'A submitted deliverable is required');
    }
    const deliverable = requireCurrentDeliverable(db, jobId, deliverableId);
    const key = String(idempotencyKey || body.idempotencyKey || `revision:${crypto.randomUUID()}`);
    const replay = db.prepare('SELECT * FROM marketplace_revision_requests WHERE job_id = ? AND idempotency_key = ?').get(jobId, key);
    if (replay) return { revision: revisionResponse(replay), status: marketplaceState.JOB_STATUS.IN_PROGRESS, replayed: true };
    const revisionNumber = Number(db.prepare('SELECT COUNT(*) AS count FROM marketplace_revision_requests WHERE job_id = ?').get(jobId).count) + 1;
    if (revisionNumber > MAX_REVISION_REQUESTS) {
      throw new MarketplaceDeliveryError(409, 'REVISION_LIMIT_REACHED', 'A maximum of two revision requests is allowed');
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length > 5000) {
      throw new MarketplaceDeliveryError(400, 'INVALID_REVISION_REASON', 'reason must be between 1 and 5000 characters');
    }
    const revision = {
      id: `mrr_${crypto.randomUUID()}`,
      job_id: jobId,
      deliverable_id: deliverable.id,
      revision_number: revisionNumber,
      reason,
      requested_by: actorId,
      idempotency_key: key,
      created_at: now,
    };
    db.prepare(`
      INSERT INTO marketplace_revision_requests (
        id, job_id, deliverable_id, revision_number, reason,
        requested_by, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...Object.values(revision));
    marketplaceState.transitionJobState(db, jobId, marketplaceState.JOB_STATUS.IN_PROGRESS, {
      actorId,
      reason: 'client requested deliverable revision',
      source: 'marketplace-delivery-api',
      idempotencyKey: `deliverable-revision:${revision.id}`,
      metadata: { deliverableId: deliverable.id, revisionNumber },
      now,
    });
    return { revision: revisionResponse(revision), status: marketplaceState.JOB_STATUS.IN_PROGRESS };
  })();
}

function approveDeliverable(db, {
  jobId,
  deliverableId = null,
  actorId,
  now = new Date().toISOString(),
  idempotencyKey = null,
}) {
  initializeMarketplaceDeliverySchema(db);
  return db.transaction(() => {
    const job = requireJob(db, jobId);
    if (job.client_id !== actorId) {
      throw new MarketplaceDeliveryError(403, 'CLIENT_ACTION_FORBIDDEN', 'Only the job client may approve a deliverable');
    }
    const deliverable = requireCurrentDeliverable(db, jobId, deliverableId);
    if (job.status === marketplaceState.JOB_STATUS.APPROVED) {
      return { deliverable: deliverableResponse(deliverable), status: marketplaceState.JOB_STATUS.APPROVED, replayed: true };
    }
    if (job.status !== marketplaceState.JOB_STATUS.SUBMITTED) {
      throw new MarketplaceDeliveryError(409, 'JOB_NOT_SUBMITTED', 'A submitted deliverable is required');
    }
    const key = String(idempotencyKey || `approve:${crypto.randomUUID()}`);
    const transition = marketplaceState.transitionJobState(db, jobId, marketplaceState.JOB_STATUS.APPROVED, {
      actorId,
      reason: 'client approved deliverable',
      source: 'marketplace-delivery-api',
      idempotencyKey: `deliverable-approve:${deliverable.id}:${key}`,
      metadata: { deliverableId: deliverable.id, contentHash: deliverable.content_hash },
      now,
    });
    return { deliverable: deliverableResponse(deliverable), status: transition.job.status, transitionAuditId: transition.audit.id };
  })();
}

function autoApproveDueDeliverables(db, { now = new Date().toISOString() } = {}) {
  initializeMarketplaceDeliverySchema(db);
  const due = db.prepare(`
    SELECT d.* FROM marketplace_deliverables d
    JOIN jobs j ON j.id = d.job_id
    WHERE j.status = ? AND d.auto_approve_at <= ?
      AND d.submission_number = (
        SELECT MAX(current.submission_number) FROM marketplace_deliverables current WHERE current.job_id = d.job_id
      )
    ORDER BY d.auto_approve_at ASC, d.id ASC
  `).all(marketplaceState.JOB_STATUS.SUBMITTED, now);
  const results = [];
  const errors = [];
  for (const candidate of due) {
    const execute = db.transaction(() => {
      const job = requireJob(db, candidate.job_id);
      if (job.status !== marketplaceState.JOB_STATUS.SUBMITTED) return null;
      const current = requireCurrentDeliverable(db, job.id, candidate.id);
      const transition = marketplaceState.transitionJobState(db, job.id, marketplaceState.JOB_STATUS.APPROVED, {
        actorId: 'system:marketplace-auto-approval',
        reason: 'client silent for seven days after deliverable submission',
        source: 'marketplace-delivery-timer',
        idempotencyKey: `deliverable-auto-approve:${current.id}`,
        metadata: { deliverableId: current.id, dueAt: current.auto_approve_at },
        now,
      });
      return { jobId: job.id, deliverableId: current.id, status: transition.job.status, transitionAuditId: transition.audit.id };
    });
    try {
      const result = execute();
      if (result) results.push(result);
    } catch (error) {
      errors.push({
        jobId: candidate.job_id,
        deliverableId: candidate.id,
        code: error.code || 'AUTO_APPROVAL_FAILED',
        error: error.message,
      });
    }
  }
  return { results, errors };
}

function runAutoApprovalSweep(db, { now = new Date().toISOString(), logger = console } = {}) {
  const result = autoApproveDueDeliverables(db, { now });
  for (const failure of result.errors) {
    logger.error(
      '[Marketplace] auto-approval skipped job %s deliverable %s: %s (%s)',
      failure.jobId,
      failure.deliverableId,
      failure.code,
      failure.error,
    );
  }
  return result;
}

function addJobComment(db, {
  jobId,
  actorId,
  body = {},
  now = new Date().toISOString(),
  idempotencyKey = null,
  adminIds = parseAdminIds(),
}) {
  initializeMarketplaceDeliverySchema(db);
  return db.transaction(() => {
    const job = requireJob(db, jobId);
    assertParty(job, actorId, adminIds);
    if (body.attachments !== undefined || body.files !== undefined) {
      throw new MarketplaceDeliveryError(400, 'ATTACHMENT_LINKS_ONLY', 'Only attachmentLinks are accepted; binary/file attachments are not supported');
    }
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 5000) {
      throw new MarketplaceDeliveryError(400, 'INVALID_COMMENT_TEXT', 'text must be between 1 and 5000 characters');
    }
    const attachmentLinks = normalizeLinks(body.attachmentLinks, 'attachment_links', 10);
    const key = String(idempotencyKey || body.idempotencyKey || `comment:${crypto.randomUUID()}`);
    const replay = db.prepare('SELECT * FROM marketplace_job_comments WHERE job_id = ? AND idempotency_key = ?').get(jobId, key);
    if (replay) return { comment: commentResponse(replay), replayed: true };
    const comment = {
      id: `mjc_${crypto.randomUUID()}`,
      job_id: jobId,
      author_id: actorId,
      text,
      attachment_links: JSON.stringify(attachmentLinks),
      idempotency_key: key,
      created_at: now,
    };
    db.prepare(`
      INSERT INTO marketplace_job_comments (
        id, job_id, author_id, text, attachment_links, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(...Object.values(comment));
    return { comment: commentResponse(comment) };
  })();
}

function listJobThread(db, { jobId, actorId, adminIds = parseAdminIds() }) {
  initializeMarketplaceDeliverySchema(db);
  const job = requireJob(db, jobId);
  assertParty(job, actorId, adminIds);
  return {
    jobId,
    deliverables: db.prepare('SELECT * FROM marketplace_deliverables WHERE job_id = ? ORDER BY submission_number ASC').all(jobId).map(deliverableResponse),
    revisions: db.prepare('SELECT * FROM marketplace_revision_requests WHERE job_id = ? ORDER BY revision_number ASC').all(jobId).map(revisionResponse),
    comments: db.prepare('SELECT * FROM marketplace_job_comments WHERE job_id = ? ORDER BY created_at ASC, rowid ASC').all(jobId).map(commentResponse),
  };
}

function registerMarketplaceDeliveryRoutes(app, { getDb, closeDb = false, autoApprovalSweepIntervalMs = 0 } = {}) {
  if (typeof getDb !== 'function') throw new TypeError('getDb is required');
  const schemaDb = getDb();
  initializeMarketplaceDeliverySchema(schemaDb);
  if (closeDb) schemaDb.close();

  registerMarketplaceAuthChallengeRoute(app, { getDb, closeDb });
  const authorize = createMarketplaceAuth({ getDb, closeDb, actorProperty: 'marketplaceDeliveryActorId' });

  const invoke = (operation, successStatus = 200) => (req, res) => {
    const db = getDb();
    try {
      const result = operation(db, {
        jobId: req.params.jobId || req.params.id,
        deliverableId: req.params.deliverableId || req.body?.deliverableId || null,
        actorId: req.marketplaceDeliveryActorId,
        body: req.body || {},
        idempotencyKey: req.headers['idempotency-key'] || null,
      });
      return res.status(successStatus).json(result);
    } catch (error) {
      if (error instanceof MarketplaceDeliveryError) {
        return res.status(error.status).json({ code: error.code, error: error.message, ...error.details });
      }
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ code: 'IDEMPOTENCY_CONFLICT', error: 'The marketplace mutation was already recorded' });
      }
      return res.status(500).json({ code: 'MARKETPLACE_DELIVERY_FAILURE', error: error.message });
    } finally {
      if (closeDb) db.close();
    }
  };

  const postAliases = (paths, action, resourceId, handler) => paths.forEach((routePath) => app.post(
    routePath,
    marketplaceMutationLimiter,
    authorize({ action, resourceId }),
    handler,
  ));
  const getAliases = (paths, action, handler) => paths.forEach((routePath) => app.get(
    routePath,
    marketplaceMutationLimiter,
    authorize({ action, resourceId: (req) => req.params.jobId || req.params.id }),
    handler,
  ));
  postAliases([
    '/api/jobs/:jobId/deliverables',
    '/api/marketplace/jobs/:jobId/deliverables',
    '/api/marketplace/jobs/:id/deliver',
  ], 'submit', (req) => req.params.jobId || req.params.id, invoke(submitDeliverable, 201));
  postAliases([
    '/api/jobs/:jobId/deliverables/:deliverableId/revisions',
    '/api/marketplace/jobs/:jobId/deliverables/:deliverableId/revisions',
    '/api/jobs/:jobId/request-changes',
    '/api/marketplace/jobs/:jobId/request-changes',
  ], 'revise', (req) => req.params.deliverableId || req.body?.deliverableId, invoke(requestRevision, 201));
  postAliases([
    '/api/jobs/:jobId/deliverables/:deliverableId/approve',
    '/api/marketplace/jobs/:jobId/deliverables/:deliverableId/approve',
    '/api/jobs/:jobId/approve',
    '/api/marketplace/jobs/:jobId/approve',
  ], 'approve', (req) => req.params.deliverableId || req.body?.deliverableId, invoke(approveDeliverable));
  postAliases([
    '/api/jobs/:jobId/comments',
    '/api/marketplace/jobs/:jobId/comments',
  ], 'comment', (req) => req.params.jobId || req.params.id, invoke(addJobComment, 201));
  getAliases([
    '/api/jobs/:jobId/thread',
    '/api/marketplace/jobs/:jobId/thread',
  ], 'thread', invoke(listJobThread));

  if (Number(autoApprovalSweepIntervalMs) > 0) {
    const timer = setInterval(() => {
      const db = getDb();
      try {
        runAutoApprovalSweep(db);
      } catch (error) {
        console.error('[Marketplace] deliverable auto-approval sweep failed:', error.message);
      } finally {
        if (closeDb) db.close();
      }
    }, Number(autoApprovalSweepIntervalMs));
    if (typeof timer.unref === 'function') timer.unref();
  }
}

module.exports = {
  AUTO_APPROVAL_MS,
  MAX_REVISION_REQUESTS,
  MarketplaceDeliveryError,
  initializeMarketplaceDeliverySchema,
  submitDeliverable,
  requestRevision,
  approveDeliverable,
  autoApproveDueDeliverables,
  runAutoApprovalSweep,
  addJobComment,
  listJobThread,
  registerMarketplaceDeliveryRoutes,
};
