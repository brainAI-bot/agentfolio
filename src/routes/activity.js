/**
 * Activity Feed API — GET /api/activity
 * Returns recent platform activity: registrations, verifications, score changes
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'agentfolio.db');

function registerActivityRoutes(app) {
  app.get('/api/activity', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type; // optional filter: registration, verification, score_change

    let db;
    try {
      db = new Database(DB_PATH, { readonly: true });

      const events = [];

      // 1. New profile registrations
      if (!type || type === 'registration') {
        const profiles = db.prepare(`
          SELECT id, name, handle, avatar, skills, created_at
          FROM profiles
          WHERE hidden = 0
          ORDER BY created_at DESC
          LIMIT ?
        `).all(limit * 2);

        for (const p of profiles) {
          let skills = [];
          try { skills = JSON.parse(p.skills || '[]'); } catch {}
          events.push({
            type: 'registration',
            profileId: p.id,
            profileName: p.name,
            handle: p.handle,
            avatar: p.avatar,
            summary: `${p.name} joined AgentFolio`,
            detail: skills.length > 0 ? { skills: skills.slice(0, 3) } : {},
            timestamp: p.created_at
          });
        }
      }

      // 2. Verifications completed (from activity_feed table)
      if (!type || type === 'verification') {
        const verifications = db.prepare(`
          SELECT af.profile_id, af.event_type, af.detail, af.created_at,
                 p.name as profile_name, p.handle, p.avatar
          FROM activity_feed af
          LEFT JOIN profiles p ON af.profile_id = p.id
          WHERE af.event_type = 'verification'
          ORDER BY af.created_at DESC
          LIMIT ?
        `).all(limit * 2);

        for (const v of verifications) {
          let detail = {};
          try { detail = JSON.parse(v.detail || '{}'); } catch {}
          events.push({
            type: 'verification',
            profileId: v.profile_id,
            profileName: v.profile_name || v.profile_id,
            handle: v.handle,
            avatar: v.avatar,
            summary: `${v.profile_name || v.profile_id} verified ${detail.platform || 'account'}`,
            detail: {
              platform: detail.platform,
              identifier: detail.identifier ? detail.identifier.slice(0, 12) + '...' : undefined
            },
            timestamp: v.created_at
          });
        }
      }

      // 3. Score changes (from score_history)
      if (!type || type === 'score_change') {
        const scoreChanges = db.prepare(`
          SELECT sh.agent_id, sh.score, sh.tier, sh.reason, sh.created_at,
                 p.name as profile_name, p.handle, p.avatar
          FROM score_history sh
          LEFT JOIN profiles p ON sh.agent_id = p.id
          WHERE sh.reason != 'v1_seed' AND sh.reason != 'v3_seed'
          ORDER BY sh.created_at DESC
          LIMIT ?
        `).all(limit * 2);

        for (const sc of scoreChanges) {
          events.push({
            type: 'score_change',
            profileId: sc.agent_id,
            profileName: sc.profile_name || sc.agent_id,
            handle: sc.handle,
            avatar: sc.avatar,
            summary: `${sc.profile_name || sc.agent_id} reached ${sc.tier} (${Math.round(sc.score)})`,
            detail: {
              score: Math.round(sc.score),
              tier: sc.tier,
              reason: sc.reason
            },
            timestamp: sc.created_at
          });
        }
      }

      // Sort all events by timestamp descending, apply offset + limit
      events.sort((a, b) => {
        const ta = new Date(a.timestamp).getTime() || 0;
        const tb = new Date(b.timestamp).getTime() || 0;
        return tb - ta;
      });

      const paginated = events.slice(offset, offset + limit);

      res.json({
        ok: true,
        events: paginated,
        count: paginated.length,
        total: events.length,
        offset,
        limit,
        generatedAt: new Date().toISOString()
      });

    } catch (err) {
      console.error('[Activity Feed]', err.message);
      res.status(500).json({ ok: false, error: 'Failed to fetch activity feed' });
    } finally {
      if (db) try { db.close(); } catch {}
    }
  });
}

module.exports = { registerActivityRoutes };
