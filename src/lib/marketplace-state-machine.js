const crypto = require('crypto');
const { liveEscrowGateStatus } = require('./write-surface-gate');

const JOB_STATUS = Object.freeze({
  OPEN: 'open',
  AWARDED: 'awarded',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  RELEASED: 'released',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  DISPUTED: 'disputed',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [JOB_STATUS.OPEN]: Object.freeze([
    JOB_STATUS.AWARDED,
    JOB_STATUS.CANCELLED,
    JOB_STATUS.EXPIRED,
  ]),
  [JOB_STATUS.AWARDED]: Object.freeze([
    JOB_STATUS.IN_PROGRESS,
    JOB_STATUS.OPEN,
  ]),
  [JOB_STATUS.IN_PROGRESS]: Object.freeze([
    JOB_STATUS.SUBMITTED,
    JOB_STATUS.DISPUTED,
  ]),
  [JOB_STATUS.SUBMITTED]: Object.freeze([
    JOB_STATUS.APPROVED,
    JOB_STATUS.IN_PROGRESS,
    JOB_STATUS.DISPUTED,
  ]),
  [JOB_STATUS.APPROVED]: Object.freeze([JOB_STATUS.RELEASED]),
  [JOB_STATUS.DISPUTED]: Object.freeze([JOB_STATUS.RELEASED]),
  [JOB_STATUS.RELEASED]: Object.freeze([JOB_STATUS.CLOSED]),
  [JOB_STATUS.CLOSED]: Object.freeze([]),
  [JOB_STATUS.CANCELLED]: Object.freeze([]),
  [JOB_STATUS.EXPIRED]: Object.freeze([]),
});

const transitionContexts = new WeakMap();

class MarketplaceTransitionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MarketplaceTransitionError';
    this.code = code;
    this.details = details;
  }
}

