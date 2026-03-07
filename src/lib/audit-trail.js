/**
 * Audit Trail / Transparency Log
 * Records all significant platform events for accountability
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'agentfolio.db');

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

// Initialize audit table
function initAuditTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_trail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      event_type TEXT NOT NULL,
      actor_id TEXT,
      target_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      metadata TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_trail(actor_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_trail(target_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_trail(event_type)`);
  db.close();
}

// Event types
const AUDIT_EVENTS = {
  PROFILE_CREATED: 'profile.created',
  PROFILE_UPDATED: 'profile.updated',
  PROFILE_CLAIMED: 'profile.claimed',
  VERIFICATION_ADDED: 'verification.added',
  VERIFICATION_REMOVED: 'verification.removed',
  JOB_POSTED: 'marketplace.job_posted',
  JOB_APPLIED: 'marketplace.job_applied',
  JOB_ASSIGNED: 'marketplace.job_assigned',
  JOB_COMPLETED: 'marketplace.job_completed',
  JOB_DISPUTED: 'marketplace.job_disputed',
  ESCROW_FUNDED: 'escrow.funded',
  ESCROW_RELEASED: 'escrow.released',
  ESCROW_REFUNDED: 'escrow.refunded',
  REVIEW_POSTED: 'review.posted',
  ENDORSEMENT_GIVEN: 'endorsement.given',
  API_KEY_CREATED: 'apikey.created',
  API_KEY_REVOKED: 'apikey.revoked',
  FOLLOW: 'social.follow',
  UNFOLLOW: 'social.unfollow',
  BOUNTY_SUBMITTED: 'bounty.submitted',
  BOUNTY_WON: 'bounty.won',
  PREMIUM_UPGRADE: 'premium.upgrade',
};

/**
 * Log an audit event
 */
function logAuditEvent(eventType, { actorId, targetId, action, details, ip, metadata } = {}) {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO audit_trail (event_type, actor_id, target_id, action, details, ip_address, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      eventType,
      actorId || null,
      targetId || null,
      action || eventType,
      details || null,
      ip || null,
      metadata ? JSON.stringify(metadata) : null
    );
    db.close();
  } catch (e) {
    console.error('[Audit] Error logging event:', e.message);
  }
}

/**
 * Query audit trail with filters
 */
function queryAuditTrail({ eventType, actorId, targetId, limit = 50, offset = 0, since, until } = {}) {
  const db = getDb();
  let query = 'SELECT * FROM audit_trail WHERE 1=1';
  const params = [];

  if (eventType) { query += ' AND event_type = ?'; params.push(eventType); }
  if (actorId) { query += ' AND actor_id = ?'; params.push(actorId); }
  if (targetId) { query += ' AND target_id = ?'; params.push(targetId); }
  if (since) { query += ' AND timestamp >= ?'; params.push(since); }
  if (until) { query += ' AND timestamp <= ?'; params.push(until); }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);
  const total = db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as count').replace(/ORDER BY.*$/, '')).get(...params.slice(0, -2));
  db.close();

  return { events: rows, total: total?.count || 0 };
}

/**
 * Get audit trail for a specific profile
 */
function getProfileAuditTrail(profileId, limit = 50) {
  return queryAuditTrail({
    targetId: profileId,
    limit
  });
}

/**
 * Get recent platform-wide events
 */
function getRecentEvents(limit = 100) {
  return queryAuditTrail({ limit });
}

/**
 * Get event counts by type (for analytics)
 */
function getEventStats(since) {
  const db = getDb();
  let query = 'SELECT event_type, COUNT(*) as count FROM audit_trail';
  const params = [];
  if (since) { query += ' WHERE timestamp >= ?'; params.push(since); }
  query += ' GROUP BY event_type ORDER BY count DESC';
  const rows = db.prepare(query).all(...params);
  db.close();
  return rows;
}

// Initialize on load
try { initAuditTable(); } catch (e) { console.error('[Audit] Init error:', e.message); }

module.exports = {
  AUDIT_EVENTS,
  logAuditEvent,
  queryAuditTrail,
  getProfileAuditTrail,
  getRecentEvents,
  getEventStats,
};
