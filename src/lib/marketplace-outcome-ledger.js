'use strict';

const crypto = require('node:crypto');
const { formatMinorUnits } = require('./marketplace-money');

const OUTCOME_MODEL_VERSION = 'marketplace-outcomes-v1';
const writeContexts = new WeakMap();

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function ensureOutcomeConnection(db) {
  if (!writeContexts.has(db)) {
    const context = { authorizedDepth: 0, schemaInitialized: false };
    writeContexts.set(db, context);
    db.function('marketplace_outcome_write_authorized', () => (
      context.authorizedDepth > 0 ? 1 : 0
    ));
  }
  return writeContexts.get(db);
}

function initializeMarketplaceOutcomeLedger(db) {
  const context = ensureOutcomeConnection(db);
  if (context.schemaInitialized) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_outcome_ledger (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      counterparty_id TEXT,
      subject_role TEXT NOT NULL CHECK(subject_role IN ('agent', 'claimant')),
      outcome_type TEXT NOT NULL,
      polarity TEXT NOT NULL CHECK(polarity IN ('positive', 'negative')),
      model_version TEXT NOT NULL,
      source_transition_audit_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      settled_amount_minor TEXT CHECK(
        settled_amount_minor IS NULL
        OR (settled_amount_minor GLOB '[0-9]*' AND settled_amount_minor NOT GLOB '*[^0-9]*')
      ),
      currency TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id),
      FOREIGN KEY (source_transition_audit_id) REFERENCES job_transition_audit(id)
    );

    CREATE INDEX IF NOT EXISTS idx_marketplace_outcome_ledger_subject
      ON marketplace_outcome_ledger(subject_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_marketplace_outcome_ledger_job
      ON marketplace_outcome_ledger(job_id, created_at, id);

    CREATE TRIGGER IF NOT EXISTS guard_marketplace_outcome_ledger_insert
    BEFORE INSERT ON marketplace_outcome_ledger
    WHEN marketplace_outcome_write_authorized() = 0
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_OUTCOME_REQUIRES_CANONICAL_EVENT');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_outcome_ledger_update
    BEFORE UPDATE ON marketplace_outcome_ledger
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_OUTCOME_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS immutable_marketplace_outcome_ledger_delete
    BEFORE DELETE ON marketplace_outcome_ledger
    BEGIN
      SELECT RAISE(ABORT, 'MARKETPLACE_OUTCOME_IMMUTABLE');
    END;
  `);

  context.schemaInitialized = true;
}

function deriveOutcomeFromTransition(job, transition, subject) {
  if (!job || !transition) return null;
  if (transition.fromStatus !== 'awarded' || transition.toStatus !== 'open') return null;

  const definitions = {
    'marketplace-application-api:agent_declined': {
      outcomeType: 'application_award_declined',
      subjectRole: 'agent',
    },
    'marketplace-application-api:award_timed_out': {
      outcomeType: 'application_award_timed_out',
      subjectRole: 'agent',
    },
    'marketplace-claim-api:claimant_declined': {
      outcomeType: 'claim_award_declined',
      subjectRole: 'claimant',
    },
    'marketplace-claim-api:claim_award_timed_out': {
      outcomeType: 'claim_award_timed_out',
      subjectRole: 'claimant',
    },
  };
  const definition = definitions[`${transition.source}:${transition.reason}`];
  const subjectId = String(subject?.agent_id || '').trim();
  if (!definition || !subjectId) return null;

  return {
    id: `mol_${crypto.createHash('sha256').update(transition.id).digest('hex').slice(0, 24)}`,
    jobId: job.id,
    subjectId,
    counterpartyId: job.client_id || null,
    subjectRole: definition.subjectRole,
    outcomeType: definition.outcomeType,
    polarity: 'negative',
    modelVersion: OUTCOME_MODEL_VERSION,
    sourceTransitionAuditId: transition.id,
    source: transition.source,
    settledAmountMinor: null,
    currency: null,
    metadata: {
      reason: transition.reason,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      transitionMetadata: transition.metadata || {},
    },
    createdAt: transition.createdAt,
  };
}

function canonicalOutcomeInputs(db, auditId) {
  const row = db.prepare(`
    SELECT *
    FROM job_transition_audit
    WHERE id = ?
  `).get(auditId);
  if (!row) return null;
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(row.job_id);
  if (!job) return null;

  let metadata;
  try {
    metadata = JSON.parse(row.metadata || '{}');
  } catch {
    return null;
  }

  const references = {
    'marketplace-application-api': { table: 'applications', metadataKey: 'applicationId' },
    'marketplace-claim-api': { table: 'marketplace_claims', metadataKey: 'claimId' },
  };
  const reference = references[row.source];
  const referenceId = reference && String(metadata[reference.metadataKey] || '').trim();
  if (!reference || !referenceId || !tableExists(db, reference.table)) return null;

  const subject = db.prepare(`
    SELECT id, job_id, agent_id
    FROM ${reference.table}
    WHERE id = ? AND job_id = ?
  `).get(referenceId, row.job_id);
  if (!subject) return null;

  return {
    job,
    transition: {
      id: row.id,
      jobId: row.job_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      actorId: row.actor_id,
      reason: row.reason,
      source: row.source,
      idempotencyKey: row.idempotency_key,
      metadata,
      createdAt: row.created_at,
    },
    subject,
  };
}

function recordDerivedMarketplaceOutcomeForAudit(db, auditId) {
  initializeMarketplaceOutcomeLedger(db);
  return db.transaction(() => {
    const inputs = canonicalOutcomeInputs(db, auditId);
    if (!inputs) return null;
    const outcome = deriveOutcomeFromTransition(inputs.job, inputs.transition, inputs.subject);
    if (!outcome) return null;

    const context = ensureOutcomeConnection(db);
    context.authorizedDepth += 1;
    try {
      db.prepare(`
        INSERT INTO marketplace_outcome_ledger (
          id, job_id, subject_id, counterparty_id, subject_role, outcome_type,
          polarity, model_version, source_transition_audit_id, source,
          settled_amount_minor, currency, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        outcome.id,
        outcome.jobId,
        outcome.subjectId,
        outcome.counterpartyId,
        outcome.subjectRole,
        outcome.outcomeType,
        outcome.polarity,
        outcome.modelVersion,
        outcome.sourceTransitionAuditId,
        outcome.source,
        outcome.settledAmountMinor,
        outcome.currency,
        JSON.stringify(outcome.metadata),
        outcome.createdAt,
      );
    } finally {
      context.authorizedDepth -= 1;
    }
    return outcome;
  })();
}