function initializeMarketplaceState(db) {
  if (!transitionContexts.has(db)) {
    const context = { authorizedDepth: 0 };
    transitionContexts.set(db, context);
    db.function('marketplace_transition_authorized', () => (
      context.authorizedDepth > 0 ? 1 : 0
    ));
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS job_transition_audit (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'server',
      idempotency_key TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      UNIQUE (job_id, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_job_transition_audit_job
      ON job_transition_audit(job_id, created_at, id);

    CREATE TABLE IF NOT EXISTS marketplace_escrow_effects (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      transition_audit_id TEXT NOT NULL,
      effect_type TEXT NOT NULL CHECK(effect_type IN ('release', 'refund', 'dispute')),
      execution_mode TEXT NOT NULL CHECK(execution_mode IN ('staged', 'ready')),
      status TEXT NOT NULL CHECK(status IN ('staged', 'pending_execution')),
      live_escrow_enabled INTEGER NOT NULL CHECK(live_escrow_enabled IN (0, 1)),
      gate_status TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (transition_audit_id) REFERENCES job_transition_audit(id),
      UNIQUE (transition_audit_id, effect_type)
    );

    CREATE INDEX IF NOT EXISTS idx_marketplace_escrow_effects_job
      ON marketplace_escrow_effects(job_id, created_at, id);

    CREATE TRIGGER IF NOT EXISTS guard_jobs_status_transition
    BEFORE UPDATE OF status ON jobs
    WHEN OLD.status IS NOT NEW.status
      AND marketplace_transition_authorized() = 0
    BEGIN
      SELECT RAISE(ABORT, 'JOB_STATUS_TRANSITION_REQUIRES_GUARD');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_job_transition_audit_update
    BEFORE UPDATE ON job_transition_audit
    BEGIN
      SELECT RAISE(ABORT, 'JOB_TRANSITION_AUDIT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_job_transition_audit_delete
    BEFORE DELETE ON job_transition_audit
    BEGIN
      SELECT RAISE(ABORT, 'JOB_TRANSITION_AUDIT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_escrow_effects_update
    BEFORE UPDATE ON marketplace_escrow_effects
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_ESCROW_EFFECT_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_escrow_effects_delete
    BEFORE DELETE ON marketplace_escrow_effects
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_ESCROW_EFFECT_IMMUTABLE');
    END;
  `);
}

function assertTransitionAllowed(fromStatus, toStatus) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, fromStatus)) {
    throw new MarketplaceTransitionError(
      'UNKNOWN_JOB_STATUS',
      `Unknown current job status: ${fromStatus}`,
      { fromStatus, toStatus },
    );
  }
  if (!Object.values(JOB_STATUS).includes(toStatus)) {
    throw new MarketplaceTransitionError(
      'UNKNOWN_JOB_STATUS',
      `Unknown target job status: ${toStatus}`,
      { fromStatus, toStatus },
    );
  }
  if (fromStatus === toStatus) {
    throw new MarketplaceTransitionError(
      'REPLAYED_JOB_TRANSITION',
      `Job is already ${toStatus}`,
      { fromStatus, toStatus },
    );
  }
  if (!ALLOWED_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new MarketplaceTransitionError(
      'ILLEGAL_JOB_TRANSITION',
      `Illegal job transition: ${fromStatus} -> ${toStatus}`,
      { fromStatus, toStatus },
    );
  }
}

function escrowEffectFor(job, fromStatus, toStatus) {
  if (toStatus === JOB_STATUS.DISPUTED) return 'dispute';
  if (toStatus === JOB_STATUS.RELEASED) return 'release';
  if (
    fromStatus === JOB_STATUS.OPEN
    && [JOB_STATUS.CANCELLED, JOB_STATUS.EXPIRED].includes(toStatus)
    && (job.escrow_funded === 1 || job.escrow_funded === true)
  ) {
    return 'refund';
  }
  return null;
}

function parseMetadata(metadata) {
  if (metadata === undefined || metadata === null) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new MarketplaceTransitionError(
      'INVALID_TRANSITION_METADATA',
      'Transition metadata must be an object',
    );
  }
  return metadata;
}

function transitionJobState(db, jobId, toStatus, options = {}) {
  initializeMarketplaceState(db);

  const actorId = String(options.actorId || '').trim();
  if (!actorId) {
    throw new MarketplaceTransitionError(
      'TRANSITION_ACTOR_REQUIRED',
      'actorId is required for every job transition',
    );
  }

  const idempotencyKey = String(options.idempotencyKey || crypto.randomUUID()).trim();
  if (!idempotencyKey) {
    throw new MarketplaceTransitionError(
      'TRANSITION_IDEMPOTENCY_KEY_REQUIRED',
      'idempotencyKey cannot be empty',
    );
  }

  const reason = String(options.reason || '').trim();
  const source = String(options.source || 'server').trim() || 'server';
  const metadata = parseMetadata(options.metadata);
  const now = String(options.now || new Date().toISOString());
  const env = options.env || process.env;
  const context = transitionContexts.get(db);

  const execute = db.transaction(() => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!job) {
      throw new MarketplaceTransitionError(
        'JOB_NOT_FOUND',
        `Job not found: ${jobId}`,
        { jobId, toStatus },
      );
    }

    assertTransitionAllowed(job.status, toStatus);

    const duplicate = db.prepare(`
      SELECT id, from_status, to_status
      FROM job_transition_audit
      WHERE job_id = ? AND idempotency_key = ?
    `).get(jobId, idempotencyKey);
    if (duplicate) {
      throw new MarketplaceTransitionError(
        'REPLAYED_JOB_TRANSITION',
        `Transition idempotency key already used for job ${jobId}`,
        { jobId, idempotencyKey, previous: duplicate },
      );
    }

    const auditId = `jta_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO job_transition_audit (
        id, job_id, from_status, to_status, actor_id, reason,
        source, idempotency_key, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      auditId,
      jobId,
      job.status,
      toStatus,
      actorId,
      reason,
      source,
      idempotencyKey,
      JSON.stringify(metadata),
      now,
    );

    context.authorizedDepth += 1;
    try {
      const result = db.prepare(`
        UPDATE jobs
        SET status = ?, updated_at = ?
        WHERE id = ? AND status = ?
      `).run(toStatus, now, jobId, job.status);
      if (result.changes !== 1) {
        throw new MarketplaceTransitionError(
          'JOB_TRANSITION_CONFLICT',
          `Job status changed concurrently: ${jobId}`,
          { jobId, expectedStatus: job.status, toStatus },
        );
      }
    } finally {
      context.authorizedDepth -= 1;
    }

    let escrowEffect = null;
    const effectType = escrowEffectFor(job, job.status, toStatus);
    if (effectType) {
      const gate = liveEscrowGateStatus(env);
      const liveEscrowEnabled = gate.enabled === true;
      escrowEffect = {
        id: `mee_${crypto.randomUUID()}`,
        jobId,
        transitionAuditId: auditId,
        effectType,
        executionMode: liveEscrowEnabled ? 'ready' : 'staged',
        status: liveEscrowEnabled ? 'pending_execution' : 'staged',
        liveEscrowEnabled,
        gateStatus: gate.status,
        payload: {
          escrowId: job.escrow_id || null,
          fromStatus: job.status,
          toStatus,
          transitionAuditId: auditId,
        },
        createdAt: now,
      };

      db.prepare(`
        INSERT INTO marketplace_escrow_effects (
          id, job_id, transition_audit_id, effect_type, execution_mode,
          status, live_escrow_enabled, gate_status, payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        escrowEffect.id,
        escrowEffect.jobId,
        escrowEffect.transitionAuditId,
        escrowEffect.effectType,
        escrowEffect.executionMode,
        escrowEffect.status,
        escrowEffect.liveEscrowEnabled ? 1 : 0,
        escrowEffect.gateStatus,
        JSON.stringify(escrowEffect.payload),
        escrowEffect.createdAt,
      );
    }

    return {
      job: { ...job, status: toStatus, updated_at: now },
      audit: {
        id: auditId,
        jobId,
        fromStatus: job.status,
        toStatus,
        actorId,
        reason,
        source,
        idempotencyKey,
        metadata,
        createdAt: now,
      },
      escrowEffect,
    };
  });

  return execute();
}

function listJobTransitionAudit(db, jobId) {
  initializeMarketplaceState(db);
  return db.prepare(`
    SELECT * FROM job_transition_audit
    WHERE job_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(jobId).map((row) => ({
    id: row.id,
    jobId: row.job_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorId: row.actor_id,
    reason: row.reason,
    source: row.source,
    idempotencyKey: row.idempotency_key,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: row.created_at,
  }));
}

function listMarketplaceEscrowEffects(db, jobId) {
  initializeMarketplaceState(db);
  return db.prepare(`
    SELECT * FROM marketplace_escrow_effects
    WHERE job_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(jobId).map((row) => ({
    id: row.id,
    jobId: row.job_id,
    transitionAuditId: row.transition_audit_id,
    effectType: row.effect_type,
    executionMode: row.execution_mode,
    status: row.status,
    liveEscrowEnabled: Boolean(row.live_escrow_enabled),
    gateStatus: row.gate_status,
    payload: JSON.parse(row.payload || '{}'),
    createdAt: row.created_at,
  }));
}

module.exports = {
  JOB_STATUS,
  ALLOWED_TRANSITIONS,
  MarketplaceTransitionError,
  initializeMarketplaceState,
  transitionJobState,
  listJobTransitionAudit,
  listMarketplaceEscrowEffects,
};
