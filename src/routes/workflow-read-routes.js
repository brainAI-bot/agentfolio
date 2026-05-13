const path = require('path');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const fees = require('../lib/performance-fees');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'agentfolio.db');
const workflowReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

function openReadOnlyDb(dbPath) {
  return new Database(dbPath || DEFAULT_DB_PATH, { readonly: true });
}

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function tableColumns(db, tableName) {
  if (!tableExists(db, tableName)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
}

function selectExpr(columns, columnName, fallback = 'NULL') {
  return columns.has(columnName) ? columnName : `${fallback} AS ${columnName}`;
}

function numericSummary(db, tableName, columns, sql) {
  if (!tableExists(db, tableName)) return null;
  try {
    return db.prepare(sql(columns)).get();
  } catch (error) {
    return null;
  }
}

function registerWorkflowReadRoutes(app, options = {}) {
  const dbPath = options.dbPath || DEFAULT_DB_PATH;

  // Canonical public activity feed. Older docs referenced /api/activity/feed;
  // /api/activity is the frontend-facing workflow route.
  app.get('/api/activity', workflowReadLimiter, (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const type = req.query.type;

    let db;
    try {
      db = openReadOnlyDb(dbPath);
      const events = [];

      if (!type || type === 'registration') {
        const profileColumns = tableColumns(db, 'profiles');
        if (profileColumns.size > 0) {
          const where = profileColumns.has('hidden') ? 'WHERE COALESCE(hidden, 0) = 0' : '';
          const orderBy = profileColumns.has('created_at') ? 'datetime(created_at) DESC' : 'rowid DESC';
          const rows = db.prepare(`
            SELECT
              ${selectExpr(profileColumns, 'id')},
              ${selectExpr(profileColumns, 'name')},
              ${selectExpr(profileColumns, 'handle')},
              ${selectExpr(profileColumns, 'avatar')},
              ${selectExpr(profileColumns, 'skills', "'[]'")},
              ${selectExpr(profileColumns, 'created_at', 'CURRENT_TIMESTAMP')}
            FROM profiles
            ${where}
            ORDER BY ${orderBy}
            LIMIT ?
          `).all(limit * 2);

          for (const profile of rows) {
            let skills = [];
            try { skills = JSON.parse(profile.skills || '[]'); } catch {}
            events.push({
              type: 'registration',
              profileId: profile.id,
              profileName: profile.name || profile.id,
              handle: profile.handle || null,
              avatar: profile.avatar || null,
              summary: `${profile.name || profile.id} joined AgentFolio`,
              detail: skills.length ? { skills: skills.slice(0, 3) } : {},
              timestamp: profile.created_at,
            });
          }
        }
      }

      if (!type || type === 'verification') {
        const activityColumns = tableColumns(db, 'activity_feed');
        if (activityColumns.size > 0) {
          const rows = db.prepare(`
            SELECT
              ${selectExpr(activityColumns, 'profile_id')},
              ${selectExpr(activityColumns, 'event_type', "'verification'")},
              ${selectExpr(activityColumns, 'detail', "'{}'")},
              ${selectExpr(activityColumns, 'created_at', 'CURRENT_TIMESTAMP')}
            FROM activity_feed
            WHERE ${activityColumns.has('event_type') ? "event_type = 'verification'" : '1 = 1'}
            ORDER BY ${activityColumns.has('created_at') ? 'datetime(created_at) DESC' : 'rowid DESC'}
            LIMIT ?
          `).all(limit * 2);

          for (const verification of rows) {
            let detail = {};
            try { detail = JSON.parse(verification.detail || '{}'); } catch {}
            events.push({
              type: 'verification',
              profileId: verification.profile_id,
              profileName: verification.profile_id,
              summary: `${verification.profile_id} verified ${detail.platform || 'account'}`,
              detail,
              timestamp: verification.created_at,
            });
          }
        }
      }

      if (!type || type === 'score_change') {
        const scoreColumns = tableColumns(db, 'score_history');
        if (scoreColumns.size > 0) {
          const rows = db.prepare(`
            SELECT
              ${selectExpr(scoreColumns, 'agent_id')},
              ${selectExpr(scoreColumns, 'score', '0')},
              ${selectExpr(scoreColumns, 'tier')},
              ${selectExpr(scoreColumns, 'reason')},
              ${selectExpr(scoreColumns, 'created_at', 'CURRENT_TIMESTAMP')}
            FROM score_history
            ${scoreColumns.has('reason') ? "WHERE reason NOT IN ('v1_seed', 'v3_seed')" : ''}
            ORDER BY ${scoreColumns.has('created_at') ? 'datetime(created_at) DESC' : 'rowid DESC'}
            LIMIT ?
          `).all(limit * 2);

          for (const scoreChange of rows) {
            events.push({
              type: 'score_change',
              profileId: scoreChange.agent_id,
              profileName: scoreChange.agent_id,
              summary: `${scoreChange.agent_id} reached ${scoreChange.tier || 'score'} (${Math.round(scoreChange.score || 0)})`,
              detail: {
                score: Math.round(scoreChange.score || 0),
                tier: scoreChange.tier || null,
                reason: scoreChange.reason || null,
              },
              timestamp: scoreChange.created_at,
            });
          }
        }
      }

      events.sort((a, b) => (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0));
      const paginated = events.slice(offset, offset + limit);

      return res.json({
        ok: true,
        events: paginated,
        count: paginated.length,
        total: events.length,
        offset,
        limit,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to fetch activity feed' });
    } finally {
      if (db) try { db.close(); } catch {}
    }
  });

  // Canonical marketplace read stats. This intentionally does not mount the
  // broader legacy sprint3 endpoint bundle, which also duplicates /api/search.
  app.get('/api/marketplace/stats', workflowReadLimiter, (req, res) => {
    let db;
    try {
      db = openReadOnlyDb(dbPath);
      const jobColumns = tableColumns(db, 'jobs');
      const escrowColumns = tableColumns(db, 'escrows');
      const applicationColumns = tableColumns(db, 'applications');

      const jobStats = numericSummary(db, 'jobs', jobColumns, (columns) => `
        SELECT
          COUNT(*) AS total_jobs,
          ${columns.has('status') ? "SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END)" : '0'} AS open_jobs,
          ${columns.has('status') ? "SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END)" : '0'} AS in_progress_jobs,
          ${columns.has('status') ? "SUM(CASE WHEN status = 'awaiting_funding' THEN 1 ELSE 0 END)" : '0'} AS awaiting_funding_jobs,
          ${columns.has('status') ? "SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)" : '0'} AS completed_jobs,
          ${columns.has('status') ? "SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END)" : '0'} AS disputed_jobs,
          ${columns.has('status') ? "SUM(CASE WHEN status IN ('closed', 'cancelled') THEN 1 ELSE 0 END)" : '0'} AS closed_jobs
        FROM jobs
      `) || {
        total_jobs: 0,
        open_jobs: 0,
        in_progress_jobs: 0,
        awaiting_funding_jobs: 0,
        completed_jobs: 0,
        disputed_jobs: 0,
        closed_jobs: 0,
      };

      const escrowStats = numericSummary(db, 'escrows', escrowColumns, (columns) => `
        SELECT
          COUNT(*) AS total_escrows,
          ${columns.has('amount') ? 'COALESCE(SUM(amount), 0)' : '0'} AS total_volume,
          ${columns.has('amount') && columns.has('status') ? "COALESCE(SUM(CASE WHEN status IN ('released', 'auto_released', 'completed') THEN amount ELSE 0 END), 0)" : '0'} AS released_volume,
          ${columns.has('platform_fee') ? 'COALESCE(SUM(platform_fee), 0)' : '0'} AS total_fees
        FROM escrows
      `) || {
        total_escrows: 0,
        total_volume: 0,
        released_volume: 0,
        total_fees: 0,
      };

      const applicationStats = applicationColumns.size > 0
        ? db.prepare('SELECT COUNT(*) AS total_applications FROM applications').get()
        : { total_applications: 0 };

      const totalJobs = Number(jobStats.total_jobs || 0);
      const completedJobs = Number(jobStats.completed_jobs || 0);
      const completionRate = totalJobs > 0 ? Number(((completedJobs / totalJobs) * 100).toFixed(1)) : 0;

      return res.json({
        ok: true,
        jobs: {
          total_jobs: totalJobs,
          open_jobs: Number(jobStats.open_jobs || 0),
          in_progress_jobs: Number(jobStats.in_progress_jobs || 0),
          awaiting_funding_jobs: Number(jobStats.awaiting_funding_jobs || 0),
          completed_jobs: completedJobs,
          disputed_jobs: Number(jobStats.disputed_jobs || 0),
          closed_jobs: Number(jobStats.closed_jobs || 0),
          completion_rate: completionRate,
        },
        escrow: {
          total_escrows: Number(escrowStats.total_escrows || 0),
          total_volume: Number(escrowStats.total_volume || 0),
          released_volume: Number(escrowStats.released_volume || 0),
          total_fees: Number(escrowStats.total_fees || 0),
        },
        applications: {
          total_applications: Number(applicationStats.total_applications || 0),
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to fetch marketplace stats' });
    } finally {
      if (db) try { db.close(); } catch {}
    }
  });

  // Read-only public tier catalog. Do not mount src/api/fees.js wholesale here:
  // that legacy module includes unauthenticated admin/write endpoints.
  app.get('/api/fees/tiers', workflowReadLimiter, (req, res) => {
    return res.json({
      ok: true,
      tiers: fees.getFeeTiers(),
      premiumDiscounts: fees.PREMIUM_DISCOUNTS,
      minRate: fees.MIN_FEE_RATE,
    });
  });
}

module.exports = { registerWorkflowReadRoutes };