function mapOutcomeRow(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    subjectId: row.subject_id,
    counterpartyId: row.counterparty_id,
    subjectRole: row.subject_role,
    outcomeType: row.outcome_type,
    polarity: row.polarity,
    modelVersion: row.model_version,
    sourceTransitionAuditId: row.source_transition_audit_id,
    source: row.source,
    settledAmountMinor: row.settled_amount_minor,
    currency: row.currency,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: row.created_at,
  };
}

function listMarketplaceOutcomes(db, { subjectId = null, jobIds = null } = {}) {
  if (!tableExists(db, 'marketplace_outcome_ledger')) return [];
  const clauses = [];
  const bindings = [];
  if (subjectId) {
    clauses.push('subject_id = ?');
    bindings.push(subjectId);
  }
  if (Array.isArray(jobIds)) {
    if (jobIds.length === 0) return [];
    clauses.push(`job_id IN (${jobIds.map(() => '?').join(',')})`);
    bindings.push(...jobIds);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM marketplace_outcome_ledger
    ${where}
    ORDER BY datetime(created_at) ASC, rowid ASC
  `).all(...bindings).map(mapOutcomeRow);
}

function summarizeMarketplaceOutcomes(outcomes) {
  const rows = Array.isArray(outcomes) ? outcomes : [];
  const positiveOutcomeCount = rows.filter((row) => row.polarity === 'positive').length;
  const negativeOutcomeCount = rows.filter((row) => row.polarity === 'negative').length;
  let settledVolume = 0;
  for (const row of rows) {
    if (row.polarity !== 'positive' || row.settledAmountMinor == null || !row.currency) continue;
    try {
      settledVolume += Number(formatMinorUnits(row.settledAmountMinor, row.currency)) || 0;
    } catch {}
  }
  return {
    outcomeCount: rows.length,
    qualifiedOutcomeCount: new Set(rows.map((row) => row.jobId || row.job_id).filter(Boolean)).size,
    outcomeEventCount: rows.length,
    positiveOutcomeCount,
    negativeOutcomeCount,
    settledVolume,
  };
}

function summarizeMarketplaceOutcomesForSubject(db, subjectId) {
  return summarizeMarketplaceOutcomes(listMarketplaceOutcomes(db, { subjectId }));
}

module.exports = {
  OUTCOME_MODEL_VERSION,
  initializeMarketplaceOutcomeLedger,
  deriveOutcomeFromTransition,
  recordDerivedMarketplaceOutcomeForAudit,
  listMarketplaceOutcomes,
  summarizeMarketplaceOutcomes,
  summarizeMarketplaceOutcomesForSubject,
};
